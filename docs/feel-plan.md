# Feel plan — beat Deadshot/Krunker/Venge on FEEL (architect audit, 2026-07-20)

Scope: code audit of the live tree against `docs/SPEC.md` §3.2/3.6, `docs/native-feel.md`
(binding), `docs/art-direction.md`. Every item: defect with `file:line` → concrete change →
measurable acceptance → rank. Ranked by **feel-impact-per-unit-effort** (F1 = do first).

Hard constraints honored throughout: **WebGL2 is the primary path**, **60 fps on a $250
Chromebook**, **sub-3-second load**. Nothing below requires WebGPU-only features; anything
WebGPU-specific (e.g. timestamp queries) is explicitly out of scope.

## What is already good (verified in code — no work needed)

- **Lag compensation is real and tested**: 400 ms hull ring (`server/src/rooms.ts:86,600`),
  fractional rewind with generation+alive fence (`packages/sim/src/combat.ts:128–166`),
  independent 300 ms clamp (`combat.ts:14,110–112`), forged-target validation
  (`combat.ts:97–120`) with unit tests incl. chain-overflow and regressed-target cases
  (`packages/sim/test/combat.test.ts:46–137`).
- **Sub-tick fire contract is implemented end to end**: click latches yaw/pitch + fraction
  (`client/src/input.ts:420–427`), tick consumes the latch exactly once — 144 Hz-safe
  (`input.ts:390–409`, `main.ts:717–725`), server lerps the shooter eye E−1→E by
  `fireFraction` (`rooms.ts:689–694`, `combat.ts:179–192`).
- **Prediction/reconciliation core is correct in shape**: seq-acked replay of unacked cmds,
  render-only error offset with exp decay and 0.5 m snap valve, wall-capsule constraint
  (`client/src/net/prediction.ts:91–145,231–239`), epoch/generation resets
  (`client/src/sim-bridge.ts:280–282`).
- **Movement depth exists and is better than any of the three competitors**: Q3
  accel/air-accel with no speed cap (`packages/sim/src/step.ts:72–91,325–333`), 80 ms jump
  buffer, 50 ms coyote, duck-slide with low-friction window (`step.ts:369–378`), jumpbug
  preserved by design (`step.ts:258–267`), scroll-wheel jump (`input.ts:306–312`), bhop
  time-trial ghosts. This is the retention engine — protect it.
- **Zero camera smoothing, zero walk bob** (`client/src/camera.ts`), raw pointer lock with
  `unadjustedMovement` (`input.ts:368`), cm/360 sensitivity.
- **Loss-tolerant hit feedback**: events repeat in snapshots until acked, deduped client-side;
  kill/hit events are rendered the same rAF the snapshot arrives (`main.ts:1220–1311`).
- **Server transport discipline**: one-slot snapshot buffer with hysteresis + hard-close
  (`server/src/transport.ts:91–113`), server tick p95 in `/gg/healthz`.

The gaps below are what separates "correct netcode" from "feels native".

---

## F1 — Wire the dead adaptive-interpolation path; handle snapshot starvation

**Defect.** `RemoteInterpolation.noteStall()` (`client/src/net/interpolation.ts:53–56`) is
never called anywhere in production code (grep: only the definition + tests). The
spec-pinned adaptive ceiling (7 ticks, SPEC §3.2 "Prediction & reconciliation") is dead
code. When the buffer runs dry (WS burst loss — our *primary* transport), `sample()`
clamps to the newest buffered state (`interpolation.ts:63–71`): remote players hard-freeze,
then teleport. On TCP this is the single most visible feel failure at real-world jitter,
and it's the #1 thing Krunker players will notice.

**Change.** In `NetworkSession` (`client/src/net/session.ts:280–284`), detect starvation at
sample time: if the interpolation target exceeds the newest buffered tick for any entity,
call `noteStall(true)`, else `noteStall(false)` (the class already implements the
+1-tick / −0.05-decay policy, ceiling 7, floor 5). Add bounded dead-reckoning while
starved: extrapolate position by buffered velocity for ≤2 ticks, then freeze.

