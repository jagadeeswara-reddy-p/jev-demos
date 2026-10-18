#!/bin/bash
# Waits until the models on the GPU box answer real moves, then prints one test
# move from each. Reports setup errors from the box's boot log as they appear.
# Run after launch.sh:   deploy/ec2/wait-ready.sh [max-minutes]   (default 25)
#
# "Healthy" isn't enough: Strands Decider compiles its GPU kernels on the first
# real request, which took over 30 seconds, longer than the arena's timeout. So
# each model gets warm-up moves (with a long timeout) before it counts as ready.
set -uo pipefail
source "$(dirname "$0")/common.sh"
get() { env_get "$1"; }
ID=$(get EC2_INSTANCE_ID)
[ -n "$ID" ] || { echo "No EC2_INSTANCE_ID in .env; run deploy/ec2/launch.sh first." >&2; exit 1; }
LIMIT=$(( ${1:-25} * 60 ))

declare -A URL=([laya]=$(get LAYA_BASE_URL) [strands]=$(get STRANDS_BASE_URL))
declare -A AUTH=([laya]=$(get LAYA_API_KEY) [strands]="")
declare -A MODEL=([laya]=live-laya [strands]=live-strands)
declare -A READY=()
for m in "${!URL[@]}"; do [ -z "${URL[$m]}" ] && unset "URL[$m]"; done

# A real move, exactly as the arena sends it, for each model.
body() { bun -e "
  const { models } = await import('./server/sources.ts');
  const { decisionBody } = await import('./server/adapters/decision.ts');
  const { sampleRequest } = await import('./server/sample.ts');
  console.log(JSON.stringify(decisionBody(models.resolve('$1'), sampleRequest())));"; }

start=$(date +%s)
seen=""
while :; do
  t=$(( $(date +%s) - start ))
  for m in "${!URL[@]}"; do
    [ -n "${READY[$m]:-}" ] && continue
    curl -sf -m 5 "${URL[$m]}/health" >/dev/null || continue
    echo "[$t s] $m is up; warming up with real moves (the first can take a minute)..."
    req=$(body "${MODEL[$m]}")
    ok=0
    for i in 1 2 3; do
      code=$(curl -s -o /dev/null -w '%{http_code} %{time_total}' -m 300 -X POST "${URL[$m]}/v1/systemone" \
        -H 'Content-Type: application/json' ${AUTH[$m]:+-H "Authorization: Bearer ${AUTH[$m]}"} -d "$req")
      echo "  warm-up move $i: HTTP ${code% *} in ${code#* }s"
      [ "${code% *}" = 200 ] && ok=1
    done
    [ $ok = 1 ] && READY[$m]=1 || echo "  $m answered with errors; see above."
  done
  [ ${#READY[@]} -eq ${#URL[@]} ] && break

  # Setup progress and errors from the boot log (shown once each).
  log=$(aws ec2 get-console-output --instance-id "$ID" --latest --output text 2>/dev/null |
    grep -aE "STARTED|SETUP DONE|SETUP FAILED|Traceback|[Ee]rror:|ERROR|No such|not found|Failed to|failed" | grep -avE "SSM Agent|RequestManagedInstanceRoleToken" | sed 's/^\[ *[0-9.]*\] cloud-init\[[0-9]*\]: //')
  new=$(comm -13 <(sort <<<"$seen") <(sort <<<"$log"))
  [ -n "$new" ] && echo "$new" | sed "s/^/[$t s] box: /"
  seen=$(printf '%s\n%s' "$seen" "$log")

  if [ $t -ge $LIMIT ]; then
    ready="${!READY[*]}"
    echo "Gave up after $(( LIMIT / 60 )) minutes. Ready: ${ready:-none}. Debug: ssh -i .ec2-key.pem ubuntu@$(get EC2_IP)" >&2
    exit 1
  fi
  sleep 20
done

served=()
for m in "${!URL[@]}"; do served+=("${MODEL[$m]}"); done
echo "Ready after $(( ($(date +%s) - start) / 60 )) min: ${!URL[*]}. Test moves through the arena's own adapters:"
bun scripts/smoke.ts "${served[@]}" -n 3
echo "Restart bun dev so the page uses the new address. The box deletes itself at $(get EC2_ENDS_AT)."
