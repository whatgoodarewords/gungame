#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "dummynet/pfctl is macOS-only; use: docker compose -f tools/netsim/compose.yml --profile steady up --abort-on-container-exit"
  exit 2
fi
for command in dnctl pfctl; do
  if ! command -v "$command" >/dev/null; then
    echo "missing $command; use the documented Docker/netem path instead"
    exit 2
  fi
done

PROFILE="${1:-steady}"
DURATION="${NETSIM_DURATION:-600}"
SEED="${NETSIM_SEED:-424242}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PF_RULES="${TMPDIR:-/tmp}/gungame-pf.rules"
BURST_PID=""

case "$PROFILE" in
  steady|burst) ;;
  *)
    echo "usage: $0 steady|burst"
    exit 2
    ;;
esac

sudo -v
cleanup() {
  if [[ -n "$BURST_PID" ]]; then kill "$BURST_PID" 2>/dev/null || true; fi
  sudo pfctl -a com.apple/gungame -F all >/dev/null 2>&1 || true
  sudo dnctl -q delete 1 2 >/dev/null 2>&1 || true
  rm -f "$PF_RULES"
}
trap cleanup EXIT INT TERM

# Two 75 ms one-way pipes produce 150 ms RTT. 1.005% independent loss on
# each direction composes to approximately 2% packet loss.
sudo dnctl pipe 1 config delay 75 plr 0.01005
sudo dnctl pipe 2 config delay 75 plr 0.01005
printf '%s\n' \
  'dummynet in quick on lo0 proto tcp from any port 8787 to any pipe 1' \
  'dummynet out quick on lo0 proto tcp from any to any port 8787 pipe 2' \
  >"$PF_RULES"
sudo pfctl -E >/dev/null 2>&1 || true
sudo pfctl -a com.apple/gungame -f "$PF_RULES"

if [[ "$PROFILE" == "burst" ]]; then
  (
    while true; do
      sudo dnctl pipe 1 config delay 75 plr 0.02532
      sudo dnctl pipe 2 config delay 75 plr 0.02532
      sleep 0.5
      sudo dnctl pipe 1 config delay 75 plr 0
      sudo dnctl pipe 2 config delay 75 plr 0
      sleep 4.5
    done
  ) &
  BURST_PID=$!
fi

cd "$ROOT"
echo "running $PROFILE profile for ${DURATION}s (bot seed $SEED); sudo is required for packet-level pf/dummynet"
ALLOW_HEADLESS_BOTS=1 BUILD_HASH=dev pnpm --filter @gungame/server dev \
  >"${TMPDIR:-/tmp}/gungame-netsim-server.log" 2>&1 &
SERVER_PID=$!
trap 'kill "$SERVER_PID" 2>/dev/null || true; cleanup' EXIT INT TERM
for _ in $(seq 1 120); do
  curl --fail --silent http://127.0.0.1:8787/gg/healthz >/dev/null && break
  sleep 0.25
done
pnpm --filter @gungame/tools bots \
  --bots 12 \
  --duration "$DURATION" \
  --seed "$SEED" \
  --profile "$PROFILE" \
  --output "tools/netsim/reports/${PROFILE}.json"
