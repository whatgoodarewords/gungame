# Combat juice spec — concrete parameters (feel architect, 2026-07-20)

Bar: beat Deadshot/Krunker on movement, aiming, shooting, recoil, projectiles, splatter.
Register: **high-key cheerful-competitive** (art-direction.md register pivot — bright day
world, young audience, non-gore). Restraint clause holds: *mechanics, not theater* — every
effect below communicates game state (cadence, lane, surface, AoE, confirmation) or it was
cut. Juice that communicates state IS mechanics.

Hard constraints honored: 60 fps on UHD-600 Chromebook (everything instanced/pooled, zero
per-frame allocation), WebGL2 primary, camera kick is CLIENT-only presentation (server
spread stays authoritative, fire direction stays input truth), no screen shake beyond the
specced kick, no slow-mo / hit-stop time manipulation.

Conventions: `refire` quoted in ms (`refireTicks × 15.625`). "τ" = exponential time
constant; "recover-90" = time to 90 % recovery (τ ≈ recover-90 / 2.3). All new
per-weapon numbers are data added to `VIEWMODEL_HOLDS` / a new `CAMERA_KICKS` table —
no logic per weapon.

---

## J1 — Camera recoil kick (NEW channel; currently zero)

**Current:** `client/src/camera.ts:51` — `rotation.set(pitch - dip, yaw, 0)`; the landing
dip is the only camera-side motion. All recoil is viewmodel-only
(`precision-viewmodel.ts:244`), so firing reads as "the gun waggles while the world stays
nailed" — the single biggest gap vs CS/Deadshot gunfeel.

**Design contract (non-negotiable):**
- Kick is a **display-only offset** added at `camera.ts` render time:
  `rotation.set(pitch - dip + kickPitch, yaw + kickYaw, 0)`. It is NEVER added to
  `input.pitch/yaw`, never enters a `Cmd`, never touches the sim. Server spread stays the
  only accuracy truth. Mouse counter-control is automatic because input angles are
  untouched — the offset decays on its own and cannot fight the mouse.
- Honesty bound: semis fully recover before their next possible shot; autos plateau
  ≤ 0.35° under held fire (below the crosshair-gap the spread already displays), so the
  crosshair never lies by more than the bloom it already admits.
- Deterministic: no RNG. Lateral sign alternates by local shot index
  (`lateral × (shotIndex % 2 ? -1 : 1)`); vertical is a constant per shot.

**Apply curve:** 25 ms quadratic ease-out ramp to peak (≈1.5 frames @60 Hz, 3 @120).
Rationale: a 0-frame step aliases against frame cadence and reads as jitter, not punch;
25 ms is still perceptually "instant" (< the 40 ms fusion threshold) but samples cleanly
at both 60 and 120 Hz. **Recovery:** critically-damped exponential to zero (no overshoot
— overshoot is aim noise).

| Weapon | refire ms | kickPitch °/shot | kickYaw ±° | recover-90 ms | steady-state ° (held) | Rationale |
|---|---|---|---|---|---|---|
| Pistol | 240 | 0.55 | 0.10 | 110 | — (full recovery/tap) | Tap cadence: each shot a discrete punch, settled 130 ms before next |
| SMG | 85 | 0.20 | 0.06 | 70 | ≈0.21 | τ 30 ms ⇒ e^(−85/30)=0.06 carryover; plateau ≈ kick — spray stays honest |
| Shotgun | 820 | 1.50 | 0.20 | 160 | — | 8-pellet slug of damage; biggest classic-ladder thump, recovered in 1/5 of refire |
| Rifle | 110 | 0.28 | 0.08 | 80 | ≈0.29 | Slightly harder than SMG per shot (28 vs 20 dmg); plateau still < 0.35 bound |
| Scout | 1180 | 2.00 | 0.15 | 200 | — | Marquee 110-dmg shot must be felt; 200 ms recovery ≪ 1180 refire |
| Knife | 620 | 0 | 0 | — | — | Melee: wristFlick on the viewmodel carries it; camera kick on a swing = noise |
| Sidewinder | 220 | 0.50 | 0.10 | 105 | — | Pistol-class, headBonus identity — same tap language |
| Boomstick | 1050 | 1.80 | 0.25 | 180 | — | 20 pellets; loudest kick in the game short of Goldie |
| Arc | 15.6 (beam) | 0 | 0 | — | — | Per-tick beam: any kick integrates to drift; hum lives on the viewmodel |
| Peacemaker | 780 | 1.20 | 0 | 150 | — | Launcher: symmetric, no lateral (lateral on a rocket reads as inaccuracy) |
| Discus | 720 | 0.45 | 0.12 | 100 | — | Wrist-thrown; light, mostly lateral flavor |
| Deadeye | 920 | 1.70 | 0.15 | 180 | — | Between scout and rifle in role and in kick |
| Goldie | 1200 | 2.40 | 0.30 | 220 | — | 125-dmg golden one-shot: the ceremony gun gets the biggest kick |

