# Phase 2 implementation report

## Protocol checkpoint

Conclusion: the custom little-endian `DataView` wire codec, connection FSM,
baseline-epoch rules, forward-sliding command window, event repetition/dedupe,
64-entry snapshot ring, and ceiling-aware snapshot packer are implemented.

Verification evidence:

```text
$ COREPACK_HOME=/Volumes/SD/gungame/.corepack pnpm --filter @gungame/protocol typecheck
> tsc -p tsconfig.json
(exit 0)

$ COREPACK_HOME=/Volumes/SD/gungame/.corepack pnpm --filter @gungame/protocol test
Test Files  4 passed (4)
Tests       16 passed (16)
Duration    29.84s
```

The suites cover all frame-family round trips, deterministic fuzz, malformed and
oversized frames, non-finite payloads, legal/illegal FSM transitions and
timeouts, initial/resync epoch handling, replay/gap floods, seq-ordered
monotonicity, 500 ms outage recovery, 12-player ceiling/mean fixtures, oversize
promotion, and event ack coverage.

Material caveats at this checkpoint: server/client integration and packet-level
netsim evidence are not yet present.

Next action: authoritative server loop, rooms/reconnect, storage rings, and the
uWebSockets.js transport.

## Server checkpoint

Conclusion: the authoritative 64 Hz loop, room lifecycle, reconnect slot/token
contract, snapshot/hull storage, command starvation policy, and binary
uWebSockets.js transport are implemented. The WS path enforces the Origin
allowlist, parser/rate hard limits, typed closes, and one-slot newest-snapshot
backpressure with hysteresis and a hard disconnect threshold.

Verification evidence:

```text
$ COREPACK_HOME=/Volumes/SD/gungame/.corepack pnpm --filter @gungame/server typecheck
> tsc -p tsconfig.json
(exit 0)

$ COREPACK_HOME=/Volumes/SD/gungame/.corepack pnpm --filter @gungame/server test
Test Files  2 passed (2)
Tests       8 passed (8)
Duration    69.48s

$ COREPACK_HOME=/Volumes/SD/gungame/.corepack pnpm --filter @gungame/server build
dist/index.js      777.1kb
dist/index.js.map    2.8mb
Done in 6994ms
```

Tests cover catch-up capping/overload admission, fixed ring capacity,
quickplay-fullest selection, immutable room config, reconnect rotation,
supersede and expiry, admission refusal, and newest-only WS backpressure.

Material caveats at this checkpoint: the hull ring is storage-only as required
for Phase 2; rewind queries remain deliberately absent. Runtime two-client
evidence awaits the bot and client seams.

Next action: client channel, clock pacing, prediction/reconciliation, remote
interpolation, and playground integration.

## Client netcode checkpoint

Conclusion: the client now has a send-policy `NetChannel`, binary WS
implementation, RTT/2 clock sync, bounded command-tick slew and step resync,
prediction/replay reconciliation, collision-constrained render error, and
generation-fenced remote interpolation. The playground connects to the local
server, sends latched fire angles, corrects collision state, and renders remote
players through a minimal debug mesh seam.

Verification evidence:

```text
$ COREPACK_HOME=/Volumes/SD/gungame/.corepack pnpm --filter @gungame/client typecheck
> tsc -p tsconfig.json
(exit 0)

$ COREPACK_HOME=/Volumes/SD/gungame/.corepack pnpm --filter @gungame/client test
Test Files  1 passed (1)
Tests       3 passed (3)
Duration    35.94s

$ COREPACK_HOME=/Volumes/SD/gungame/.corepack pnpm --filter @gungame/client build
dist/assets/index-Cnr7oK5G.js  860.10 kB | gzip: 240.07 kB
built in 16.27s
```

The tests cover RTT/2/step pacing, the one-tick-per-second slew bound, pinned
WS/datagram interpolation with a seven-tick ceiling, generation fencing, and
the wall-adjacent render-capsule invariant.

Material caveat at this checkpoint: the force-reload UI for a build mismatch is
intentionally a TODO at the seam, as directed.

Next action: native bots, impairment harness, metrics, smoke, and aggregate CI
fixture.

## Netsim, bots, and CI checkpoint

Conclusion: native Node WebSocket bots, deterministic scripted strafe-jump
workloads, JSON metrics, two-client smoke automation, macOS dummynet/PF tooling,
and bidirectional Docker/netem profiles are implemented. Recursive tests execute
the protocol fuzz/FSM/stall suites plus the 12-player snapshot and aggregate
tick fixture.

Verification evidence:

