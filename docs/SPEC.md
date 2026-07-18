# GUNGAME — browser multiplayer FPS (scoutzknivez + gun game)

> **Progress:** 0/7 phases (0%)
> **Rev:** 7 — round-6 fold (Fable PASS / Codex REVISE [2 blocking: 1 folded — sub-tick timebase unified on the server execution tick; 1 REJECTED by Prime adjudication — repo-path finding contradicted the explicit owner directive that gungame is its own repo outside sw-dev]; both annexes folded 2026-07-18; ledger §9)
> **Repo:** `whatgoodarewords/gungame` (public, MIT) at `/Volumes/SD/gungame`. Process ledger: `docs/process-ledger.md`.
> **Operating model (owner directive):** Claude Fable 5 is prime orchestrator (decomposition, handoffs, integration, git, deploys, verification) and owns all visual/taste surfaces (rendering, RenderStyle, HUD, feel constants). Codex GPT-5.6 (`high`) implements ALL other code in fenced tmux lanes. Both audit: every spec round and implementation diff gets dual review (Codex xhigh + cold Fable).
> **Tier:** XL — phased; each phase a child issue. **License:** MIT; all deps MIT/BSD/Apache.

## 1. Summary

A browser-native, server-authoritative multiplayer FPS built on the two things that made CS scoutzknivez and gun game great: **floaty high-skill movement** (low gravity, strong air-acceleration, air-strafing/bhop) and a **tight kill-to-advance loop**. Open `dev.sml.world/gg`, type a name, you're playing in under 5 seconds. No install, no account.

**Track A architecture (decided 2026-07-18):** TypeScript everywhere. One simulation package shared verbatim between the three.js client and the Node server — prediction + reconciliation only work when both ends run identical movement code.

## 2. Goals / Non-goals

**Goals (v1):**
- Two modes at launch: **Scoutzknivez** (scout + knife, low gravity) and **Gun Game** (ladder, kill to advance, knife finish).
- Competitive-grade netcode: 64 Hz tick, prediction, reconciliation, snapshot interpolation, lag-compensated hitscan with **sub-tick fire timing** (§3.6).
- Feels good at 150 ms RTT + 2% packet loss (packet-level netsim harness proves it — §3.2 Transport gate).
- WebGPU rendering with WebGL2 fallback; 120 fps on Apple-silicon laptops; 60 fps on mid-range (2020-class 4-core, Iris Xe / M1 Air, 1080p).
- Rooms up to 12; quickplay + invite links. **Live at `https://dev.sml.world/gg`.**
- MIT monorepo clean enough to fork — no open FPS-grade JS netcode exists (verified 2026-07-18).

**Non-goals (v1):** accounts/progression/ranks, anti-cheat beyond server authority + validation, mobile/touch, spectator, demos/replays, voice, text chat (killfeed is the channel), room browser, projectiles beyond the single ARSENAL archetype (A1 — §3.5), matchmaking beyond quickplay, map workshop, multi-style rendering as a shipped feature, room host controls (config immutable at creation), horizontal scale-out (v1 = one container on the dream server).

**Reconnection (in scope, minimal, contract defined):** on join the server issues a **reconnect token: 128-bit CSPRNG, in-memory only, scoped to (room, player slot), single-use** (rotated on every successful resume), **expiring with the 45 s slot-hold**. Client stores it in `sessionStorage`. Race rule: a valid-token connection **always supersedes** — if the original socket is still open (refresh case), the server closes it and adopts the new one. A used or expired token is a fresh join (gun-game ladder progress lost after 45 s).

## 3. Architecture

pnpm monorepo, TypeScript strict, ESM only.

```
gungame/
  packages/
    sim/        # fixed-tick simulation, zero DOM deps: pmove, weapons, damage, mode rules
    protocol/   # binary wire format, connection FSM, epochs/delta/ack, events, versioning
    shared/     # ids, math, constants, the two mode configs, feel.ts (client-consumed feel constants)
  client/       # three.js r185+ (WebGPURenderer, WebGL2 fallback), HUD, menus, audio, input
  server/       # Node 22: uWebSockets.js (WSS), rooms, tick loop, lag-comp, static hosting under /gg/
  maps/         # Blender sources + exported GLTF (visual) + baked collision/gameplay blobs
  tools/        # netsim (packet-level impairment + byte counters), headless bot client
```