**ADS multiplier:** scoped Scout/Deadeye ×0.45. Rationale: zoom FOV is `fov × 0.45`
(`main.ts:949`), which magnifies apparent angular motion ≈2.2×; ×0.45 keeps *apparent*
kick constant scoped vs unscoped instead of doubling it.

**Self-knockback juice (rockets):** on self-splash knockback event, inject
kickPitch = 1.2° with sign away from the blast vertical (up-blast pitches view up),
recover-90 220 ms, through this same channel. That is the entire "explosion shake"
budget — no random shake.

Implementation: `FpsCamera` gains `kick(pitchDeg, yawDeg, recoverMs)` + two scalars
decayed in `update()`; `main.ts` fire-presentation block (`main.ts:1007–1023`) calls it
alongside `viewmodel.onFire()`. Zero allocation.

---

## J2 — Viewmodel punch (retune + translation punch)

**Current:** `kickDeg` per weapon in `VIEWMODEL_HOLDS` (`client/src/viewmodels.ts:74–99`),
global `recoilDecayMs: 80` (`viewmodels.ts:111`), backpush only on Peacemaker
(0.04 m / 40 ms, `viewmodels.ts:93`), applied at `precision-viewmodel.ts:178,241,244`.

Changes (columns marked ● change; kickDeg cited from viewmodels.ts:74–99):

| Weapon | kickDeg now→new | backpushM ● | backpushMs ● | recoilDecayMs ● (was global 80) | Rationale |
|---|---|---|---|---|---|
| Pistol | 1.8 → **2.2** | 0.015 | 70 | 90 | 34-dmg tap deserves more snap than SMG-per-shot; 1.5 cm slide-back reads "action cycled" |
| SMG | 1.4 (keep) | 0.010 | 60 | 70 | Fast decay so 85 ms cadence shows discrete shots, not a smear |
| Shotgun | 5.0 (keep) | 0.035 | 120 | 120 | Already the right violence; add the shoulder shove |
| Rifle | 2.1 → **1.9** | 0.016 | 70 | 75 | Slightly under pistol per-shot; at 110 ms cadence 2.1 accumulated visibly above the honest plateau |
| Scout | 3.2 → **3.6** | 0.030 | 130 | 130 | Flagship shot; slower settle sells mass |
| Knife | 6.0 (keep) | 0 | 0 | 80 | wristFlickDeg 6 already carries the swing |
| Sidewinder | 1.8 → **2.0** | 0.015 | 70 | 90 | Pistol family |
| Boomstick | 5.0 → **5.5** | 0.040 | 130 | 120 | 20 pellets > 8 pellets, must out-thump Shotgun |
| Arc | 0 (keep) | 0 | 0 | — | humShakeM stays the identity |
| Peacemaker | 4.0 (keep) | 0.040 (keep) | 40 → **90** | 110 | 40 ms backpush is sub-perceptual; 90 ms makes the tube shove readable |
| Discus | 2.5 (keep) | 0.012 | 80 | 90 | Throw, not detonation |
| Deadeye | 3.2 → **3.4** | 0.028 | 120 | 130 | Scout family |
| Goldie | 2.2 → **4.5** | 0.032 | 120 | 140 | **Bug-tier mismatch today**: the 125-dmg one-shot has less punch than the pistol family. Ceremony gun. |

