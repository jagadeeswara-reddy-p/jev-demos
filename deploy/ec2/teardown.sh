#!/bin/bash
# Terminates the GPU box, deletes its firewall rule and SSH key, then clears its settings from .env.
# Safe to run after the box has already deleted itself (it cleans up what is left).
set -euo pipefail
source "$(dirname "$0")/common.sh"
owner_name
IDS=$(aws ec2 describe-instances --filters Name=tag:Name,Values=$NAME Name=instance-state-name,Values=pending,running,stopping,stopped \
  --query 'Reservations[].Instances[].InstanceId' --output text)
if [ -n "$IDS" ]; then
  aws ec2 terminate-instances --instance-ids $IDS >/dev/null
  aws ec2 wait instance-terminated --instance-ids $IDS
  echo "Terminated $IDS"
fi
SG=$(aws ec2 describe-security-groups --filters Name=group-name,Values=$NAME --query 'SecurityGroups[0].GroupId' --output text)
[ "$SG" != "None" ] && aws ec2 delete-security-group --group-id "$SG" >/dev/null && echo "Deleted firewall $SG"
aws ec2 delete-key-pair --key-name $NAME >/dev/null 2>&1 && rm -f .ec2-key.pem && echo "Deleted SSH key $NAME"
sed -i -E '/^(LAYA_BASE_URL|LAYA_API_KEY|LAYA_HOST_NOTE|STRANDS_BASE_URL|STRANDS_HOST_NOTE|EC2_INSTANCE_ID|EC2_IP|EC2_ENDS_AT)=/d' .env
echo "Cleared the Laya and Strands settings from .env"
