# HOTFIX1 — live findings

Status: implementation and repository gates complete. The mixed visual soak is
scripted but could not be executed to completion on this host; see the explicit
environment caveat below. Code-only lane; `docs/` and `deploy/` remain
untouched.

## Finding 5 — CRITICAL server FSM crash

- Root cause confirmed: a room tick could call `WsPeer.sendBaseline()`, which
  re-sampled `performance.now()` and advanced the connection FSM beyond the
  tick-start timestamp subsequently supplied to `sweepTimeouts()`.
- Implemented: pass the loop's single sampled `nowMs` through room execution,
  command acceptance, baseline transitions, and timeout sweeping.
- Implemented: quarantine connection-scoped FSM failures with a typed protocol
  refusal, close code `4002`, contextual log, and continued loop execution.
- Added focused regressions for an uncleanly dropped connection swept behind its
  stored FSM time and a forced non-monotonic connection beside a healthy peer.

The focused regressions are green in the server suite.

## Finding 4 — crouch-jump + turn

- Verified the mac-safe primary duck binding is `ShiftLeft` and simultaneous
  buttons remain independent bits.
- Added a compact dev-panel input inspector showing the live button mask,
  pointer-lock state, and the last five key events.
- Added a Shift+Space+A/D+mouse matrix regression that starts ducked and
  verifies jump velocity plus the turned view angle for both strafe directions.

## Finding 1 — detached-canvas pointer lock

- Verified the phase-6.5 lazy canvas lookup and hardened both raw and fallback
  lock requests to reacquire the currently mounted canvas.
- Added a detached-configured-canvas resolver regression; localhost e2e retains
  the lock-engaged assertion against `#app canvas:last-of-type`.

## Finding 3 — grounded geometry z-fighting

- Ground-contact box and ramp bases now extend 0.02 m below their support
  surface; occluded grounded-box and ramp bottom triangles are no longer
  emitted.
- Removed the remaining coplanar overlaps reported across Spire, Foundry,
  Duna, and Cascade, then regenerated both `.gltf` and `.blob` outputs.
- Added a 1 mm same-facing parallel-coplanar overlap validator to every map
  pipeline validation, with a synthetic reject/allow regression in the tools
  test gate.
- Enabled logarithmic depth buffering on the WebGL2 fallback as secondary
  protection; authored geometry remains the primary fix.

## Finding 2 — WebSocket close forensics

- Preserved close-code/reason surfacing in both the browser console and the
  connection-loss card, and added formatting regressions including empty
  close reasons.
- Added `tools/e2e/hotfix1-mixed.ts`: localhost defaults to a 90-second
  12-headless-bot + 2-browser run, asserts pointer lock and both combined-input
  rows, switches style mid-session, rejects any WS close/reconnect, and checks
  the server emitted exactly one listen line. Set `HOTFIX1_DOCKER_CONTAINER`
  to include `docker logs --since ...` restart-signature verification.

## Verification evidence

### Typecheck

```text
$ pnpm -r typecheck && pnpm -r test
Scope: 6 of 7 workspace projects
packages/shared typecheck: Done
packages/protocol typecheck: Done
packages/sim typecheck: Done
server typecheck: Done
tools typecheck: Done
client typecheck: Done
```

### Tests

```text
packages/protocol: 4 files passed; 23 tests passed
packages/sim: 7 files passed; 39 tests passed
server: 5 files passed; 28 tests passed
client: 10 files passed; 39 tests passed
tools:
  coplanar-overlap validator regression passed
  greybox, Spire, Foundry, Duna, Cascade .gltf/.blob validation passed
  race-spot validator passed
  netsim fixture: snapshot mean 223 B; max 223 B
  asset validation passed
```

The chained command exited `0`.

### Reliability soak and mixed-browser e2e

The server-only portion received an additional 90-second, 12-bot localhost
soak:

```text
bots: 12
durationSeconds: 90
reconnectCount: 0
protocolErrors: 0
snapshots: 69136
movementMirrored: true
projectileCombatObserved: true
winnerObserved: true
restartObserved: true
server listen lines: 1
FSM/uncaught/quarantine/restart failure signatures: 0
```

That netsim command exited nonzero only because its independent snapshot budget
reported a mean of `448.05 B` against the existing `400 B` steady-state target
(`max 970 B`). This is outside the five live findings; the hotfix reliability
signals above were clean.

The canonical mixed runner is:

```text
$ pnpm --filter @gungame/tools test:e2e:hotfix1
```

It starts localhost server/client processes, creates two rooms with six bots
each, opens two browser players, asserts the mounted canvas owns pointer lock,
exercises `Shift+Space+A/D+mouse`, verifies the five-event inspector, switches
style halfway through a 90-second session, rejects WS closes or bot reconnects,
and asserts exactly one server listen. When `HOTFIX1_DOCKER_CONTAINER` is set,
it additionally rejects restart/FSM failure signatures from
`docker logs --since`.

This host could not furnish the final two-browser runtime receipt:

- The installed macOS Chromium processes are denied their Mach bootstrap
  rendezvous by the managed execution sandbox before a page opens.
- The in-app browser connector exposed no browser instance.
- In the Playwright Docker image, Chromium's software-WebGL startup stalls
  delayed its 36-byte Hello beyond the protocol's five-second window; frame
  tracing showed close `4000 · state timeout`. Firefox in the same image could
  not create a WebGL context (`FEATURE_FAILURE_WEBGL_EXHAUSTED_DRIVERS`).

No protocol timeout was weakened and no renderer behavior was bypassed merely
to obtain a green receipt. Therefore the scripted 12-bot + 2-browser 90-second
run remains the sole outstanding verification action on a host with a usable
browser/GPU sandbox.

## Hand-off

- Conclusion: all five findings are implemented with regressions; repository
  typecheck/tests and the 12-bot reliability signals are green.
- Verification evidence: `pnpm -r typecheck && pnpm -r test` exited `0`;
  the subsequent exact-map `pnpm --filter @gungame/tools test` also exited `0`.
- Material caveat: this managed host could not execute the two-browser visual
  soak because neither its native nor container browser supplied a usable,
  timely graphics runtime.
- Next action: run
  `pnpm --filter @gungame/tools test:e2e:hotfix1` on a localhost host with a
  usable Chromium sandbox; set `HOTFIX1_DOCKER_CONTAINER=<server-container>` to
  include the required Docker restart-log assertion.
