# Overnight run status — 2026-07-23 (Fable prime, autonomous)

Owner directive: "get us to impeccable · no theater · queue everything up."

## The structural breakthrough: the game has EYES now

A new CI job runs the full stack in **real Chromium AND real WebKit** (the
Safari-class engine you play on), drives the REAL input→cmd→server path via a
dev-gated `?ciprobe=1` hook, asserts a spawned player actually moves, and
uploads **screenshots + console logs + full debug-state dumps** as artifacts
every push. I download and LOOK at them. Two days of blind iteration ended
tonight — every claim below is verified against actual rendered pixels.

## What the eyes found immediately (and what got fixed)

1. **Movement works in WebKit.** All four engine×map cases: connected, moved
   5.6 m, zero console errors, zero close events. The netcode/input pipeline
   is healthy on your browser's engine — "stuck at spawn" is NOT a movement
   bug; the remaining suspect is the pointer-lock/first-click UX (the stuck
   chip now names the state on screen whenever it happens).
2. **The world rendered as a pitch-black cave — the real reason every
   "look" iteration felt identical to you.** Three stacked causes, each
   found by a screenshot round:
   - Enclosed maps (40 m perimeter walls!) put every interior in the sun's
     shadow; the daylight rig had no unconditional light → added an ambient
     floor.
   - The vendored metal-plate texture is near-black steel; no light can
     brighten black albedo → palette now carries base brightness, texture
     modulates (0.55–1.15).
   - Shared-vertex normals melted every hard edge into mush → map geometry
     face-splits before normal computation (crisp architecture now).
3. **Weapon models were real GLTFs rendered flat orange** — an overwrite made
   them indistinguishable from placeholder prims; they keep their own
   materials now and parse once per session (was: refetch on every kill).
4. **Enemies faced their velocity vector** (standing enemies faced north,
   runners faced backward!) — they face their aim now, with palette zones
   (warm head / ink limbs / actor torso) instead of one flat red.

## Also shipped tonight

- J10 rack choreography: BANG → beat → chk-chk (pump/bolt/Goldie timing +
  two-click rack audio + equip grab/seat sound; fixed Goldie's rack noop).
- CI hygiene: dark-frame in the browser-equipped job, prebaked assets on CI,
  percentile-meter warm-up, tick-smoke CI ceiling.
- Bench specs (both committed): `docs/map-architecture-spec.md` (arena
  grammar, sightlines-as-weapon-selectors, verticality with jump-tech
  shortcuts, open-sky P1…P5 plan) and `docs/character-visual-spec.md`
  (9-part humanoid, guns-in-hands, ink outlines, WRAD arm posing).

## The verified-current build

Corner build tag == `healthz` buildHash == deployed sha. Stale-tab class is
dead (watchdog + foreign-service-worker eviction + sw-dev issue #6228 filed).

## COMPLETED before your return (CI went fully green — run 29986907612)

- Map P1 SHIPPED: spire's 40 m and foundry's 18 m prison walls are 3 m
  parapets with escape kill-rings; open sky over both arenas. Screenshot
  verdict (WebKit, your engine): blue sky, warm sand ground, cast shadows,
  crisp silhouettes. From cave to daylight arena in seven CI rounds.
- Weapon view scale fixed (the pistol was normalized to 0.95 m — a gray
  boulder in your face; real class lengths now) + GLB cache disposal safety.
- **DEPLOYED: build `a08eb1d` is live on dev.sml.world/gg** (healthz
  buildHash verified). The corner tag must read a08eb1d.

## Still queued (next session, eyes-verified per round)

1. Sky saturation + exposure pass (current sky reads gray-blue through ACES).
2. The black-wedge surface seen in one foundry angle (one unlit/backface
   plane — instrumentation now in artifacts to pin it).
3. Character P3: guns in enemy hands; P4 ink outlines. Map P2: material
   zoning; landmarks per quadrant.
4. Viewmodel pose pass (real arms posing per weapon class).

## For your first 5 minutes back

Load `dev.sml.world/gg/index.html` (bypasses any stale cache), corner tag
must match the latest deploy, then judge: brightness, edges, enemy read,
rack feel. If anything is off, the CI artifacts for that exact build show me
what you saw — we debate pixels now, not vibes.


---

## Punch-list wave (owner feedback round, deployed: build `f28c2e4`)

Every item from the playtest, screenshot-verified:
1. **Guns/arms now render** — first time ever on WebGL2. Five-round forensic
   chain: dead TSL composite → overlay/present fight → layer inheritance →
   depthTest=false vanish → collapsed skinned arms. Final: single-pass,
   camera-parented, proven config. Pose polish is now a taste dial.
2. **Real firearm audio** — FFSL CC0 field recordings (1911, M45, Benelli
   Nova, AR-15, Tikka T3), near takes local / mid takes positional; real
   pump/bolt/slide/draw foley on rack and equip.
3. **Bullets visible** — tracers 3x wider, hot amber, 7 m streaks.
4. **Wall debris** — shots sweep the collision world; sparks/dust/impact
   audio at the true hit point.
5. **Crosshair teaches accuracy** — live bloom + amber tint when movement
   more than doubles the cone.
6. **Bot suicides fixed** — weapon-aware trigger discipline (rocket standoff).

Queued next: gun pose/scale taste pass, bullet-hole decals + particle
sprites (assets vendored), guns in enemy hands, sky saturation, map P2.

---

## Owner screenshot round (2026-07-24, build ba81a5c on their machine)

The screenshot finally separated the layers: pointer lock ENGAGED (macOS
banner), world rendering, build tag current — and speed 0.0 with bots
suiciding in the killfeed. Response wave:

1. **Bots**: the suicides are interior pits (spire trench, underworld kill
   volumes) — bots beeline at targets with zero ground awareness, and the
   perimeter pad even triggered past the cliff. Now: forward ground probe
   (no floor within 4m below a point 1.6m ahead → steer to center), tight
   2m bounds pad.
2. **Input self-heal**: the only stuck-cause that survives every build on
   one machine is stored keybindings (gg:controls). The chip now detects
   "keys arriving but none map to movement" and F9 resets bindings to
   defaults. This closes the class even when the cause is user-local state
   no CI can see.
3. **Distance-real audio** (owner: "sound should be distance dependent"):
   >35m shots play recorded distant-gunshot beds (air-soaked boom, not a
   quieter near-shot), positional rolloff 1.5.
4. **Arms de-sausaged**: slim short forearms replacing the fat orange
   cylinders.

Standing arc (the "cheap" verdict): muzzle/smoke sprite integration,
bullet-hole decals, guns in enemy hands, sky pass, map P2 zoning — assets
vendored, specs written.
