#!/usr/bin/env bash
set -euo pipefail

PROFILE="$1"
OUTPUT="$2"
CLIENTS="$3"
shift 3
RAW="$(mktemp)"
if ! [[ "$CLIENTS" =~ ^[1-9][0-9]*$ ]]; then
  echo "client count must be a positive integer"
  exit 2
fi

tcpdump -tt -l -n -i eth0 'tcp src port 8787' >"$RAW" 2>/dev/null &
CAPTURE_PID=$!
"$@" &
CHILD_PID=$!
terminate() {
  kill -TERM "$CHILD_PID" 2>/dev/null || true
}
trap terminate TERM INT

set +e
wait "$CHILD_PID"
STATUS=$?
set -e
kill -INT "$CAPTURE_PID" 2>/dev/null || true
wait "$CAPTURE_PID" 2>/dev/null || true

read -r BYTES DURATION <<<"$(
  awk '{
    for (i = 1; i <= NF; i += 1) {
      if ($i == "length" && (i + 1) <= NF) {
        value = $(i + 1)
        gsub(/[^0-9]/, "", value)
        if (value != "" && value + 0 > 0) {
          total += value
          if (first == 0) first = $1
          last = $1
        }
      }
    }
  } END {
    duration = last - first
    if (duration < 1) duration = 1
    printf "%.0f %.6f", total + 0, duration
  }' "$RAW"
)"
KBPS="$(awk -v bytes="$BYTES" -v seconds="$DURATION" 'BEGIN { printf "%.6f", bytes / seconds / 1000 }')"
PER_CLIENT_KBPS="$(
  awk -v kbps="$KBPS" -v clients="$CLIENTS" 'BEGIN { printf "%.6f", kbps / clients }'
)"
mkdir -p "$(dirname "$OUTPUT")"
printf '{"profile":"%s","boundary":"TCP payload bytes from server port 8787 (includes retransmissions and WS framing)","clients":%s,"activeDurationSeconds":%s,"aggregateDownBytes":%s,"aggregateDownKBps":%s,"perClientDownKBps":%s}\n' \
  "$PROFILE" "$CLIENTS" "$DURATION" "$BYTES" "$KBPS" "$PER_CLIENT_KBPS" | tee "$OUTPUT"
rm -f "$RAW"
exit "$STATUS"