**Acceptance.** Netsim burst profile (150 ms RTT, 5 % loss in 500 ms bursts / 5 s — SPEC
§3.2 gate): remote-stall p95 < 100 ms (the existing gate number, currently unmeasured on
the client); adaptive delay observed reaching 6–7 ticks during bursts and decaying back to
5 within 10 s of clean traffic; zero visible teleports > 0.5 m for a straight-line runner.

## F2 — Local fire presentation must come from the predicted sim, not wall-clock guesswork

**Defect.** `main.ts:967–980` plays the muzzle/audio/casing when
`(buttons & Fire) && now >= nextLocalShotMs`, where `nextLocalShotMs` is a wall-clock copy
of the refire interval. This (a) drifts against the server's tick-quantized cadence during
held fire (SMG: 5.44 ticks ≠ 85 ms wall), (b) plays fire during round freeze
(server ignores fire when `rules.frozen`, `rooms.ts:574`), (c) plays fire during Goldie
reload, (d) plays the *ladder weapon's* sound for melee-modifier attacks
(`Buttons.Melee` swaps the weapon server-side at `rooms.ts:655–658`, the client
presentation never checks it). Every mismatch is a "shot that didn't happen" — the exact
class of lie that makes hit-reg feel bad even when hit-reg is perfect.

**Change.** `PredictionReconciler` already predicts fire gating for projectiles
(`prediction.ts:175–196`, `nextFireTick`). Extend it to all weapon kinds: predict
`nextFireTick`, ammo/reload (Goldie), freeze state, and melee-modifier weapon selection;
emit a per-tick `firedWeaponId | null` presentation event queue from the sim bridge.
`renderFrame` consumes that queue (≤1 rAF later) instead of re-deriving cadence.

**Acceptance.** Scripted 5 s held-fire run per weapon (offline bot harness): local
presentation count == server shot-resolution count, exactly. Zero fire presentations
during `ScoreboardFreeze` or an empty Goldie. Melee attack presents knife audio/viewmodel.
Click→muzzle-flash latency unchanged (≤1 frame, assert via the F4 estimator).

## F3 — Kill the 4 ms quantization of local-player render interpolation

**Defect.** Local render position lerps `prevState→state` using
`tickDriver.alpha` (`main.ts:878–887`), but alpha is the *accumulator at the last driver
wake* (`client/src/tick-driver.ts:37–39`), and the driver wakes on a 4 ms `setTimeout`
(`tick-driver.ts:55`). At 120–144 Hz the render loop reads an alpha that is up to 4 ms
stale, different amounts each frame → sub-pixel-to-multi-pixel local motion judder that
reads as "browser game" even at perfect fps. (Same staleness affects
`input.ts:423` `fireFraction`, whose `tickStartMs` is stamped at consumption time.)

**Change.** Have the driver record `lastTickAtMs`; expose
`alphaAt(nowMs) = clamp((nowMs − lastTickAtMs)/tickSeconds)`; `renderFrame` passes its own
`performance.now()`. Stamp `tickStartMs` from the same value for fireFraction.

**Acceptance.** Instrumented 10 s strafe run at 120 Hz: per-frame rendered-position deltas
have coefficient of variation < 5 % at constant velocity (today: visibly bimodal).
Ten-line change; verify with the existing `__GG_VISUAL_DEBUG__` hook.

## F4 — Ship the click-to-photon estimator and frame-time p99 (specced, missing)

**Defect.** `native-feel.md §1` mandates a permanent click-to-photon number in the panel
("this number is the product") and §3 mandates p99 ≤ 1.5× median in the HUD. Neither
exists: `FrameBudgetMeter` is EMA-only (`client/src/perf.ts:29,92–94` — no percentiles
anywhere in client, grep confirms), and no input-timestamp→present estimator exists.
You cannot win a feel war without the meter you're optimizing.