**Key libraries:** three.js (MIT), three-mesh-bvh (MIT), uWebSockets.js (Apache-2.0). Custom binary protocol via DataView. **No physics engine** — kinematic Quake-style controller; nothing in v1 needs dynamics.

### 3.1 Simulation (`packages/sim`)

- Fixed **64 Hz** tick (`dt = 1/64 s`), integer-tick-indexed. **1 cmd ≡ 1 tick** — no variable frame-time field (closes msec-inflation cheats).
- **Server tick loop:** monotonic-clock fixed-step accumulator; catch-up cap 4 ticks per wake (beyond: drop debt, log overload, refuse new rooms while sustained). Client sim loop: same pattern, decoupled from rAF (§3.3).
- Player controller = Quake 3 pmove, **implemented from published algorithm descriptions only (Gustavsson, adrianb.io) — no GPL or GPL-derived source consulted**: `friction → accelerate → airAccelerate → gravity → stepSlideMove`, step-up 0.45 m, capsule hull.
- **Swept collision:** capsule cast along per-tick displacement (≤4 clip iterations), sub-stepping when |displacement| > capsule radius (air-strafe hits 20–30 m/s = 0.47 m/tick; depenetration would tunnel). CI: 30 m/s vs 0.1 m geometry never tunnels.
- Movement params (live-tunable, Phase 1 dev panel): gravity 20 → 5.5 m/s² (scoutz), runSpeed 6.4, airAccelerate 1.0 → 12.0 (scoutz), groundAccelerate 10, friction 6, jumpVelocity 5.3, no bhop speed cap.
- Determinism: cross-engine bit-exactness NOT required (server authoritative; reconciliation corrects). Required: pure sim, no `Math.random()`/`Date.now()`. Node replay tests bit-exact, gate CI. **Divergence bounded, not assumed:** Phase 2 runs the replay corpus in Chromium, Firefox, and **Playwright WebKit** (patched WebKit, not branded Safari — real Safari is manual, Phase 6) asserting divergence < reconciliation snap threshold. Collision blob pre-baked; BVH params pinned both ends (serialize the BVH itself as fallback).

### 3.2 Netcode

Canonical Source/Quake model, one TS implementation.

**Connection lifecycle (FSM, unit-tested):** `connecting → hello (version+build hash) → baseline-install → active ⇄ resync → closing`. Typed refusals (version mismatch → force-reload; room full; rate-limited; `room-create-refused` when the admission limit or overload policy blocks creation), per-state timeouts, malformed frame → close. **`resync` is a first-class state:** any server-initiated epoch change (oversize promotion, baseline age-out, refocus) moves the client to `resync`; **during an open resync window, cmds and acks referencing the immediately-prior epoch are valid-stale — consumed normally, ignored for delta baselining — never protocol errors**; referencing any other epoch is an error. **Protocol errors are scoped narrowly:** cross-epoch `lastSnapshotTick` (outside the resync window), non-monotonic `lastSnapshotTick`, malformed frames, rate-cap breach. Everything else (late, duplicate, out-of-window cmds) is silently dropped, never fatal. Parser hard limits, Origin allowlist, per-connection message/byte rate caps, finite-number validation on every decoded field — all land in Phase 2 with the parser. Name validation server-side, Phase 3. Phase 6 adds NO new clamps — only the adversarial re-verification pass.

