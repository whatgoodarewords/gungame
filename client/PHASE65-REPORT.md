# Phase 6.5 implementation report

## Progressive receipt

### P0 input and WebSocket forensics

- Raw input now resolves the mounted game canvas at the moment pointer lock is requested and for lock-state checks. Detached front-door canvases cannot remain the lock target.
- WebSocket closes now emit `console.warn` with close code and reason, and the reconnect surface carries the same compact telemetry line.

Verification is recorded after the e2e probe and workspace suites run.

### Room life and personal mastery

- Quickplay rooms maintain a five-slot bot fill target, subtracting exactly one bot per connected human. Bots use curated neutral names, deterministic reaction/aim-error dials, normal player entities, and a low-emphasis scoreboard dot.
- Each map has a start-gated bhop route. Cascade uses the full loop; Foundry, Duna, and Spire have authored checkpoint routes. Best laps serialize per map in local storage and replay as a translucent render-time ghost with no race HUD outside the gate or an active lap.

### Broadcast and match receipts

- Clip-that composites the render canvas at up to 1080p/60 with game audio, a restrained wordmark/map burn-in, and clip-window killfeed lines. Its rolling window is 12 seconds; F8 is the rebindable default, kill confirmations expose a one-click clip action, and airshots/multikills only suggest.
- Match-end stats are accumulated server-side and emitted as mode-end events. The end screen uses flat noun labels, per-map personal-best underlines, and a share action that copies the summary and URL.
- Scout/Deadeye hit chains are server-authoritative per life, award at 2/4/6/8, reset silently on misses, and drive a 500 ms typographic accolade with a restrained two-note formant sting.

### Map invitations and near misses

- Spire, Foundry, Duna, and Cascade now each bake one visible high ledge with a secret race marker. The pipeline rejects authored maps outside the one-to-two race-spot range; the client renders each receipt as a slow glint.
- Projectile head passes use segment geometry and closing speed; hitscan misses use the same 1.5 m contract. Server events distinguish projectile doppler whooshes from lower-gain crack-whizz audio, with radius/gain/doppler dials centralized in shared feel constants.

## Verification evidence

### Required workspace gate

Command:

`pnpm -r typecheck && pnpm -r test`

Result: exit 0.

- protocol: 4 files, 23 tests passed
- simulation: 7 files, 39 tests passed
- server: 5 files, 26 tests passed
- client: 10 files, 35 tests passed
- tools: all GLTF/blob validators passed; `race-spot validator: 4 maps · 1-2 spots each`
- netsim fixture: snapshot mean/max 223 B; aggregate tick p95 2.77 ms; max room p95 1.20 ms
- asset gate: 11 GLBs, 12 normalized audio files, client payload gzip 290,770 B

### Browser P0 probe

`tools/e2e/visual-and-style.ts` now asserts:

- pointer lock targets `#app canvas:last-of-type` after join and the resume click
- all four render-style transactions complete
- the session remains connected through 45 s idle, a style switch, another 45 s idle, then movement
- movement changes the authoritative debug position and no page error is present

The probe could not execute in this managed macOS sandbox. Both installed Google Chrome and a freshly downloaded Playwright headless shell abort before page creation at Mach-port registration (`bootstrap_check_in … Permission denied (1100)`). The game server/client launched, but no browser assertion ran. This is the only unexecuted acceptance check.

## Material caveats

- WebSocket code/reason telemetry is shipped, but the reported live close did not reproduce because Chromium cannot launch in this environment. No speculative style/backpressure/background fix was applied without a reproducer.
- MediaRecorder output uses VP9/Opus when supported and falls back to browser WebM. The rolling ring preserves the initialization chunk plus the newest 12 seconds; browser codec behavior remains part of the real-browser P0 probe.

## Next action

Run `pnpm --filter @gungame/tools test:e2e` from an unsandboxed macOS/Linux shell with Playwright Chromium available. If a WebSocket close reproduces, the console warning and reconnect telemetry now expose the close code/reason needed to fix the responsible server/client path.