`backpush` uses the existing `sin(π·t)` shape (`precision-viewmodel.ts:200–203,241`) —
already correct. Per-weapon `recoilDecayMs` becomes an optional hold extra defaulting to
`VIEWMODEL_MOTION.recoilDecayMs`.

**Casing fix (same file family):** eject gravity 8.5 → **13** (`impact-visuals.ts:178`)
and up-velocity 1.65 → **2.1** (`impact-visuals.ts:132`). Rationale: 8.5 m/s² brass reads
moon-gravity next to the 20 m/s² player sim; matching ballistics sells the world.

---

## J3 — Muzzle flash

**Current:** point light ONLY — `precision-viewmodel.ts:100–103` (0xffb365, distance 2.4),
intensity 5.5 on fire (`:161`), decay τ 18 ms (`:179`). No visible flash geometry, no
remote-player flash. The light is invisible against the bright high-key world at range.

**Local flash (viewmodel layer 1):**
- Geometry: 2 crossed quads 0.14 × 0.14 m + a 0.05 m center disc, ONE mesh, parented to
  `weaponMount` at the existing light offset (0, 0.04, −0.62). One draw call.
- Material: `MeshBasicNodeMaterial`, **normal alpha blending, NOT additive** — additive
  flashes wash out to invisible against the 0x9ed2f5 sky. Color 0xffd977, opacity 0.9.
- Timing: full scale at frame 0, opacity 0.9 → 0 linear over **45 ms** (2–3 frames),
  then `visible = false`. Roll angle = shotIndex × 137.5° (deterministic, never repeats
  visibly, no RNG).
- Point light: KEEP the existing one (it lights the arms — art-direction §4), intensity
  5.5 → **4.0** (with the quad present, 5.5 double-counts). Chromebook cost: one point
  light with 2.4 m range is fill-bounded to the viewmodel region — acceptable; the F13
  low tier sets intensity 0 and keeps the quad.

Per-weapon flash scale multiplier (0 = no flash):
pistol 0.85 · smg 0.7 · shotgun 1.3 · rifle 0.9 · scout 1.1 · knife 0 · sidewinder 0.9 ·
boomstick 1.45 · arc 0 (beam glow is the flash) · peacemaker 1.3 (single grey launch puff
instead of star: one puff instance, life 0.3 s) · discus 0 · deadeye 1.2 · goldie 1.3
with color 0xffd76a (gold — brand).
Rationale: scale tracks payload (pellet count / damage), the same ladder players already
feel in audio gain (`audio.ts:40–54`).

**Remote flash:** instanced billboard quads (capacity 12, one InstancedMesh, world scale
0.22 m × per-weapon multiplier), spawned when a remote's `fireCmdSeq` advances; 50 ms
life, same material. **No lights for remotes** (n × point lights is the one cost class
the Chromebook cannot pay). Purpose: muzzle flash is how you locate a shooter — pure
mechanics.

---

## J4 — Tracers (rework — current ones are dead on daylight AND allocate)

**Current:** `main.ts:753–800`. Local `showAimTracer`: 1-px `Line`, `palette.accent`
color, `opacity 0.8`, removed via `setTimeout(40 ms)`; hit-confirm `showTracer`: 1-px
white / 0xffdd55 line + impact sphere, `setTimeout` 40/120 ms. Three problems:
(1) WebGL lines are 1 px — invisible at 1366×768; (2) white/additive-ish accents don't
read against the 0x9ed2f5 sky or 0xd6d0c2 surfaces; (3) **per-shot `BufferGeometry`
allocation + `setTimeout`** violates the zero-alloc rule (`main.ts:763,791`) — SMG at
11.7 shots/s is a GC drip in every fight.

