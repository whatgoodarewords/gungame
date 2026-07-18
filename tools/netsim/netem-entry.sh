#!/usr/bin/env bash
set -euo pipefail

PROFILE="${NETSIM_PROFILE:-steady}"
SEED="${NETSIM_SEED:-424242}"

SEEDED=1
if ! tc qdisc replace dev eth0 root netem delay 75ms loss random 1.005% seed "$SEED" 2>/dev/null; then
  SEEDED=0
  echo "netem seed unsupported by this host kernel; using kernel PRNG (bot workload seed remains $SEED)"
  tc qdisc replace dev eth0 root netem delay 75ms loss random 1.005%
fi
replace_loss() {
  local loss="$1"
  if [[ "$SEEDED" == "1" ]]; then
    tc qdisc replace dev eth0 root netem delay 75ms loss random "$loss" seed "$SEED"
  else
    tc qdisc replace dev eth0 root netem delay 75ms loss random "$loss"
  fi
}
if [[ "$PROFILE" == "burst" ]]; then
  (
    while true; do
      replace_loss 2.532%
      sleep 0.5
      tc qdisc replace dev eth0 root netem delay 75ms
      sleep 4.5
    done
  ) &
fi
exec "$@"