```text
$ COREPACK_HOME=/Volumes/SD/gungame/.corepack pnpm --filter @gungame/tools test
valid maps/greybox.gltf: 219 triangles, 24 spawns, modes 0,1, 1 kill volumes
valid maps/greybox.blob: 219 triangles, 24 spawns, modes 0,1, 1 kill volumes
{"snapshotMeanBytes":223,"snapshotMaxBytes":223,
 "aggregateTickP95Ms":0.7920420000000377,"aggregateThresholdMs":18}

$ COREPACK_HOME=/Volumes/SD/gungame/.corepack pnpm --filter @gungame/tools smoke
{"bots":2,"durationSeconds":30,
 "predictionCorrectionP95M":0.0000020562484936722396,
 "remoteEntityStallP95Ms":2.4375830000008136,
 "reconnectCount":0,"protocolErrors":0,
 "meanSnapshotBytes":77.30244664237377,"maxSnapshotBytes":87,
 "snapshots":3842,"movementMirrored":true}

$ NETSIM_DURATION=600 docker compose -f tools/netsim/compose.yml \
    --profile steady up --abort-on-container-exit \
    --exit-code-from bots-steady
{"profile":"steady","seed":424242,"bots":12,"durationSeconds":600,
 "predictionCorrectionP95M":0.1000001769332779,
 "remoteEntityStallP95Ms":16.118203999999423,
 "reconnectCount":0,"protocolErrors":0,
 "meanSnapshotBytes":387.2942450952269,"maxSnapshotBytes":427,
 "snapshots":460164,"movementMirrored":true}
```

The 10-minute steady WS gate passes the Phase 2 correction, stall, reconnect,
mean-size, and ceiling thresholds. The emitted decision-table input is
`tools/netsim/reports/steady.json`.

A packet-capture validation of the final counter measured the §4 boundary:

```text
{"profile":"steady",
 "boundary":"TCP payload bytes from server port 8787 (includes retransmissions and WS framing)",
 "clients":12,"activeDurationSeconds":15.498511,
 "aggregateDownBytes":4470875,"aggregateDownKBps":288.471260,
 "perClientDownKBps":24.039272}
```

This passes the 33 kB/s per-client WS budget. The counter is integrated around
both Docker profiles and emits `steady-tcp.json`/`burst-tcp.json`.

Material caveats: the Docker VM logged isolated tick debt drops under host
scheduler contention; this does not invalidate the packet metrics but is not a
substitute for the required dream-server aggregate benchmark. This host's
Trixie netem supports explicit loss seeding; the scripts log and fall back to
kernel PRNG on older kernels.

Next action: final recursive verification and output audit.

## Final verification

Conclusion: both packet profiles pass their 10-minute WS decision gates and all
local hard gates are green. Phase 2b is therefore not activated by this local
transport evidence; the staging real-WAN confirmation remains Prime-owned.

Burst evidence:

```text
$ NETSIM_DURATION=600 docker compose -f tools/netsim/compose.yml \
    --profile burst up --build --abort-on-container-exit \
    --exit-code-from bots-burst
{"profile":"burst","seed":424242,"bots":12,"durationSeconds":600,
 "predictionCorrectionP95M":0.024414050579782354,
 "remoteEntityStallP95Ms":2.8856470000000627,
 "reconnectCount":0,"protocolErrors":0,
 "meanSnapshotBytes":384.7274098870277,"maxSnapshotBytes":427,
 "snapshots":460644,"movementMirrored":true}
```

The burst decision-table input is `tools/netsim/reports/burst.json`.

Repository-wide verification:

```text
$ COREPACK_HOME=/Volumes/SD/gungame/.corepack pnpm -r typecheck &&
  COREPACK_HOME=/Volumes/SD/gungame/.corepack pnpm -r test
packages/protocol: 4 files, 16 tests passed
packages/sim:      6 files, 23 tests passed
server:            2 files, 9 tests passed
client:            1 file, 3 tests passed
tools:             map validators + snapshot/tick fixture passed
(exit 0)

$ COREPACK_HOME=/Volumes/SD/gungame/.corepack pnpm --filter @gungame/client build
$ COREPACK_HOME=/Volumes/SD/gungame/.corepack pnpm --filter @gungame/client size
Size limit: 3 MB
Size:       237.26 kB gzipped

$ COREPACK_HOME=/Volumes/SD/gungame/.corepack pnpm --filter @gungame/server build
dist/index.js      778.1kb
dist/index.js.map    2.8mb

$ rg -n 'Math\.random|Date\.now' packages/protocol server/src \
    client/src/net tools/netsim -g '*.ts' -g '*.js'
(no matches)
```

Material caveats:

- The required dream-server aggregate benchmark and real-WAN staging
  confirmation are environmental/integration tasks for the Prime.
- Docker Desktop logged isolated debt drops under host scheduling contention;
  the trend fixture was 2.368 ms p95 versus the 18 ms smoke ceiling, but only
  the target-box run can establish the admission limit.
- Docker profile bandwidth is captured at the TCP-payload boundary with
  retransmissions and WebSocket framing. Staging WSS still needs the real-WAN
  confirmation so TLS/edge behavior is represented.
- Build-mismatch force reload remains the explicitly requested TODO at the
  client seam.

Next action: Prime review/integration, manual two-browser visual check, then the
dream-server benchmark and WAN confirmation.