**Replace both with one pooled instanced streak system** (`TracerSystem`, capacity 24,
one InstancedMesh of a 1 × 1 unit quad stretched per-instance; camera-facing around its
long axis):

| Param | Value | Rationale |
|---|---|---|
| Width | 0.022 m | ≈2–3 px at 15 m on 768p — visible, not a laser show |
| Streak length | 5 m (clamped to shot distance) | Long enough to read direction in one frame |
| Speed | 300 m/s | Fast enough to feel hitscan-instant (<0.1 s to 30 m), slow enough that the eye catches direction — the Deadshot/Krunker read |
| Lifetime | distance/300 s, hard cap 250 ms | Pool safety |
| Color | body **0xe25c12**, opacity 0.85, normal blending | Daylight answer: on a bright low-sat world, what reads is DARK + SATURATED + WARM. Cyan-on-dark is dead; white is dead; deep ember orange reads on sky, on 0xd6d0c2 stone, and on the 0xe0483e actors without matching any of them |
| Origin | muzzle world pos (viewmodel muzzle projected to world), not eye | Streak from eye center reads as a screen artifact |

Which weapons: every shot for pistol/smg/rifle/sidewinder. Shotgun/boomstick: **3 streaks
per shot** (of 8/20 pellets) with the server-seeded first 3 pellet directions —
communicates cone without 20-quad fill cost. Scout/Deadeye/Goldie: instead of a streak, a
**full-length lane beam**, width 0.035 m, alpha 0.9 → 0 over 90 ms — the sniper lane
must be readable to victims and spectators (counterplay = mechanics). Goldie beam color
0xffc23d. Arc: existing beam is the tracer. Knife/discus/peacemaker: none (projectile
meshes ARE the tracer).

Also fixes: delete `tracerMaterialPlain/Headshot`, `aimTracerMaterial`, both `setTimeout`
paths; hit-confirm no longer draws its own geometry (the local streak already covered the
lane; keep only the impact FX call).

**Discus trail** (`combat-visuals.ts:66–75`): color 0x8eeaff + `AdditiveBlending` is
invisible on daylight. Change to **0xe25c12, normal blending, opacity 0.8** (same ember
family — one projectile language).

---

## J5 — Impact language per surface + NEW decals

**Current** (`impact-visuals.ts`): one surface-blind recipe — 4 sparks (life 0.13 s,
speed 2.8–4.45, gravity −12 `:145`), 1 puff (life 0.18 s, opacity 0.32, scale
0.75→2.55 `:163–166`), light intensity 4 (`:116`). Surface color is passed but only
tints the puff (`main.ts:775–779`: scoutz 0xb9a98a, else 0x8997a1).

**Split into two surface profiles** (surface already known — same source as
`SurfaceMaterial` in `audio.ts:4` / `main.ts:993`):

| Param | METAL | STONE | Rationale |
|---|---|---|---|
| Spark count/shot | 6 | 2 | Metal rings and throws sparks; stone chips |
| Spark speed | 4.5–7.0 m/s | 2.5–4.0 m/s | Sparks are near-massless; chips are heavy |
| Spark up-bias | +1.8–3.0 | +1.2–2.0 | |
| Spark gravity | −14 | −18 | Chips fall like gravel |
| Spark lifetime | 0.22 s | 0.28 s | Longer than today's 0.13 s — currently sub-perceptual at range |
| Spark color | 0xffd07a (keep) | 0xcfc4ae | Stone chips are stone-colored, not fire |
| Puff scale | 0.55 → 1.4 | 0.8 → 2.2 | Dust cloud is stone's identity, metal's is sparks |
| Puff lifetime | 0.14 s | 0.30 s | |
| Puff color | 0x9aa4ad | 0xcdbf9f | Warm dust reads on the high-key palette |
| Puff opacity | 0.25 (material const) | 0.32 (material const) | Two puff materials (one per surface) — per-instance alpha isn't worth a custom node here |
| Point light | intensity 3, 1 frame | none | Lights only where the fiction emits light. Pool of 4 stays (`impact-visuals.ts:81–86`); F13 low tier disables |