**Change.** (a) Ring buffer (512) of raw frame times in `FrameBudgetMeter`; expose
median/p99; panel row + `__GG_VISUAL_DEBUG__`. (b) Estimator: on each latched fire /
pointer sample, record `event.timeStamp`; on the next rAF after present, record delta
(`requestAnimationFrame` timestamp; on WebGL2 optionally sharpen with a fenced
`gl.getSyncParameter` probe — cheap, primary-path-safe). Report rolling median + p95.

**Acceptance.** Panel permanently shows `c2p median/p95` and `frame p99/median`.
Budgets enforced: c2p median ≤ 35 ms at 120 Hz on M-series (native-feel budget), frame
p99 ≤ 1.5× median in the 60 s bot-match GC smoke; both wired into the e2e probe so
regressions fail CI.

## F5 — Apply the dead `moveSpeedScale` dials (knife speed & scoped mobility are no-ops)

**Defect.** `WEAPONS[].moveSpeedScale` / `scopedMoveSpeedScale`
(`packages/shared/src/weapons.ts:38–39`; knife 1.14, scout scoped 0.92, default scoped
0.72) are consumed **nowhere** in movement — grep hits only viewmodels. `wishVelocity`
uses raw `params.runSpeed` (`step.ts:301–304`); the server steps with params only
(`rooms.ts:578–581`). SPEC §3.5 pins "knife-in-hands grants bonus move speed" and "scout-
mobility while scoped" — specced-but-missing. Knife-rush pacing and the scoped-mobility
identity of Scout/Deadeye simply don't exist on live.

**Change.** Add `speedScale` to `StepOptions`; both server (`rooms.ts` step call — derive
from `weaponForTier` + Zoom/Melee buttons) and client prediction
(`prediction.ts:74–89` — it already knows `weaponId`) pass the same value so prediction
stays exact.

**Acceptance.** Replay test: knife carrier ground speed = 6.4 × 1.14 m/s; scoped Deadeye =
6.4 × 0.72; client/server bit-identical over a 300-tick replay (zero reconcile
correction). HUD speed readout confirms live.

## F6 — Reconciliation seeds replay from stale non-networked state (mispredict source)

**Defect.** The authoritative state used for replay (`sim-bridge.ts:268–277`) copies
`prediction.state.player` (the *current head* state) and overwrites only
pos/vel/view/grounded. Server-replicated `self.ducked` is ignored (it IS on the wire —
`session.ts:213`), and `jumpBufferTicks/jumpButtonDown/coyoteTicksLeft/slideTicksLeft/
duckProgress` are head-values, not at-`frame.tick` values. If a duck edge or jump edge is
dropped/held server-side, the client replays unacked cmds from the wrong hull/latch state
→ oscillating corrections in exactly the situations (crouch-jumps, slides, tight gaps)
where mispredicts hurt most.

**Change.** (a) Apply `self.ducked` (and derive `duckProgress` = ducked ? 1 : 0 on
mismatch) into the authoritative seed. (b) Keep a small ring of post-predict states keyed
by cmd seq in `PredictionReconciler`; on reconcile, seed the non-networked latch fields
from the stored state at `lastProcessedCmdSeq` instead of the head.

**Acceptance.** Unit test: drop a duck-press cmd server-side under netsim; client hull
height matches server within 1 tick after the next snapshot and correction magnitude
converges to 0 (no oscillation across 3 consecutive snapshots). Existing wall-side
correction test stays green.

## F7 — Chromebook frame time: un-BVH'd per-frame raycasts and log-depth on the primary path

**Defect (two, same budget).**
(a) Nameplate occlusion raycasts the **full map mesh** with stock three.js raycast — no
`boundsTree` is installed on any render geometry (grep: `three-mesh-bvh` only in
`packages/sim/src/collision.ts`) — once per remote player within 15 m, **every frame**,
allocating an intersections array each call (`main.ts:1043–1046`). On Iris/Celeron this is
milliseconds of main-thread time and GC churn in fights — exactly when 60 fps matters.
(b) `logarithmicDepthBuffer: true` is enabled *only on the WebGL2 path*
(`main.ts:184`) — it forces per-fragment depth writes, killing early-Z on exactly the
$250-Chromebook path. `docs/live-findings-4b.md` #3 already concluded geometry sinking is
the real z-fight fix and log-depth only "if free". It is not free.

