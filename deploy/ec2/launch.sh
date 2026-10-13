#!/bin/bash
# Launches the GPU box for Laya + EmbeddingGemma 2 and writes the connection
# settings into .env. Usage: deploy/ec2/launch.sh [shutdown-minutes]   (default 120)
# Tear down with deploy/ec2/teardown.sh.
set -euo pipefail
cd "$(dirname "$0")/../.."
export $(grep -E '^AWS_(ACCESS_KEY_ID|SECRET_ACCESS_KEY|SESSION_TOKEN)=' .env | xargs)
export AWS_REGION=${AWS_REGION:-us-east-1}

MINUTES=${1:-120}
TYPE=${INSTANCE_TYPE:-g4dn.xlarge}
NAME=jev-laya-gemma
TAGS="{Key=Project,Value=jev-demos},{Key=Name,Value=$NAME},{Key=Owner,Value=$(aws sts get-caller-identity --query 'Arn' --output text | sed 's#.*/##')}"
AMI=$(aws ec2 describe-images --owners amazon \
  --filters 'Name=name,Values=Deep Learning Base OSS Nvidia Driver GPU AMI (Ubuntu 22.04)*' 'Name=state,Values=available' \
  --query 'sort_by(Images,&CreationDate)[-1].ImageId' --output text)
MY_IP=$(curl -s https://checkip.amazonaws.com)
LAYA_KEY=$(openssl rand -hex 24)
GEMMA_KEY=$(openssl rand -hex 24)

VPC=$(aws ec2 describe-vpcs --filters Name=is-default,Values=true --query 'Vpcs[0].VpcId' --output text)
SG=$(aws ec2 describe-security-groups --filters Name=group-name,Values=$NAME Name=vpc-id,Values=$VPC --query 'SecurityGroups[0].GroupId' --output text)
if [ "$SG" = "None" ]; then
  SG=$(aws ec2 create-security-group --group-name $NAME --vpc-id "$VPC" \
    --description "jev-demos: Laya and EmbeddingGemma from one IP" \
    --tag-specifications "ResourceType=security-group,Tags=[$TAGS]" --query GroupId --output text)
fi
for port in 8000 8001; do
  aws ec2 authorize-security-group-ingress --group-id "$SG" --protocol tcp --port $port --cidr "$MY_IP/32" >/dev/null 2>&1 || true
done

USERDATA=$(mktemp)
sed -e "s/__SHUTDOWN_MINUTES__/$MINUTES/" -e "s/__LAYA_KEY__/$LAYA_KEY/" -e "s/__GEMMA_KEY__/$GEMMA_KEY/" \
  -e "s#__GEMMA_SERVER_B64__#$(base64 -w0 deploy/gemma-serve/server.py)#" deploy/ec2/user-data.sh > "$USERDATA"

ID=$(aws ec2 run-instances --image-id "$AMI" --instance-type "$TYPE" --count 1 \
  --security-group-ids "$SG" --user-data "file://$USERDATA" \
  --instance-initiated-shutdown-behavior terminate \
  --block-device-mappings 'DeviceName=/dev/sda1,Ebs={VolumeSize=100,VolumeType=gp3,DeleteOnTermination=true}' \
  --tag-specifications "ResourceType=instance,Tags=[$TAGS]" "ResourceType=volume,Tags=[$TAGS]" \
  --query 'Instances[0].InstanceId' --output text)
rm -f "$USERDATA"
aws ec2 wait instance-running --instance-ids "$ID"
IP=$(aws ec2 describe-instances --instance-ids "$ID" --query 'Reservations[0].Instances[0].PublicIpAddress' --output text)

# Point the arena at the box (replacing any earlier values).
sed -i -E '/^(LAYA_BASE_URL|LAYA_API_KEY|LAYA_HOST_NOTE|GEMMA_BASE_URL|GEMMA_API_KEY|GEMMA_HOST_NOTE|EC2_INSTANCE_ID)=/d' .env
cat >> .env <<ENV
EC2_INSTANCE_ID=$ID
LAYA_BASE_URL=http://$IP:8000
LAYA_API_KEY=$LAYA_KEY
LAYA_HOST_NOTE="self-hosted on a T4 GPU in us-east-1"
GEMMA_BASE_URL=http://$IP:8001
GEMMA_API_KEY=$GEMMA_KEY
GEMMA_HOST_NOTE="self-hosted on a T4 GPU in us-east-1"
ENV
chmod 600 .env
echo "Launched $ID ($TYPE, $AMI) at $IP; firewall $SG open to $MY_IP on 8000-8001; terminates itself in $MINUTES minutes."