**Commands (client → server), 64 Hz:** `{seq, tick, buttons, viewYaw, viewPitch, fireFraction, lastSnapshotTick, interpTargetTick(+8-bit fraction)}`.
- **`seq` is authoritative for ordering; `tick` is advisory** (pacing feedback + timing only, never execution scheduling — a client cannot schedule itself into the past or future). Server executes cmds **in seq order, at most one per player per server tick**, consuming from a jitter buffer (~2 ticks).
- **Acceptance (normative, adversarially tested in Phase 2):** dedupe by `seq`; accept any `seq > lastProcessedCmdSeq` (**forward-sliding**), retaining at most the newest 8; `lastProcessedCmdSeq` = highest seq **consumed-or-discarded**, so it advances across gaps — after any outage the newest cmds are always accepted and the player resumes immediately (stall-recovery test: 500 ms full outage on each transport → resumes within 4 ticks; no deadlock). `viewPitch` clamped ±89°. **`lastSnapshotTick` monotonicity is evaluated at seq-ordered consumption of accepted cmds only** — dropped duplicates and late cmds are never validated, so natural datagram reordering of redundant cmds cannot trip a protocol error.
- **`fireFraction` (8-bit) — sub-tick fire contract (single normative definition, one timebase):** in a cmd with the fire button set, `viewYaw`/`viewPitch` AND `interpTargetTick(+fraction)` are **latched at the click sample**. All reconstruction happens on the cmd's **server execution tick E** (`tick` is advisory and never selects endpoints): **shooter eye** = lerp(shooter state at end of tick E−1, shooter state at end of tick E, `fireFraction`/256) — i.e., between the states immediately before and after this cmd's own pmove; **ray direction** = the latched (±89°-clamped) angles, which are also the angles that steer this tick's wishdir; **target hulls** = rewound to the latched, validated `interpTargetTick(+fraction)` — **`fireFraction` plays no role in target rewind**. Non-firing cmds: frame-accumulated angles, `fireFraction` ignored. The §3.5 flick oracle (including its strafing-shooter arm) is this contract's end-to-end test.
- `interpTargetTick` **validated, never trusted**: must reference snapshots actually sent to that client, monotonic non-decreasing, inside the server's send-time/RTT-derived plausible window, rewind ≤300 ms; out-of-range clamps to the server's own estimate. Forged-value tests in Phase 3.
- Datagram channels carry the last 3 cmds per packet (redundancy is a channel property; off on TCP).
- **Pacing:** snapshot header reports cmd arrival margin; client slews cmd tick (≤1 tick/s) to hold +1–2 ticks margin; >250 ms error step-resyncs. Clock sync = tick offset from headers + RTT/2, slewed.
- **Starvation:** gap beyond redundancy → repeat last cmd ≤8 ticks, then hold player.