**Change.** (a) Reuse the already-loaded sim `CollisionWorld` BVH for a single
segment-occlusion query (add a `segmentBlocked(from,to)` helper), and throttle nameplate
occlusion to 15 Hz per label (cached between). (b) Remove `logarithmicDepthBuffer` once
the generator coplanar-face validator (live-findings #3c) is confirmed in CI.

**Acceptance.** `characters` perf mark with 11 remotes: occlusion cost < 0.05 ms/frame;
GC smoke shows zero allocations from the occlusion path. WebGL2 1080p on Iris-Xe class:
frame p99 ≤ 16.6 ms (the 60 fps budget measured by F4's meter, not average fps). Visual
sweep of all 4 maps shows no z-fighting after removal.

## F8 — Input chain: `pointerrawupdate` + desynchronized canvas (specced, missing)

**Defect.** Mouse input is `mousemove` only (`input.ts:266`); Chromium coalesces
mousemove to rAF cadence, so (a) the fire latch (`input.ts:420`) captures angles up to one
frame stale relative to the true click-instant aim, and (b) at 60 Hz displays the aim the
player sees lags the hand by up to ~16 ms more than needed. `native-feel.md §1` mandates
`pointerrawupdate` with fallback and `{ desynchronized: true }` — neither is present
(grep: zero hits in client). The canvas is created bare (`main.ts:137`) and handed to
`WebGPURenderer` (`main.ts:180–185`) which creates the context internally.

**Change.** (a) Feature-detect `"onpointerrawupdate" in window`; when present and locked,
accumulate deltas from `pointerrawupdate` (including `getCoalescedEvents()`), keep
mousemove as fallback; input inspector row shows which source is live. (b) On the WebGL2
path, pre-create the context with `canvas.getContext("webgl2", { desynchronized: true,
antialias: true, ... })` and pass it via the renderer's `context` option; keep behind a
setting until F4's estimator proves it tear-free per-machine (native-feel: "measure, keep
only if tear-free").

**Acceptance.** F4 estimator shows click-to-photon median improvement ≥ 4 ms on Chromium
at 120 Hz (and no regression at 60 Hz); synthetic-event unit test proves the latched fire
angle incorporates deltas delivered after the last rAF; no tearing reported in the manual
matrix on the two hardware classes.

## F9 — Honest quickscope timing: scoped accuracy is instant and binary

**Defect.** Server-side scoped state is just "Zoom bit set on the firing cmd"
(`rooms.ts:727`); scoped spread (Scout 0.03° vs 2.8° unscoped, `weapons.ts:108–112`)
applies the same tick the button goes down. Meanwhile the client zoom is an ~80 ms FOV
lerp (`main.ts:911–915`). So the *mechanically optimal* play is a zero-visual-feedback
right-click+left-click macro — degenerate, unreadable to victims, and it makes the scout
(the marquee scoutzknivez gun) feel random to everyone who zooms honestly. SPEC §3.6
demands "snappy zoom lerp with **honest quickscope timing**".

**Change.** Track `scopedSinceTick` per slot on the Zoom edge (server) and in prediction
(client — it already receives buttons per tick). Spread lerps from unscoped to scoped
over N ticks (dial, start 10 ticks ≈ 156 ms, tuned to match the client FOV lerp+overlay).
Client crosshair/overlay reflects the same ramp so what you see is what you get.

**Acceptance.** Unit test: spread at scoped-tick 0 == unscoped; at tick ≥ N == scoped;
identical values computed client and server side. Owner feel sign-off on scout at 78 ms
interp delay (the WS default). The macro play now lands 2.8° shots — verified in test.

## F10 — RTT-derive the lag-comp fallback estimate (hardcoded −5 ticks)

**Defect.** When a cmd's `interpTargetTick` fails validation, the server substitutes
`estimateTick = serverTick − 5` flat (`rooms.ts:676`). SPEC §3.2 pins the estimate as
"the server's send-time/RTT-derived" value. For a 150 ms-RTT player (true view ≈ 10–14
ticks back) any estimate fallback shifts their shot ~100+ ms forward — those shots whiff
with no explanation, and it fires precisely in the messy cases (joins, resyncs, target
ring gaps) where trust is earned or lost.

**Change.** Maintain a per-slot RTT estimate (the cmd `tick` vs execution tick delta is
already available via `cmdWindow`; or add a tick echo to Pong — `transport.ts:329–335`
currently hardcodes `serverTick: 0`). `estimate = serverTick − round(rttTicks/2 +
interpDelayTicks)` clamped to the 300 ms rule as today.

**Acceptance.** Netsim at 150 ms steady: shots forced onto the estimate path (forged
target test extended) land within ±1 tick of the client's true interpolated view;
`validateFireTarget` suite green; flick-registration rate on the estimate path within 3
points of the validated path.

---

## Second tier (do after F1–F10)

### F11 — Freeze movement/feel params to room config on both ends
Server steps without `feel` (`rooms.ts:578–581` → `DEFAULT_FEEL`), while the client panel
live-mutates `params` and `feel` into prediction only (`main.ts:643–653`,
`sim-bridge.ts:168–175`). Any touched dial while connected = permanent mispredict
(client replays every cmd with different physics than the server). Change: when a network
session is active, movement/feel dials become read-only (or dev-build-only server echo);
params/feel derive solely from the welcome config. Acceptance: dial UI disabled when
connected; netsim assert zero systematic per-tick correction drift over 60 s.

### F12 — Decide: deterministic recoil kick for the automatics (design decision, owner call)
Today spray = pure seeded RNG cone (`combat.ts:254–283`, SMG 1.25°) with viewmodel-only
recoil (`client/src/viewmodels.ts:209` — cosmetic). There is no learnable spray mechanic;
RNG cones are the thing Krunker veterans mock. Options: (a) status quo (restraint-clause
purist), (b) deterministic per-burst kick pattern applied to the fire direction
server-side and mirrored client-side as crosshair drift (no screen shake — mechanics, not
theater), (c) first-shot-accuracy + bloom. Recommend (b) for SMG/Rifle only; pattern is
data in `weapons.ts`. Acceptance if adopted: same burst input ⇒ identical hit pattern
(replay test); pattern client-predictable (crosshair shows next-shot offset); owner
sign-off. Effort M; parked behind the F-tier because it changes balance.

### F13 — Auto quality tier for the Chromebook floor
No dynamic quality anywhere: fixed `pixelRatio ≤ 2` (`main.ts:187`), always-on
PCFSoft shadows (`main.ts:199–200`), full post chain. Change: first-10-s p95 probe (F4
meter) selects a tier — low = pixelRatio 1, 512 shadow map or shadows off, plain pass
(the `:plain-no-post` pipeline stage already exists, `main.ts:281–284`). Acceptance:
CPU-throttled Chromebook proxy (6× slowdown, Intel iGPU blocklist off) holds 60 fps p99;
tier decision logged in `__GG_VISUAL_DEBUG__`.

### F14 — Fullscreen-first PLAY (native-feel §2, missing)
No `requestFullscreen` anywhere (grep). PLAY should enter fullscreen with a setting to
opt out; Esc shows the pause card (pointer-unlock card already exists, `hud.ts`).
Acceptance: PLAY → fullscreen+lock in one gesture on Chrome/FF/Safari; opt-out persists;
e2e probe asserts `document.fullscreenElement` after join.

### F15 — The §3.5 flick oracle end-to-end (verification debt)
The combat unit tests cover rewind math, but the SPEC §3.5 exit gate — 200-trial recorded
flick trace, strafing shooter, both impairment profiles, ≥95 % register / 0 % false-
positive — does not exist (`tools/netsim/` has bots/fixtures, no flick oracle; grep
"flick" only hits stat trackers). This is the proof the whole feel bet rests on.
Acceptance: oracle runs in the netem container in CI, both profiles, plus a 144 Hz
client-rate variant (native-feel §5's missing high-refresh assertion).

### F16 — Sub-3-second load: measure against the owner constraint
Spec's gate is < 5 s (§4); the operative constraint is now **sub-3 s**. Bundle gate is
3 MB gz (`client/package.json:28–39`) and character/dressing packs already stream after
first frame (`main.ts:856–877` dynamic imports) — good bones, no measurement. Acceptance:
scripted 50 Mbps cold-cache run (existing throttle check) to first controllable frame
< 3.0 s on the WebGL2 path, tracked in CI output; if over, move KTX2/HDRI environment
install fully post-first-frame (the fallback plumbing already exists,
`environment-state.ts`).

## Explicitly fine / out of scope

- Hitmarker/damage numbers on server echo (RTT-late) is the **correct** CS-style choice —
  local shot presentation (F2) plus loss-tolerant repeated events already give the right
  split. Do not client-predict damage numbers.
- `AudioContext` without `latencyHint` (`audio.ts:117`): the default IS "interactive";
  no-op — skip. Sample pre-decode at unlock already implemented (`audio.ts:379–405`).
- WebGPU-specific present-mode/timestamp work: headroom, not the target. Excluded.
- Interp delay pins (3/5/7 ticks) match spec; don't retune, just wire F1.
- WS one-slot backpressure policy (`transport.ts`) matches spec; verified, leave alone.

## Status log

- **F3 — SHIPPED** (`ca96e09`, live). `alphaAt(nowMs)` on the driver; render loop
  passes its own `performance.now()`. Unit tests in `client/test/tick-driver.test.ts`.
  *Deferred sub-part:* the `fireFraction`/`tickStartMs` stamping is unchanged — the
  staleness there is bounded by the wake interval and only shifts a sub-tick lerp
  fraction, so it was judged not worth perturbing the verified-good sub-tick fire
  contract. The scaffolding (`lastTickAtMs`) was removed rather than left dead.
  *Unverified:* the 120 Hz CoV < 5 % acceptance run needs real hardware.
- **F4 — SHIPPED** (`ca96e09` + `efb9cfa`, live). `PercentileRing` → frame
  median/p99 in `FrameBudgetMeter`; `LatencyEstimator` → click-to-photon.
  Both in the dev panel (red past budget) and `__GG_VISUAL_DEBUG__`. c2p closes
  one rAF after a real muzzle draws, so the interval includes render+present and
  no-photon clicks (cooldown/dead) are never sampled.
  *Partial:* CI asserts only that the meter is populated and self-consistent —
  the p99 ≤ 1.5× median and c2p ≤ 35 ms budgets are NOT gated in CI because the
  runner is a software rasteriser. They belong to the real-hardware matrix.
  c2p-in-CI needs synthetic input; fold into F8.
- **F1 — SHIPPED** (`efb9cfa`, live). Starvation detected at sample time,
  velocity dead-reckoning bounded to 2 ticks, `noteStall` wired so the adaptive
  delay widens under loss and decays to the 5-tick floor.
  *Unverified:* the netsim burst-profile acceptance (remote-stall p95 < 100 ms)
  has not been run — needs the netsim harness, not just unit tests.

## Rollout order

F3+F4 land first (tiny, and F4's meters are the acceptance instrument for everything
else) → F1, F2, F5, F6 (netcode/presentation correctness) → F7, F8 (latency + Chromebook)
→ F9, F10 → second tier. Every item's acceptance number goes into the perf HUD or CI per
native-feel.md's closing rule: automatable budgets fail CI, the rest join the manual
matrix.
