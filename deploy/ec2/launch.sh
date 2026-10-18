#!/bin/bash
# Launches the GPU box for Laya and AWS Strands Decider and writes the connection
# settings into .env. Then run deploy/ec2/wait-ready.sh, which waits for both
# servers, warms them up and reports any setup error. Tear down with teardown.sh.
#
#   deploy/ec2/launch.sh [shutdown-minutes]     default 60
#   WITH_LAYA=0 deploy/ec2/launch.sh            Strands Decider only
#
# Default instance: g5.xlarge (NVIDIA A10G, 24 GB, about $1/hour on demand in us-east-1).
# Strands Decider runs in bf16 with Triton kernels, which need an Ampere or newer GPU,
# so the cheaper T4 (g4dn) only works for Laya.
#
# For debugging, the box gets a throwaway SSH key (.ec2-key.pem, git-ignored) and
# port 22 open to your IP only:  ssh -i .ec2-key.pem ubuntu@<ip>  then
# journalctl -u laya -u strands, or /var/log/jev-setup.log. teardown.sh deletes the key.
set -euo pipefail
source "$(dirname "$0")/common.sh"

MINUTES=${1:-60}
# The box's only off switch is its own shutdown timer, so the minutes must be a real number.
[[ $MINUTES =~ ^[1-9][0-9]*$ ]] && (( MINUTES <= 720 )) || { echo "Shutdown minutes must be a whole number from 1 to 720, got '$MINUTES'." >&2; exit 1; }
TYPE=${INSTANCE_TYPE:-g5.xlarge}
STRANDS_MODEL=${STRANDS_MODEL:-StrandsAgents/strands-decider-2B-qwen3.5-v1-2610}
# Versions known to serve these checkpoints (2026-10-13). Change deliberately.
STRANDS_COMMIT=${STRANDS_COMMIT:-b9fc83626bcca822d00f822d6c2e151b8d244ee9}
LAYA_VERSION=${LAYA_VERSION:-0.4.8}
KEY_FILE=.ec2-key.pem
PORTS="22 8000 8001"

owner_name
TAGS="{Key=Project,Value=jev-demos},{Key=Name,Value=$NAME},{Key=Owner,Value=$OWNER}"
AMI=$(aws ec2 describe-images --owners amazon \
  --filters 'Name=name,Values=Deep Learning Base OSS Nvidia Driver GPU AMI (Ubuntu 22.04)*' 'Name=state,Values=available' \
  --query 'sort_by(Images,&CreationDate)[-1].ImageId' --output text)
