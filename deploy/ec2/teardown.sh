#!/bin/bash
# Terminates the GPU box and deletes its firewall rule, then clears the settings from .env.
set -euo pipefail
cd "$(dirname "$0")/../.."
export $(grep -E '^AWS_(ACCESS_KEY_ID|SECRET_ACCESS_KEY|SESSION_TOKEN)=' .env | xargs)
export AWS_REGION=${AWS_REGION:-us-east-1}
NAME=jev-laya-gemma
IDS=$(aws ec2 describe-instances --filters Name=tag:Name,Values=$NAME Name=instance-state-name,Values=pending,running,stopping,stopped \
  --query 'Reservations[].Instances[].InstanceId' --output text)
if [ -n "$IDS" ]; then
  aws ec2 terminate-instances --instance-ids $IDS >/dev/null
  aws ec2 wait instance-terminated --instance-ids $IDS
  echo "Terminated $IDS"
fi
SG=$(aws ec2 describe-security-groups --filters Name=group-name,Values=$NAME --query 'SecurityGroups[0].GroupId' --output text)
[ "$SG" != "None" ] && aws ec2 delete-security-group --group-id "$SG" && echo "Deleted firewall $SG"
sed -i -E '/^(LAYA_BASE_URL|LAYA_API_KEY|LAYA_HOST_NOTE|GEMMA_BASE_URL|GEMMA_API_KEY|GEMMA_HOST_NOTE|EC2_INSTANCE_ID)=/d' .env
echo "Cleared the Laya and Gemma settings from .env"