Spark capacity 64 → stays (6/shot × SMG 11.7/s × 0.22 s ≈ 16 live worst case per
shooter); puff capacity 24 stays.

**NEW — impact decals (bullet holes):** persistence is the cheapest juice per ms in the
genre and we ship none.

- One InstancedMesh, 8-gon disc geometry radius **0.055 m**, capacity **48**, ring buffer
  oldest-recycled (same pattern as casings, `impact-visuals.ts:19–36`).
- Placement: position = hit point + **8 mm** along surface normal; orientation = normal;
  roll = cursorIndex × 137.5°. Normal source: one `CollisionWorld` raycast per impact
  event (event-rate, not frame-rate — the sim BVH is already loaded; same helper F7 adds).
- Look: color **0x33302a**, opacity 0.5 material-const, normal blending, depthWrite off,
  `polygonOffset` on. Dark ink on the light high-key world — reads everywhere.
- Lifetime **12 s**; fade = over the last 2 s lerp instanceColor toward the surface tone
  0xd6d0c2 (visual fade without per-instance alpha), then hide.
- Rocket scorch: same system, second InstancedMesh, radius **0.9 m**, capacity **8**,
  lifetime 10 s, color 0x3a352c.
- Budget: +2 draw calls, 56 quads, zero per-frame allocation, ~zero fill (small quads).

---

## J6 — Hit-on-player language + kill moment (register decision)

