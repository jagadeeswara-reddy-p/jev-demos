#!/bin/bash
# Shared by launch.sh, wait-ready.sh and teardown.sh (sourced, not run).

cd "$(dirname "${BASH_SOURCE[0]}")/../.."

# These scripts use bash 4 and GNU tools (Linux, or WSL on Windows). Check before
# anything is created, so a missing tool can't leave a box running half set up.
if (( BASH_VERSINFO[0] < 4 )) || ! date -u -d "+1 minutes" +%H:%M >/dev/null 2>&1; then
  echo "These scripts need bash 4+ and GNU date/sed (Linux, or WSL on Windows)." >&2
  exit 1
fi

aws_vars=$(grep -E '^AWS_(ACCESS_KEY_ID|SECRET_ACCESS_KEY|SESSION_TOKEN|PROFILE|REGION)=' .env | xargs)
# A bare `export` would print every variable, so only export when there is something to export.
[ -n "$aws_vars" ] && export $aws_vars
unset aws_vars
export AWS_REGION=${AWS_REGION:-us-east-1}

# Value of a setting in .env (the last one wins), without quotes.
env_get() { grep -E "^$1=" .env | tail -1 | cut -d= -f2- | tr -d '"'; }

# One name per AWS user for the box, its firewall rule and its SSH key, so two people
# sharing an account never replace or delete each other's.
owner_name() {
  local who
  who=$(aws sts get-caller-identity --query Arn --output text) || {
    echo "AWS credentials don't work (expired?). Refresh the AWS_* values in .env." >&2
    exit 1
  }
  OWNER=${who##*/}
  NAME="jev-decision-gpu-$(echo "$OWNER" | tr -c 'a-zA-Z0-9-\n' '-' | cut -c1-40)"
}