MY_IP=$(curl -s https://checkip.amazonaws.com)
LAYA_KEY=$(openssl rand -hex 24)

# Throwaway SSH key, replaced on every launch.
aws ec2 delete-key-pair --key-name $NAME >/dev/null 2>&1 || true
rm -f $KEY_FILE
aws ec2 create-key-pair --key-name $NAME --key-type ed25519 \
  --tag-specifications "ResourceType=key-pair,Tags=[$TAGS]" --query KeyMaterial --output text > $KEY_FILE
chmod 600 $KEY_FILE

# Firewall: only this machine's current IP, on SSH and the two model ports. A group
# left over from a box that deleted itself is reused, with its old rules removed.
VPC=$(aws ec2 describe-vpcs --filters Name=is-default,Values=true --query 'Vpcs[0].VpcId' --output text)
SG=$(aws ec2 describe-security-groups --filters Name=group-name,Values=$NAME Name=vpc-id,Values=$VPC --query 'SecurityGroups[0].GroupId' --output text)
if [ "$SG" = "None" ]; then
  SG=$(aws ec2 create-security-group --group-name $NAME --vpc-id "$VPC" \
    --description "jev-demos: Laya and Strands Decider from one IP" \
    --tag-specifications "ResourceType=security-group,Tags=[$TAGS]" --query GroupId --output text)
else
  OLD=$(aws ec2 describe-security-group-rules --filters Name=group-id,Values=$SG \
    --query 'SecurityGroupRules[?!IsEgress].SecurityGroupRuleId' --output text)
  [ -n "$OLD" ] && aws ec2 revoke-security-group-ingress --group-id "$SG" --security-group-rule-ids $OLD >/dev/null
fi
for port in $PORTS; do
  aws ec2 authorize-security-group-ingress --group-id "$SG" --protocol tcp --port $port --cidr "$MY_IP/32" >/dev/null
done

USERDATA=$(mktemp)
trap 'rm -f "$USERDATA"' EXIT  # it holds the Laya key
sed -e "s/__SHUTDOWN_MINUTES__/$MINUTES/" -e "s/__LAYA_KEY__/$LAYA_KEY/" -e "s#__STRANDS_MODEL__#$STRANDS_MODEL#" \
  -e "s/__STRANDS_COMMIT__/$STRANDS_COMMIT/" -e "s/__LAYA_VERSION__/$LAYA_VERSION/" -e "s/__WITH_LAYA__/${WITH_LAYA:-1}/" \
  deploy/ec2/user-data.sh > "$USERDATA"
if grep -q '__[A-Z_]*__' "$USERDATA"; then echo "Unfilled placeholder in user-data: $(grep -o '__[A-Z_]*__' "$USERDATA" | sort -u)" >&2; exit 1; fi

ID=$(aws ec2 run-instances --image-id "$AMI" --instance-type "$TYPE" --count 1 \
  --key-name $NAME --security-group-ids "$SG" --user-data "file://$USERDATA" \
  --instance-initiated-shutdown-behavior terminate \
  --block-device-mappings 'DeviceName=/dev/sda1,Ebs={VolumeSize=100,VolumeType=gp3,DeleteOnTermination=true}' \
  --tag-specifications "ResourceType=instance,Tags=[$TAGS]" "ResourceType=volume,Tags=[$TAGS]" \
  --query 'Instances[0].InstanceId' --output text)
echo "Started $ID; it deletes itself after $MINUTES minutes (deploy/ec2/teardown.sh removes it sooner)."
aws ec2 wait instance-running --instance-ids "$ID"
IP=$(aws ec2 describe-instances --instance-ids "$ID" --query 'Reservations[0].Instances[0].PublicIpAddress' --output text)
GPU=$(aws ec2 describe-instance-types --instance-types "$TYPE" --query 'InstanceTypes[0].GpuInfo.Gpus[0].Name' --output text)
ENDS=$(date -u -d "+$MINUTES minutes" +%H:%MZ)

# Point the arena at the box (replacing any earlier values).
sed -i -E '/^(LAYA_BASE_URL|LAYA_API_KEY|LAYA_HOST_NOTE|STRANDS_BASE_URL|STRANDS_HOST_NOTE|EC2_INSTANCE_ID|EC2_IP|EC2_ENDS_AT)=/d' .env
{
  echo "EC2_INSTANCE_ID=$ID"
  echo "EC2_IP=$IP"
  echo "EC2_ENDS_AT=$ENDS"
  [ "${WITH_LAYA:-1}" = 1 ] && printf 'LAYA_BASE_URL=http://%s:8000\nLAYA_API_KEY=%s\nLAYA_HOST_NOTE="self-hosted on an %s GPU in %s"\n' "$IP" "$LAYA_KEY" "$GPU" "$AWS_REGION"
  printf 'STRANDS_BASE_URL=http://%s:8001\nSTRANDS_HOST_NOTE="self-hosted on an %s GPU in %s"\n' "$IP" "$GPU" "$AWS_REGION"
} >> .env
chmod 600 .env
echo "Launched $ID ($TYPE, $GPU) at $IP; firewall $SG open to $MY_IP on ports ${PORTS// /, }; deletes itself at $ENDS."
echo "Next: deploy/ec2/wait-ready.sh"