**Decision: NO blood.** Register is bright cheerful-competitive for a school audience
(art-direction pivot; Shell Shockers' school-safe lesson in the teardown). Blood also
reads poorly on high-key and invites content filters. Language: **ember-confetti burst in
team/actor colors** — the same "state, not gore" trick as the egg game, but sharper.

**Hit burst (any confirmed damage on a player):** one shared InstancedMesh (BoxGeometry
0.04 m, capacity 96, ring buffer) — the "burst pool":
- 8 particles from the hit point, radial speed 3.0–5.5 m/s (deterministic golden-angle
  fan like `impact-visuals.ts:97`), gravity −10, lifetime 0.32 s, shrink to 0 over the
  last 40 %.
- Colors per particle (fixed pattern, no RNG): 5× actor red 0xe0483e, 2× white, 1×
  accent 0xff9042. Reads as "I chipped him" against every background.

**Kill moment — cost-ranked options:**
| Option | Cost | Verdict |
|---|---|---|
| (a) Current: 90° roll + 0.85 s fade + 0.28 m rise (`combat-visuals.ts:314–323`) | 0 | Reads as a glitch, not a kill. Insufficient alone |
| (b) **Pop burst + scale pop** (RECOMMENDED) | ~0 (reuses burst pool) | 22 particles from torso (speed 2.5–7 m/s, gravity −9, life 0.55 s, same color mix + 3× 0xffd76a gold), rig scales 1.0→1.15 over 70 ms then existing roll+fade shortened to **0.45 s**. Cartoon-clean, unmistakable at 40 m |
| (c) Ragdoll-lite single-impulse pose (art-direction §6) | M (rig work) | Phase 2 — do (b) now, layer (c) later; they compose |
| (d) Physics ragdoll | High + nondeterministic | Rejected — theater |

Victim-side (you are hit): keep the existing directional indicator
(`main.ts:1290–1298`, 350 ms) but extend to **450 ms** and add a 12 px red edge-gradient
bar on the hit side of the screen (DOM, no post). No vignette, no shake.

---

## J7 — Hit feedback timing + kill pop

Already sub-frame: events render the same rAF the snapshot arrives (`main.ts:1268+`),
hitmarker audio is damage-pitched (`audio.ts:184–186`). Tighten the visuals:

| Element | Current | Target | Rationale |
|---|---|---|---|
| Hitmarker visible | 120 ms `setTimeout` (`main.ts:1286–1288`) | **90 ms**, with scale 1.3→1.0 ease-out over 60 ms | 120 ms static X smears across SMG cadence (85 ms) — marker must fully cycle per shot to count hits |
| Headshot marker | same white X | rotate marker 45° + color 0xffd76a | Distinct silhouette = counted headshots without reading text |
| Crosshair hit flash | 60 ms color swap (`hud.ts:236–241`, #65d4ff `style.css:390`) | keep 60 ms, color → **0xff9042** | Cyan is the dead palette; accent orange is the new confirm hue |
| Kill pop | kill-flash color only | crosshair scale 1.0→1.35→1.0 over **120 ms** + kill-X 220 ms (exists `style.css:393–412`) | The micro-pop IS the kill punctuation. Crosshair-only — a viewmodel pop would read as a shot that didn't happen (F2 honesty) |
| Damage numbers | 400 ms rise (`style.css:434`) | keep; stack successive numbers +14 px | Working; don't touch |
| Hit-stop | none | **REJECTED permanently** | Netcode game; frozen frames = added latency = the one currency we never spend |

---

## J8 — Projectile feel (rocket / discus; no grenade in the table)

**Rocket smoke trail** — current: ONE lerped blob per rocket (`combat-visuals.ts:116–123`)
— reads as a comet head, not a trail.
- Ring-buffer emitter: spawn 1 puff per rocket per **35 ms** of flight (25 m/s ⇒ 0.87 m
  spacing — a dashed rope, exactly readable). Capacity **64** (4 rockets × 13/s × 0.5 s
  life ≈ 26 live, 2.4× headroom). Reuses the existing `smokePuffs` InstancedMesh
  (`combat-visuals.ts:78–88`) — zero new draw calls.
- Puff: scale 0.3 → 0.9 over life 0.5 s, drift +0.3 m/s Y, color **0x8f9299**
  opacity 0.3 (mid-grey is the only value that reads on BOTH 0x9ed2f5 sky and 0xd6d0c2
  ground).
- Rocket flight light: keep pool of 4 (`combat-visuals.ts:91–96`) at intensity 2.2; F13
  low tier disables.

**Explosion (Peacemaker; Discus at 60 % scale):**
- Core flash: pooled sphere (×4), scale 0.5 → 3.0 over **130 ms**, color 0xfff3d0,
  opacity 0.9 → 0. High-key explosions are WHITE-hot, not orange-dark (current rocket
  puff 0x2a211b `impact-visuals.ts:109–113` is a Tron leftover — replace).
- Smoke: 6 puffs, life 0.45 s, color 0x8f9299.
- **AoE ground ring (mechanics, the star of this section):** pooled flat ring mesh (×4),
  expands 0 → `splashRadius` (3.0 m Peacemaker / 1.55 m Discus — `weapons.ts:132,139`)
  over **220 ms**, opacity 0.55 → 0, color 0xffffff, laid on the ground (one downward
  raycast ≤ 2 m from blast point; skip ring if airborne blast). The ring shows the TRUE
  damage radius — players learn splash spacing by seeing it. Deadshot/Krunker ship
  nothing like it.
- Light: intensity 7 → **5**, 2 frames (`impact-visuals.ts:115–116`).
- Self-knockback: 1.2° directional camera kick via J1's channel (already specced there).

**Grenade:** no grenade weapon exists (`weapons.ts:91–153`). If one lands later: bounce
audio = `impactGeneric` sample at gains 0.30/0.20/0.12, playbackRate 1.0/1.15/1.3 for
bounces 1–3 (the hook `playSample(url, pos, gain, rate)` already exists,
`audio.ts:348–377`).

---

## J9 — Movement feel constants review (vs Q3 sources, teardown §5)

Unit conversion: 1 qu = 0.025 m ⇒ Q3 `g_speed 320` = 8.0 m/s, `JUMP_VELOCITY 270` =
6.75 m/s, `g_gravity 800` = 20 m/s², `pm_stopspeed 100` = 2.5 m/s.

Current `packages/sim/src/params.ts:10–17` scored against source:

| Constant | Ours | Q3 equiv | Verdict |
|---|---|---|---|
| friction | 6 | 6.0 | ✓ match |
| groundAccelerate | 10 | 10.0 | ✓ match (time-to-speed ≈ 0.1 s — not the "mushy start"; starts are fine) |
| airAccelerate | 1 (12 scoutz) | 1.0 / CS 12 | ✓ spec'd, keep |
| gravity | 20 | 20 | ✓ match |
| runSpeed | 6.4 | 8.0 (CS 4.8–6.2) | Deliberate teardown target ("MATCH speed") — keep |
| jumpVelocity | **5.3** | **6.75** (GoldSrc 6.7) | ✗ **"heavy" culprit #1** — see below |
| stopSpeed | **absent** | **2.5** | ✗ **"heavy" culprit #2** — see below |

**Finding 1 — missing `pm_stopspeed` (the mushy-stop bug).** Our `friction()`
(`step.ts:64–70`) decays speed purely proportionally — it is asymptotic and never
reaches zero: from 6.4 m/s you're still creeping at 0.28 m/s after 0.5 s, then drift for
another ~0.4 s. Q3 clamps the friction control value to
`control = max(speed, stopspeed)`, which makes deceleration LINEAR below 2.5 m/s —
full stop from 2.5 m/s in 0.17 s, crisp plant. Every Q3-lineage game has this; we
transcribed the accelerate half of pmove and dropped the friction half.
**Change:** add `stopSpeed: 2.5` to `MoveParams` (`params.ts`), and in `friction()`:
`const control = Math.max(speed, stopSpeed); newSpeed = max(0, speed − control·amount·dt)`.
Effort: 3 lines in the shared sim.

**Finding 2 — jump is 21 % lower than both ancestors.** 5.3 m/s ⇒ apex 0.70 m, hang
time 0.53 s. Q3/GoldSrc: 6.75 ⇒ 1.14 m, 0.68 s. Short hang time + correct gravity is
exactly the physical signature that reads "heavy". **Proposal:** `jumpVelocity 5.3 →
5.9` (apex 0.87 m, hang 0.59 s) — 60 % of the gap, keeps duck-jump clearances sane.
Note `AIRBORNE_UPWARD_VELOCITY 4.6` (`step.ts:23`) still < 5.9, so ground
categorization is unaffected.

**Prediction-parity caveat (BINDING for both findings):** `step.ts` is the shared sim —
client prediction and server step the same code, so the change is atomic in the repo,
BUT a rolling deploy where client and server run different builds mispredicts every
tick. Ship both constants in one release, version-gate the welcome config (server echoes
its `MoveParams`; F11's freeze-dials-to-room-config is the right home).
**Blast radius for jumpVelocity:** invalidates bhop-ghost records and changes gap/ledge
reachability on all four maps — needs a map-traversal audit + owner sign-off before
merge. `stopSpeed` has no such radius (only affects sub-run-speed decel) — ship it first.

---

## J10 — Weapon switch / equip / rack presentation

**Current:** `VIEWMODEL_MOTION` (`viewmodels.ts:102–117`): equipMs 140, equipStartDeg
−15, overshoot 0.1; rack: `rackMs 90` on Shotgun/Scout/Boomstick/Deadeye
(`viewmodels.ts:79–97`), triggered at fire instant (`precision-viewmodel.ts:159`),
Goldie is `rack:true` in configs (`viewmodels.ts:133`) but has `rackMs 0` in holds — the
rack no-ops (mismatch).

| Param | Current | Target | Rationale |
|---|---|---|---|
| equipMs | 140 | **140 (keep)** | Genre-fast is right; tier-up must never cost a fight |
| equipStartDeg | −15 | **−22** | At 140 ms, −15° barely reads; −22° makes the snap-up visible without lengthening it |
| equipOvershoot | 0.1 | keep | |
| Equip pose snap | silent | frame-0 pose at −22° + audio: tone 480 Hz/40 ms/gain 0.05 at t=0, thock 220 Hz/60 ms/0.06 at t=140 ms (via existing `tone()`, `audio.ts:407`) | Tier-up is the core loop; it needs a sound with a beginning and an end |
| rackMs — Shotgun / Boomstick | 90 / 90 | **220 / 240** | 90 ms is faster than perception; a pump you can't see is a pump you don't have. Refire 820/1050 ms has room |
| rackMs — Scout / Deadeye | 90 / 90 | **180 / 180** | Bolt, shorter than pump |
| rackMs — Goldie | 0 (broken) | **260** | Fix the mismatch; ceremonial break-action |
| rackDelayMs (NEW hold field) | 0 (racks during muzzle flash) | Shotgun 120 · Boomstick 140 · Scout 150 · Deadeye 150 · Goldie 200 | Sequencing: BANG → beat → chk-chk. Concurrent rack+recoil today mushes both into one motion |
| Rack audio | none | two clicks: 850 Hz/30 ms/0.04 at rack start, 620 Hz/30 ms/0.05 at start + 0.6×rackMs | The Deadshot d-bhop lesson: audio timing is a playable rhythm |
| Rack motion | z +0.045 m arc (`precision-viewmodel.ts:241`) | keep + add yaw tilt 4° during arc | One axis reads as slide; two axes read as a hand working the gun |

---

## Chromebook budget ledger (everything above, summed)

| System | Draw calls | Instances (cap) | Lights | Per-frame alloc |
|---|---|---|---|---|
| Camera kick | 0 | — | 0 | 0 |
| Muzzle flash local + remote | +2 | 1 + 12 | 0 new (reuses existing 1) | 0 |
| Tracer streaks + sniper beams | +1 | 24 | 0 | 0 (**removes** today's per-shot geometry+setTimeout allocs, `main.ts:763,791`) |
| Decals + scorch | +2 | 48 + 8 | 0 | 0 (raycast per impact event only) |
| Burst pool (hit+kill) | +1 | 96 | 0 | 0 |
| Explosion core + AoE ring | +2 | 4 + 4 pooled | 0 (reuses impact pool, intensity ↓) | 0 |
| Rocket trail | 0 (reuses smokePuffs) | 64 | 0 | 0 |
| **Total** | **+8** | | **0 new** | **net negative** |

Fits inside the ≤100-call Chromebook ceiling (teardown §6) — current scenes run well
under budget; +8 instanced calls is ~1 ms of fill worst case, and the F13 low tier's
only obligations here are: lights → 0, decal capacity 48 → 24.

---

## Ranking — feel-impact-per-effort (do in this order)

1. **J1 camera kick** — the biggest missing feel channel in the game; ~60 lines, data
   table, zero risk (display-only). This alone closes most of the gap to Deadshot gunfeel.
2. **J9-stopSpeed** — 3 lines in shared sim, kills the mushy-stop drift that reads
   "heavy" on every single stop. (Deploy-atomicity caveat applies.)
3. **J4 tracers** — current shot feedback is literally invisible on the live palette and
   allocates per shot; every bullet in the game starts reading. Medium-small.
4. **J3 muzzle flash** — light already exists; adding the quad is small and every shot
   gains a visual onset. Remote flashes add real information.
5. **J7 hit timing + kill pop** — CSS/DOM numbers, hours not days, and it's the
   confirmation loop players grind for.
6. **J6 burst pool** — one instanced system serves hit + kill; the kill moment goes from
   "glitch" to "event".
7. **J2 viewmodel retune** — almost pure data (fixes the Goldie flagship mismatch).
8. **J5 decals** — new system, medium effort, but persistence is the strongest
   subconscious "real game" signal we don't ship.
9. **J8 explosion ring + rocket trail** — arsenal-ladder only, but the AoE ring is a
   mechanics feature nobody in the genre has.
10. **J10 rack/equip** — polish tier, small, do with J2.
11. **J9-jumpVelocity** — highest single "heavy" payoff but owner-gated (map audit +
    ghost invalidation). Schedule the audit now, merge last.