**Snapshots (server → client), 64 Hz:**
- Delta vs last-acked baseline; per-client 64-entry ring. Header carries `lastProcessedCmdSeq` (reconciliation ack — unacked = beyond it).
- **Baseline epochs:** every full snapshot opens an epoch (join, age-out, oversize, refocus); full snapshots ride the reliable channel; client installs + acks; server suspends deltas until ack; prior-epoch traffic handled per the FSM resync rule above. Single resync mechanism, no other desync path.
- Per-entity create/delete bits + **generation counter** (respawn/teleport increments; interpolation and rewind never cross a generation).
- **Events** (kill/damage/hit-confirm): tick-tagged with ids, embedded in every snapshot until covered by the acked baseline (client dedupes) — loss-tolerant by repetition. Reliable channel carries only join/leave/mode transitions.
- **Sizing:** serializer packs against the session's `maxDatagramSize` (datagram channels; 1,100 B is the portable CI ceiling) — **on WS, which has no datagram limit, the serializer packs against the same 1,100 B ceiling** so snapshot shape is transport-independent; mandatory state first; a delta that can't fit is promoted to a full snapshot on the reliable channel (new epoch), never truncated. Mean ≤400 B at 12 players under the netsim workload (CI).
- **Rate fallback:** 32 Hz send (tick 64/send 32) has exactly ONE trigger — sustained mean-size breach from content growth — and is a spec change (re-derive interp/lag-comp), never runtime adaptation, and never the response to a failed transport gate (that's 2b).

**Prediction & reconciliation:** sim state corrects immediately (snap + replay unacked cmds); visible error absorbed by a **render-only exponentially-decaying offset** (snaps >0.5 m, resets on teleport/epoch). Next prediction tick always starts from authoritative collision state (wall-adjacency unit test). Remote entities: interp buffer pinned — **datagram 3 ticks (~47 ms), WS 5 ticks (~78 ms), adaptive ceiling 7 ticks (~109 ms) on both**.

**Lag compensation:** 400 ms of post-tick hulls with generation + alive state; target rewind to the validated `interpTargetTick(+fraction)` only, fractionally interpolated between stored hulls, never across a generation (the shooter's own eye comes from the fire contract above, not from the hull ring). **Clamp rule (not "by construction" — a degradation contract):** rewind target = min(validated target, 300 ms). Chains at 150 ms RTT: datagram 228 ms, WS-default 259 ms, WS-ceiling ~290 ms — inside the clamp with ~10 ms margin at ceiling; **when the true chain exceeds 300 ms (extreme RTT/jitter), shots rewind exactly 300 ms and the high-ping player leads slightly — accepted, tested (chain-overflow case in the Phase 3 suite), and invisible below the design point.**

**Transport — WebSocket first, WebTransport evidence-gated:**
- `NetChannel` = send policy, not a pipe. v1: **WSS via uWebSockets.js**, TCP-aware: **one-slot outgoing snapshot buffer per client** — on backpressure (hysteresis threshold on `bufferedAmount`), unsent snapshots are replaced by newest, never queued; sustained past hard threshold → typed disconnect + token resume. No cmd redundancy on WS; **5-tick default interp buffer on WS (per the prediction pins above)**.
- **Phase 2 decision gate (executable):** packet-level impairment (dummynet/pfctl local, netem container CI — an L7 proxy cannot model TCP loss), deterministic seeds, profiles: steady (150 ms, 2%) + burst (150 ms, 5% in 500 ms bursts / 5 s). **Pass on both:** correction magnitude p95 < 0.15 m, remote stall p95 < 100 ms, zero hard-threshold reconnects in a 10-min 12-bot run. **Byte counters measure:** datagram path = UDP payload bytes; WS path = TCP payload bytes (TLS record layer) — stated so the §4 budgets are measurable. No combat evidence in this gate (none exists yet). Outcomes: pass → WT post-v1, 2b/5b out of v1; fail → 2b (which must also pin a WT datagram congestion/drop policy); Phase 3 flick-test flip re-activates 2b between 3 and 4. Verdict confirmed once over real WAN via a **staging deploy on the dream server** (the production target) at Phase 2 exit.

### 3.3 Client / rendering

- three.js **WebGPURenderer**, WebGL2 fallback; TSL minimal, no backend-specific paths.
- **Geometry-first; look = `RenderStyle` layer** (materials + TSL post + palette + fog/light rig, one swappable unit). Phases 1–3 greybox. **Phase 4 opens with the in-engine bake-off**: brutalist liminal + emissive, dev-grid minimal, monochrome ink/duotone, toon/cel + outlines (advisory prior-matrix scores 33/33/30/25) + composites (e.g. brutalist geometry × ink shading × emissive enemy accents). Judged **in motion** (dither shimmer at 25 m/s is the known duotone risk). Ship exactly one style. Brutalist is the only asset-baked candidate; if it wins, Phase 4 grows knowingly.
- **Map pipeline (scripted):** Blender headless export → GLTF (visual) + baked binary gameplay blob (collision geometry, per-mode spawn transforms, bounds, kill volumes). Naming convention documented; CI validator per map. Server never runs GLTFLoader.
- Draw-call budget ≤150 (live counter in dev overlay). Viewmodel pass, tracers, hitmarkers, damage numbers, killfeed, scout zoom, ladder HUD.
- **Background tabs:** net/sim loop off-rAF (Worker or setTimeout catch-up); client sends explicit `bg`/`fg`; server freezes on `bg` OR input drought (covers throttled and suspended workers) and AFK-kicks at 30 s. Refocus = full snapshot (new epoch), snap, never replay. Three branches (connected/kicked/expired) in the Phase 6 matrix.
- Weapon art: CLASSIC 6 + ARSENAL 8 distinct models (bases shared where honest), CC0 restyled to the committed RenderStyle. Positional audio.

### 3.4 Server & deploy — `dev.sml.world/gg` on the dream server

- Node 22 LTS, esbuild. **Tick budget:** per-room p95 < 4 ms AND aggregate p95 < 9 ms (~60% of 15.625 ms) across hosted rooms; Phase 2 bench measures aggregate **on the dream server itself** and derives the rooms-per-process admission limit; **re-run with combat bots at Phase 3 exit** (limit revised).
- **Topology (pinned, from infra recon 2026-07-18):** one `gungame` container on the small world **dream server** (Hetzner `128.140.126.175`, SSH `root@dream-runner`). Routing: Cloudflare edge (TLS) → Traefik :80 → container via labels ``Host(`dev.sml.world`) && (Path(`/gg`) || PathPrefix(`/gg/`))`` (path-boundary matcher — `/ggfoo` must not match) at router priority above the small world frontend (frontend=1, backend=10; gungame=50). The server 301s `/gg` → `/gg/` and serves the SPA fallback for unknown paths under `/gg/*` (deep links). **The small world app is untouched** — no nginx changes, no sw-dev code changes; the only sw-side artifact is the running container. Same origin ⇒ no CORS; client served under `/gg/` (Vite `base: '/gg/'`), WS endpoint `/gg/ws`. One container = static + WS + sim. Deploys: image built from the gungame repo, `docker compose` on the box via `dream-runner` SSH; atomic client+server+protocol (protocol-version hello force-reloads stale tabs). Cold deep-link test: fresh browser → `dev.sml.world/gg/r/:roomId`.
- **Neighbor contention (accepted, measured):** the box also runs LiveKit, PostHog/ClickHouse/Kafka, preview instances, builds. 12-player rooms are light; the Phase 2 on-box bench is the honest check. Cloudflare WS idle timeout (~100 s) is moot at 64 Hz; the 5-min empty-room reaper closes idle sockets anyway.
- **Conditional 5b (only if 2b adopts WT):** direct UDP port on the box (UFW opening documented; contends with LiveKit UDP — measured in 2b's echo spike), DNS-only (grey-cloud) hostname for QUIC + in-process Let's Encrypt cert. Far simpler than the retired Fly design.
- **Deploys drain:** SIGTERM → fail readiness, typed `server-restarting` broadcast, brief flush, close. Client: "server restarting — reconnecting…" on typed close; neutral "connection lost" otherwise. Rooms end at deploy: accepted for v1.
- Rooms: quickplay = fullest non-full room of either mode; none → create **default: Gun Game, CLASSIC ladder, standard gravity**. **Room creation (the path to every non-default config):** the name-entry screen has two actions — **Play** (quickplay) and **Create room** (mode picker: Scoutzknivez / Gun Game; for Gun Game: ladder CLASSIC/ARSENAL + gravity variant — the picker defaults gravity to scoutz when ARSENAL is selected, a taste pairing, freely changeable) which creates the room and shows its shareable invite link. The `create` request rides the join hello; the picker UI ships in Phase 4's menu work, and Phases 2–3 create non-default rooms (incl. ladder) via URL query params (dev path, documented). Invite links reference the room by id (config lives server-side, immutable); full → "quickplay instead?". **Map follows mode** (the vertical scoutz map / the gun-game arena — 2 maps, 2 modes; rotation is post-v1). Empty rooms die after 5 min. No DB.
- Ops: `/gg/healthz`, tick p95 + room count to logs.

### 3.5 Modes & combat

- **Exactly two mode configs** over shared hooks. No registry.
- **Scoutzknivez:** scout + knife, scoutz preset, TDM to 50, 2 auto-balanced teams, respawn 2 s.
- **Gun Game:** FFA; ladder chosen at room creation (immutable, like all config): **CLASSIC** (pistol → SMG → shotgun → rifle → scout → knife) or **ARSENAL** (Amendment A1, owner directive 2026-07-18; full design + rationale in docs/arsenal-ladder.md): Sidewinder (3-tap pistol) → Boomstick (20-pellet double shotgun) → Arc (continuous tracking beam) → Peacemaker (rocket: projectile, 3 m splash, knockback, self-knockback ON — rocket jumps unlock at tier 4) → Discus (fast flat disc, direct-hit bonus — the airshot tier) → Longshot (heavy one-shot rail) → Goldie (one-shot pistol, ONE round + 1.2 s reload) → The Bar (melee finish). Melee-kill demotes the victim one tier on both ladders; first final-tier melee kill wins. Standard gravity default; scoutz-gravity variant at creation.
- **A1 minimal projectile system** (the one scope add; everything else in ARSENAL is existing hitscan/melee machinery): server-simulated projectiles as replicated entities (existing create/delete/generation bits), client predicts only its OWN projectiles (spawn locally, reconcile on snapshot), splash damage with falloff + knockback as a velocity add into pmove (this is what makes rocket jumps real). Projectiles do NOT use lag-comp rewind (they live in server time; hitscan keeps the rewind path). One archetype, two tunings (rocket arc vs disc speed). Contract completions (A1 audit fold): (a) projectiles despawn on impact, kill-volume entry, or max lifetime (dial); owner-death/disconnect policy and posthumous-kill ladder advancement are Phase 3 rule deliverables alongside the late-joiner rule; (b) live projectiles are bounded per player (hard cap dial); they count against the §4 snapshot budgets, and the mean ≤400 B assertion is RE-RUN at Phase 3 exit under a projectile-combat netsim workload (combat-bot bench includes an ARSENAL room); (c) own-projectile prediction INCLUDES detonation against world geometry and the self-knockback impulse, replayed in reconciliation like any predicted velocity change (server authoritative for all damage) — predicted projectiles are matched to their replicated entities by (owner, fire cmd seq); (d) self-damage scalar is a weapons.ts dial; the suicide rule (demote/no-advance/killfeed) is a Phase 3 rule deliverable. Phase 6's re-verification excludes intentional impulse events (knockback) from the correction-magnitude metric or accounts for them separately. All damage/speed/splash/knockback values are dials in `shared/weapons.ts`.
- Phase 3 rule deliverables: late-joiner level (level 1 vs trailing parity — decide in-phase), team rebalance on leave, AFK 30 s, reconnect per §2, map fixed per room, win → restart same map.
- CLASSIC and scoutzknivez weapons all hitscan; melee (1.6 m cone) is carried as a secondary on BOTH ladders (the demote rule requires it always available); ARSENAL tiers 4-5 per A1. damage/ROF/splash/knockback in `shared/weapons.ts` (Phase 3 issue; Discus direct-hit radius is a dial); scout = 1-shot torso/head, slow ROF, zoom-accuracy model.
- **Flick test (Phase 3 exit — the transport verdict's combat confirmation), defined oracle:** scripted shooter bot — **itself strafing at 6 m/s, so the eye-interpolation term of the fire contract is exercised** — replays a recorded 200 ms/±40° flick trace against a target strafing 8 m/s at 20 m, firing (with `fireFraction`) the frame the crosshair crosses the target's client-side interpolated position; 200 trials per profile at the gate's impairment settings, exercising the 7-tick interp ceiling. **Pass: ≥95% of client-view-on-target shots register server-side; 0% register in the false-positive arm (trace fires 100 ms after the target vacated).**

### 3.6 Game feel (owner directive: feel-first, no theater)

The fun lives here; everything below is Fable-owned (taste surface), constants in `shared/feel.ts`, all tunable in the Phase 1 playground.

- **Input truth:** Pointer Lock with `unadjustedMovement: true` (raw, no OS accel); sensitivity in **cm/360**; zero camera smoothing, ever. **Input decoupled from tick:** view rotation sampled and applied per render frame (aim is never 64 Hz-quantized at 144 Hz displays); sim consumes accumulated angles per tick; **fire carries `fireFraction`** so the server reconstructs your exact click — your eye mid-tick (`fireFraction`), the target where you saw it (latched interp target) — flicks land where you clicked, CS2-subtick-style. For firing cmds the §3.2 latched-angle contract is normative.
- **Movement feel:** HUD speed readout (m/s); **bhop jump-buffer window** (default: jump queued ≤80 ms before landing — forgiving, not auto; a dial, not a constant); landing dip (camera-only, ≤2°, ~60 ms); subtle Quake-style strafe roll (~0.8°, off/on toggle); speed-scaled wind audio so velocity has a sound; FOV configurable 90–120.
- **Combat feel:** damage-pitched hitmarker audio, distinct headshot and kill-confirm sounds, directional damage indicator, snappy zoom lerp with honest quickscope timing, instant-read tracers/impacts.
- **Restraint defaults (the no-theater clause):** zero screen shake, zero view/walk bob, no hit-slowdown, no kill-cam interruption. Every feel feature passes one test: does it make inputs feel more truthfully connected to the world? If it only makes the screen busier, it dies.

## 4. Performance & quality budgets

| budget | target | enforced how |
|---|---|---|
| snapshot datagram | ≤ 1,100 B ceiling (both transports; runtime = session `maxDatagramSize` on datagram channels) | unit test (hard gate) + runtime serializer |
| snapshot mean (12p, netsim workload) | ≤ 400 B | netsim CI assertion (hard gate) |
| client bandwidth down | ≤ 30 kB/s datagram path (UDP payload); ≤ 33 kB/s WSS steady-state (TCP payload/TLS record); kB = 1,000 B | netsim byte counters, boundaries per §3.2 (headroom above payload covers per-packet overhead only — thin by design; the counter is the arbiter) |
| replay determinism (Node) | bit-exact | unit test (hard gate) |
| cross-engine divergence | < snap threshold (Chromium/FF/Playwright-WebKit) | Playwright test, Phase 2 |
| bundle (gzipped, sans maps) | < 3 MB | size-limit (hard gate) |
| server tick | per-room p95 < 4 ms AND aggregate p95 < 9 ms | CI bench trend-only (2× smoke); hard numbers on the dream server at Phase 2, 3 & 6 exits |
| client frame | ≥ 120 fps M-series 1440p; ≥ 60 fps Iris-Xe/M1-Air 1080p; both backends | manual, Phase 6 |
| cold load → in-game | < 5 s, throttled 50 Mbps, cold cache, incl. map, to first controllable frame | scripted throttle check, Phase 6 |
| playability | gate thresholds (§3.2) on both impairment profiles | netsim gate (Phase 2) + WAN confirm + flick test (Phase 3) |
| tunneling | none at 30 m/s vs 0.1 m walls | sim unit test (hard gate) |

12-player load: synthetic fixtures + headless bots (Phase 2; combat-capable in Phase 3).

## 5. Risks

1. **Netcode is the project.** No library saves us. Mitigation: phase-gated first, packet-level netsim day one, canonical pattern, adversarial audit loop until clean (ledger §9).
2. **Feel risk.** Phase 1 playground + owner sign-off gate; swept collision + sub-tick fire spec'd up front because both are feel-critical and miserable to retrofit.
3. **WS head-of-line at the test point.** One-slot policy spec'd; WT is the evidence-gated escape. If 2b activates: WT server stack for Node is the declared unknown (evaluate @fails-components/webtransport vs alternatives) + on-box UDP echo spike; "well-lit path" doesn't extend into 2b.
4. **Solo-content trap.** 2 maps, 14 weapon configs across both ladders (models shared where honest — A1 raised this cost knowingly), CC0 bases, one style, greybox until Phase 4. (Content is Fable-owned; code throughput is the Codex lane.)
5. **Style commitment.** Bake-off before texture/lighting investment; brutalist priced honestly.
6. **Shared-box contention** (LiveKit/ClickHouse neighbors on dream). Mitigation: Phase 2 bench runs on the target box; admission limit derived there; v1 is a dev deployment by design.

## 6. Phases (each = child issue with checkboxes)

- [ ] **Phase 0 — Scaffold** (S): pnpm monorepo, strict TS, CI (typecheck, test, size-limit), README architecture sketch. Exit: `pnpm dev` serves a cube; sim package with one passing replay test.
- [ ] **Phase 1 — Movement playground** (M): full pmove (swept collision + tunneling test), map pipeline v1 (export script, gameplay blob, CI validator), first-person camera + §3.6 input path (raw pointer, cm/360, render-rate sampling), dev panel (movement params, feel constants, bhop dial, speed readout, draw-call counter). Static host (Cloudflare Pages) for the playground URL. **Exit: owner signs off on scoutz feel.**
- [ ] **Phase 2 — Netcode core** (L): protocol package (FSM incl. resync state, versioned hello, epochs/delta/ack, forward-sliding cmd acceptance, `lastProcessedCmdSeq`, generations, repeated events, parser limits + Origin + rate caps), server tick loop + rooms, WS one-slot channel, prediction/reconciliation (render-offset + wall test + stall-recovery test), interpolation pins, pacing, packet-level netsim + bots + fixtures, cross-engine divergence test, 2-browser localhost play. **Exit: decision-table verdict recorded with metrics; staging deploy on the dream server + real-WAN confirm; hard CI gates green; tick numbers on-box.**
- [ ] **Phase 2b — WebTransport** (M, conditional): WT server-stack spike + datagram congestion/drop policy, dev-cert tooling, cmd redundancy on. **Exit: on-box UDP echo over WAN passes; decision table re-run on WT passes; if activated after Phase 3 (flick-test flip), the flick oracle is also re-run on WT.**
- [ ] **Phase 3 — Combat** (L): lag comp (400/300, generation-aware, clamp-overflow + forged-input tests), 6 weapons, damage/death/respawn, hit feedback (§3.6 combat feel), both modes, join/leave/AFK/reconnect (token contract §2), name validation, scoreboard/killfeed, win/restart, combat bots. **Exit: full matches completable; flick-test oracle (§3.5) passes both profiles; aggregate bench re-run with combat bots, admission limit revised; owner sign-off.**
- [ ] **Phase 4 — Content & polish** (M, → L if brutalist wins): RenderStyle bake-off → style committed; 2 maps through pipeline; viewmodels; SFX (incl. §3.6 audio); HUD/menus; name picker + **Create-room mode/variant picker (per §3.4)**. **Exit checklist: zero placeholders, style committed, maps pass validator, screenshots on both backends.**
- [ ] **Phase 5 — Deploy & rooms** (M): production container on dream (the Cloudflare→Traefik→container route is already **staged** by the Phase 2 exit deploy; Phase 5 **productionizes** it — drain-on-SIGTERM, `/gg/` base path, redirect + SPA fallback), quickplay + invite links + full-room path + Create-room picker wiring, cold deep-link test at `dev.sml.world/gg/r/:id`, `/gg/healthz` + metrics. **5b conditional (exit: WT reachable on the box's UDP port with valid certs + WS-fallback smoke).** Exit: **live at `dev.sml.world/gg`, stranger-joinable.**
- [ ] **Phase 6 — Hardening & playtest** (M): adversarial re-verification of Phase 2–3 validation surfaces (no new clamps belong here), perf passes (both backends, both hardware classes, on-box aggregate re-check), cold-load check, error reporting, cross-browser matrix (Chrome/FF/real Safari + 3 background-tab branches; a Safari-<26.4 WS-only row applies only if WT was adopted), scripted 12-client full-match of BOTH modes (reconnect/rebalance/win/restart), playtest ≥6 humans, burn-down. Exit: budgets green; playtest ≥4/5 "feels responsive".

Strict 0→3; 2b slots after whichever gate flips the verdict (Phase 2 gate or Phase 3 flick test); 4/5 interleave; 6 last.

## 7. Success criteria (v1 done)

1. Stranger opens `dev.sml.world/gg`, types a name, playing in <5 s.
2. Both modes end-to-end with 12 players (bots + humans).
3. All §4 budgets green.
4. Owner scoutz-feel sign-off.
5. MIT repo, documented; sim/protocol stand alone as the missing open JS FPS-netcode reference.
6. `docs/process-ledger.md` complete enough to write the blog post from.

## 8. Open questions (pinned)

- RenderStyle — Phase 4 bake-off. • Gun-game late-joiner level — Phase 3. • Team-shuffle cadence — Phase 3. • (Name and hosting: resolved — gungame at dev.sml.world/gg.)

## 9. Audit round ledger

| round | auditors | verdicts | disposition |
|---|---|---|---|
| 1 (rev 1) | 3× parallel Claude (netcode/delivery/no-nonsense) | REVISE ×3 (34 findings) | folded → rev 2 |
| 2 (rev 2) | Codex xhigh (tmux `codex-airshot-r2`, 172,948 tok) + cold Fable | BLOCK (3B/21M/4m) / REVISE (1M/6m) | 35→30 unique: 26 folded, 3 trimmed (overthinking guard), 1 simplified away → rev 3 |
| 3 (rev 3) | fresh pair (`codex-airshot-r3`, 116,609 tok) | REVISE (4M/2m) / REVISE (1M/5m) | 12→10 unique, all folded → rev 4 |
| 4 (rev 4) | fresh pair (`codex-airshot-r4`, 103,909 tok), severity valve | REVISE (5 blocking) / REVISE (1 blocking + 2 fold-fidelity) | 8 blocking (epoch/resync FSM; cmd seq-tick contract + forward-sliding window [both auditors]; clamp degradation contract; flick oracle; reconnect-token contract; 2 FF survivors) + annexes folded; PLUS owner fold: gungame rename, §3.6 feel-first, dream-server deploy → rev 5 |
| 5 (rev 5) | fresh pair (`codex-gungame-r5`) | **PASS** (Fable, 0 blocking, 3-item annex) / REVISE (Codex, 2 blocking + 5-item annex) | 2 blockers folded (sub-tick fire = latched-at-click contract with normative ray reconstruction; room-creation flow via Create-room action + dev query params) + both annexes folded (seq-ordered monotonicity evaluation; path-boundary Traefik matcher + /gg redirect + SPA fallback; 2b flick re-run clause; kB defined; Phase2-stages/Phase5-productionizes noted) → rev 6 |
| 6 (rev 6) | fresh pair (`codex-gungame-r6`) | **PASS** (Fable, 0 blocking, 7-item annex) / REVISE (Codex, 2 blocking + 3-item annex) | Codex B1 folded (sub-tick timebase unified: execution tick E; fireFraction = shooter eye only; latched interp target = target rewind only; strafing-shooter oracle arm). Codex B2 **REJECTED** (Prime adjudication: repo location `/Volumes/SD/gungame` is an explicit owner directive — own repo outside sw-dev; the "workspace contract" the auditor cited does not govern this repo). Both annexes folded (typed `room-create-refused`; map-follows-mode; invite-by-id wording; headroom figure dropped; §5 round-count wording; Safari-<26.4 row conditional; Phase 4 picker mirrored) → rev 7 |
| 7 (rev 7) | fresh Codex xhigh + fresh cold Fable | pending | loop closes on a clean pair |
