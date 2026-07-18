#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DURATION="${1:-30}"
REPORT="${2:-$ROOT/tools/netsim/reports/smoke.json}"
LOG="${TMPDIR:-/tmp}/gungame-smoke-server.log"
PORT="${GUNGAME_SMOKE_PORT:-18787}"
export COREPACK_HOME="$ROOT/.corepack"

cd "$ROOT"
ALLOW_HEADLESS_BOTS=1 BUILD_HASH=dev PORT="$PORT" pnpm --filter @gungame/server dev >"$LOG" 2>&1 &
SERVER_PID=$!
cleanup() {
  kill "$SERVER_PID" 2>/dev/null || true
  wait "$SERVER_PID" 2>/dev/null || true
}
trap cleanup EXIT

ready=0
for _ in $(seq 1 120); do
  if curl --fail --silent "http://127.0.0.1:$PORT/gg/healthz" >/dev/null; then
    ready=1
    break
  fi
  sleep 0.25
done
if [[ "$ready" != "1" ]]; then
  tail -80 "$LOG"
  exit 1
fi

pnpm --filter @gungame/tools bots \
  --bots 2 \
  --duration "$DURATION" \
  --seed 424242 \
  --profile localhost-smoke \
  --url "ws://127.0.0.1:$PORT/gg/ws" \
  --output "$REPORT"
