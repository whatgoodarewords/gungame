# Combat FX Reference — how the reference games actually do it

Mechanics, not vibes. Every section ends in a parameter table that maps
directly onto our systems: `client/src/impact-visuals.ts` (spark/puff/burst/
casing pools), `client/src/tracer-system.ts`, `client/src/audio.ts` +
`client/src/asset-manifest.ts`, `client/src/precision-viewmodel.ts` (muzzle
flash). Asset references point at `assets/vendor/`.

Reference set: CS:GO/CS2 and Battlefield for impact/tracer/casing mechanics,
TF2 and Valorant for the bright-stylized register (which is our register —
high-key daylight world, ember-confetti hit language, no gore).

Sources for the load-bearing claims: CS:GO weapon scripts (`TracerFrequency`),
Valve Developer Community (Source particle muzzle flash), Riot's "The State of
Hit Registration" dev post, CS2 decal behavior threads. Everything else is
frame-stepped observation reproduced across many teardowns.

---

## 1. Spray / tracer visual language

### What the reference games do

- **CS:GO/CS2** drive tracers from a per-weapon integer `TracerFrequency`:
  `0` = never (both silenced guns, M4A1-S / USP-S, when suppressed), `1` =
  every bullet, `2` = every 2nd, `3` = every 3rd (e.g. MP7). Rifles and SMGs
  ship at 2–3. **Not every bullet leaves a line** — during a 10-round AK
  spray you see 3–4 streaks. That sparseness is what makes sprays read as
  "gunfire" instead of "laser".
- Tracers in CS are client-side cosmetic lines fired **from the muzzle to the
  actual server hit point**, so the tracer never lies about where the bullet
  went — only about how many bullets there were.
- Tracer geometry in CS/BF is thin and *fast*: the streak crosses a 20 m
  engagement in well under 100 ms. It reads as direction, not as a projectile
  you could dodge.
- **Valorant** tracers render for every bullet but are deliberately low-fat:
  short lifetime, thin core with a soft glow, and the muzzle flash keeps a
  fixed base shape/scale (skins are not allowed to enlarge it — competitive
  visibility rule). Riot's hit-reg post: the client shows muzzle flash +
  tracer at the earliest **one frame after** the fire input — instant flash,
  tracer allowed to be a frame late. Nobody notices the tracer's frame of
  latency; everybody would notice a late flash.
- **Battlefield** uses true projectiles; every round gets a glow streak after
  the first few meters (a "no tracer near the muzzle" dead zone, so the flash
  and the tracer don't stack into a blob). Real belts are 1-in-5; BF renders
  more often because readability beats realism.
- **Muzzle smoke accumulation during sustained fire** (CS2 and BF both):
  individual shots make almost no smoke; a *burst* leaves a hanging haze.
  Implementation pattern is a wisp emitted every N shots (not per shot) with
  a hard cap on live wisps, each drifting up and slightly downwind, living
  ~0.6–1 s. After a 20-round mag dump you should see 3–5 overlapping wisps
  loitering at the muzzle for about a second.

### Parameters for us (`tracer-system.ts`, `precision-viewmodel.ts`)

Current state: every shot spawns a tracer, WIDTH 0.065, SPEED 300 m/s,
MAX_STREAK 7 m, hot-amber 0xffb136, no smoke accumulation.

| Param | Value | Notes |
|---|---|---|
| `tracerEvery` (own hitscan weapons) | pistol/sniper 1, rifle 2, SMG 3 | Per-weapon int, CS model. Sniper always traces (single loud event). Keep a shot counter per weapon, `shotIndex % tracerEvery === 0`. |
| `tracerEvery` (remote players) | 1 | Enemy fire is threat information; never thin it out. Optionally halve width instead. |
| Width | 0.065 own / 0.05 remote | Own value is calibrated (0.022 was invisible — CI-eyes r7); don't shrink own. |
| Speed | 300 m/s (keep) | Reads hitscan-instant at our map scales, eye still catches direction. |
| Streak length | 7 m (keep) | |
| Muzzle dead zone | 1.2 m | Start the streak 1.2 m out from the muzzle so flash + tracer don't stack (BF pattern). Clamp: `min(1.2, distance * 0.3)`. |
| Tracer spawn latency | same frame as flash is fine | Valorant tolerates +1 frame on tracer only; we already spawn same-frame, keep. |
| Smoke wisp cadence | 1 wisp per 4 shots within a 2 s window | Only during sustained fire; single taps stay clean. |
| Wisp sprite | `kenney-particle-pack/smoke_01..10` random | Normal blending, opacity 0.22 peak, tint 0x8a8378 (warm grey — additive white washes out on our sky). |
| Wisp motion | rise 0.30 m/s, drift 0.1 m/s lateral, scale 0.12 m → 0.34 m | Life 0.8 s, ease-out alpha. |
| Live wisp cap | 4 per weapon | Ring buffer like every other pool; oldest reused. |

---

## 2. Wall hit, frame by frame

### Anatomy in CS2 (frame-stepped; Battlefield matches with more dust)

| Time | What happens |
|---|---|
| Frame 0 (0 ms) | **Decal is already there.** Impact particle system spawns same frame: 2–6 sparks + dust puff. Nothing about the impact is deferred — latency here is read as "my shots don't register". |
| 0–50 ms | Sparks fly along the **reflection vector** (incoming dir mirrored on surface normal), cone half-angle ~30–40°, killed by gravity + short lifetime. On metal: more sparks, brighter, faster. On concrete: fewer sparks, more chips (dark chunky particles, ballistic arcs). |
| 0–400 ms | Dust puff: spawned 3–6 cm off the surface along the normal, drifts *away from the wall* and slightly up, expands 2–3×, fades. Concrete puff is the surface's own color (we already tint by `surfaceColor` — correct, keep). Dirt: bigger, slower puff. Metal: almost no puff. |
| 0–1.5 s | On dirt/rare concrete hits, 1–3 debris chips bounce on the floor (ballistic, one bounce, then gone). |
| Sound, t=0 | Layered: sharp **crack** transient (weapon-agnostic) + **material chip** layer (concrete crunch / metal ping / dirt thud) + **ricochet whine** on roughly 1-in-7 hits (~15%), metal biased higher (~25%), dirt near zero. |
| Persistence | Decal stays. CS:GO kept decals until the 4096 engine budget (`r_decals`) or round end — effectively **dozens of holes per sprayed wall**, and reading your spray pattern off the wall is a core skill. CS2 added automatic lifetime (fade after tens of seconds) but still keeps whole spray patterns visible. |

Key perceptual facts: the decal at frame 0 carries most of the "my bullet hit
*that exact spot*" signal; the sparks carry energy; the puff carries material;
the chip *sound* carries surface identity better than any visual.

### Parameters for us (`impact-visuals.ts` + a new decal pool)

Current state: 4 sparks (always up-biased — not normal-aligned), 1 tinted
puff, 1-frame point light, **no decals at all** (`oga-bullet-decal/
bullet_hole.png` is vendored but unused), impact sound is weapon-keyed not
surface-keyed.

| Param | Value | Notes |
|---|---|---|
| **Decal pool** | 128 instanced quads, LRU ring | New system, biggest single win in this doc. InstancedMesh, one draw call, same pattern as the existing pools. |
| Decal spawn | frame 0, position = hit point + normal × 0.005, oriented to normal, random roll 0–2π, size 0.055–0.08 m | Random roll + size makes one texture read as many holes. |
| Decal texture | `oga-bullet-decal/bullet_hole.png`; bake 2–3 variants from `oga-damage-decals/details/details.xcf` later | Tint darker on concrete (multiply 0.85), near-black rim on metal. |
| Decal fade | opaque 45 s → fade to 0 over 15 s, or reused earlier by LRU | CS2-style: spray patterns stay readable for the whole fight that made them. |
| Rocket scorch | same pool, `kenney-particle-pack/scorch_01..03`, size 0.9–1.3 m | |
| Sparks | count 3 (concrete) / 6 (metal) / 1 (dirt), initial dir = `reflect(dir, normal)` + random cone 35° | Replace the current fixed up-bias: pass surface normal + shot dir into `impact()`. Life 0.13 s keep; metal life 0.22 s. |
| Chips (concrete/dirt) | 2–3 particles, reuse `bursts` pool tinted `surfaceColor` × 0.6, ballistic, life 0.5 s | Cheap: it's the existing ember pool with a dark tint. |
| Puff | keep current (tinted, 0.18 s) but spawn at `point + normal * 0.05` and drift along normal 0.4 m/s instead of straight up; dirt life 0.35 s, metal skip | Prompt-accurate CS/BF behavior; needs the normal plumbed through. |
| Light | keep 1-frame flash; metal intensity 5, dirt 2 | |
| Sound: crack layer | keep current weapon-keyed `playImpact` transient at gain 0.5 | |
| Sound: material layer | concrete: `freesound-cc0-combat-impacts/impact-concrete-chip-1, impact-stone-rubble-2, impact-stone-debris-3, impact-gravel-falls-4`; dirt/sand: `impact-dirt-thud-1/2, impact-sand-hard-3, impact-sand-heavy-4`; metal: `kenney-impact/impactMetal_heavy_000` + ricochet set | Random pick, pitch 0.92–1.08, gain 0.65, positional. 4 variants per surface = no machine-gun repetition. |
| Sound: ricochet whine | probability 0.15 (concrete), 0.25 (metal), 0.0 (dirt); pool: `ricochet-metal-rifle-3, ricochet-metal-4, ricochet-22-whine-5, ricochet-whine-6, ricochet-bullet-7` + the 3 existing in `freesound-cc0-weapon-foley` | Delay 30–60 ms after the chip layer (the whine is the bullet *leaving*, not arriving). 8 variants total now vendored. |
| Sound: flyby | when a remote shot's ray passes within 2 m of the local camera: `flyby-bullet-3, flyby-whizzby-4, flyby-ricochet-whiz-5, flyby-bullet-crack-6` + the 2 existing | Supersonic crack for rifle/sniper (`flyby-bullet-crack-6`), soft whiz for pistol/SMG. Complements the existing synth near-miss in `audio.ts` (`NEAR_MISS_DIALS`) — sample first, synth fallback, like every other sound. |

---

## 3. Shell casing behavior

### What the reference games do

- Ejection is **right + up + slightly back** relative to the weapon, ~1.5–2.5
  m/s, plus the shooter's own velocity, with violent tumble (10–25 rad/s).
  The arc is ballistic and short — casings land within ~1.5 m.
- **The first floor contact plays the tinkle.** This is the single
  highest-value feel item in the whole casing system; CS's brass sound on
  concrete is iconic. Later bounces are silent or much quieter (CS plays only
  the first; BF plays up to two).
- Bounce restitution ~0.3–0.45 with random horizontal scatter on the bounce
  (casings never bounce straight up), then a quick settle and despawn: CS:GO
  fades brass out after a few seconds; TF2 keeps them ~3–5 s.
- Pitch/variant randomization is mandatory — an SMG dumps 20+ casings in two
  seconds and one repeated sample turns into a sewing machine.

### Parameters for us (`impact-visuals.ts` casings + `audio.ts`)

Current state: 32-pool boxes, eject velocity (±cos/sin yaw × 1.7, +1.65 up),
gravity −20, life 0.72 s, spin from life, **no floor collision, no bounce, no
sound** — casings currently sink through the ground mid-flight.

| Param | Value | Notes |
|---|---|---|
| Eject velocity | right-vector × (1.6–2.4 rand) + up × (1.4–1.9 rand) + back × 0.3, plus player velocity × 0.5 | Needs the weapon right vector, not just yaw; add ±12° jitter. |
| Angular velocity | random axis, 12–24 rad/s, fixed per casing at spawn | Current life-derived spin looks uniform; store an axis+rate per slot. |
| Gravity | −20 m/s² (keep — reads snappy) | |
| Floor collision | on `y <= floorY + 0.02`: `vy = -vy * restitution`, `vx,vz *= 0.6`, restitution 0.32–0.45 rand | `floorY` from the same ground query the player uses; flat-floor assumption is fine for arena maps. |
| First-bounce sound | one of `casing-brass-concrete-1, casing-30cal-bounce-2, casing-bounce-various-3, casing-shotgun-shell-5` (shotgun weapons use `casing-shotgun-shell-5 / casing-shotgun-eject-6`), pitch 0.85–1.2, gain 0.32, positional, **first bounce only** | Flag per slot: `bounced`. These files contain multiple takes — assign random in-file offsets or pre-slice at build time. `casing-handful-4` is the "many shells" texture for kill-cleanup or reload-dump moments, not per-casing. |
| Second bounce | restitution again, no sound (or gain 0.08) | |
| Despawn | life 2.2 s total, scale-out over the last 0.3 s | 0.72 s is too short to ever see a casing land — the tinkle needs the casing to visibly arrive. Pool of 32 still covers SMG at 2.2 s life (audit: 15 rps × 2.2 s = 33 ≈ capacity; bump to 48 if SMG ROF exceeds this). |
| Sound throttle | max 1 casing tinkle per 70 ms globally | Full-auto floors otherwise clatter into noise. |

---

## 4. Kill / death moment (bright-stylized register: TF2, Valorant)

### What communicates "dead" instantly in the references

1. **Silhouette change within ~100 ms.** TF2: ragdoll (or gib) replaces the
   animated model same-frame. Valorant: the body drops instantly and the
   living-enemy outline/highlight disappears. The living silhouette must
   never keep walking even one frame after the kill is confirmed.
2. **A burst effect at the body, colored to read on the palette.** TF2 gibs /
   Valorant's dissolve flash. Ours is the ember-confetti pop
   (`hitBurst(kill=true)`, 22 particles, victim-colored) — right language,
   correct register (bright, no gore).
3. **A sound that is *yours*.** Valorant layers a distinct high, short
   confirm sting for the killer that nobody else hears, on top of the world
   death sound. TF2 equivalent: the kill feed *plus* class death scream. The
   private sting is the strongest "you did it" channel — it cuts through a
   firefight where the visual might be smoke-covered.
4. **Kill feed entry within ~250 ms** (UI channel, redundant with 1–3 — kills
   read even when the victim is off-screen).
5. **A brief spatial marker.** TF2 ragdolls persist ~10 s; Valorant
   corpses persist through the round. Players use bodies for information
   ("someone died here"). A full corpse system is optional for us — a
   ground-projected team-colored fade patch (2–3 s) buys 80% of the signal.

### Parameters for us

| Param | Value | Notes |
|---|---|---|
| Kill pop | keep 22 particles, bump kill light: reuse an impact `PointLight`, victim color, intensity 6, 2 frames | The pop currently has no light — on our daylight map a 1-frame colored flash is what makes it pop at range. |
| Corpse/marker | victim-colored `kenney-particle-pack/circle_05` quad on the ground, 1.2 m, opacity 0.4 → 0 over 2.5 s | Cheap "someone died here" marker, no ragdoll needed. |
| Killer sting | two-note rising synth (recipe pattern already in `audio.ts`) or `kenney-interface` confirm at pitch 1.3, gain 0.5, **non-positional, killer only** | Distinct from the victim-side/world sound. Fires on server kill-confirm, not on client prediction. |
| World death sound | short body-drop: `impact-dirt-thud-1` pitch 0.8 + `casing-handful-4` first 300 ms at gain 0.15 | Positional at victim. The clatter tail is surprisingly good "dropped everything" foley. |
| Death (you died) | 150 ms desaturate + 4 px vignette pulse, then respawn UI | Valorant-style instant acknowledgement; no slow-mo. |
| Kill feed | ≤250 ms after server confirm | Already exists per hybrid-meta spec; hold the latency budget. |

---

## 5. Muzzle flash

### What the reference games do

- **TF2 / Source**: muzzle flash is a **2–3 frame animated sprite** (a
  flipbook that lives ~2 ticks ≈ 30–45 ms), composed of a star/cross card
  plus a bright core disc, with **random roll per shot** so consecutive
  shots don't stamp the identical star. High-ROF weapons (minigun) switch to
  a continuous looping flash instead of per-shot spawns. A 1–2 frame dynamic
  light accompanies it.
- **Valorant**: flash keeps a fixed base shape and scale per weapon
  (explicit competitive rule — skins may restyle but not enlarge or obscure).
  First-person alpha is tuned low so the crosshair never disappears; total
  life is 2–3 frames at 60 fps (~35–50 ms); slight scale jitter per shot;
  a one-frame point light; a faint smoke wisp on burst weapons only.
- Neither game lets the flash persist to the next shot at max fire rate:
  flash lifetime < shot interval, always — overlap turns autofire into a
  strobe lamp.

### Parameters for us (`precision-viewmodel.ts`)

Current state is already close to reference: star+disc group, normal (not
additive) blending — correct for our bright sky — 45 ms life (≈ 2–3 frames),
golden-angle roll (137.5° × shotIndex), 1-frame-ish muzzle light with 18 ms
exponential decay.

| Param | Value | Notes |
|---|---|---|
| Life | 45 ms (keep) | Matches TF2/Valorant 2–3 frame convention. SMG at 900 rpm = 66 ms interval > 45 ms — no overlap, keep it that way for any new weapon. |
| Roll | golden-angle (keep) but add ±15° random jitter | Pure golden-angle is detectably periodic on a 5-shot burst. |
| Scale jitter | ×0.85–1.25 per shot, both cards | The single cheapest "alive" upgrade; currently constant. |
| Opacity curve | 0.9 → 0 linear over life (keep) | |
| Sprite upgrade (optional) | swap procedural star for 2-frame flip: `kenney-particle-pack/muzzle_01..05` random pair, frame 1 at 0–20 ms full size, frame 2 at 20–45 ms × 1.15 scale × 0.5 alpha | 5 sprites → 20 ordered pairs of visual variety; world-space size ~0.28–0.38 m. |
| First-person alpha cap | ≤0.9, never additive | Valorant rule: crosshair stays visible through the flash. Already true — protect it in review. |
| Muzzle light | intensity 4.0, decay exp 18 ms (keep); clamp distance 2.4 (keep) | |
| Smoke wisp | per §1 table: 1 per 4 shots, cap 4 | Shared implementation with tracer-section wisps — one system, spawned at muzzle. |
| Third-person flash | same sprite at 0.8× on remote weapon muzzles, every shot | Enemy muzzle flash is threat info #1 at range; currently remote shots only get tracers. |

---

## Integration priorities by feel-impact

1. **Bullet-hole decals (frame-0, persistent)** — the largest missing organ;
   nothing else makes hitscan feel physical the way holes that stay do.
2. **Casing floor bounce + first-contact tinkle** — turns the existing
   casing pool from invisible to the thing everyone remembers about CS.
3. **Surface-keyed impact sound layers + 15% ricochet whine** — the material
   layer is the strongest surface-identity channel; assets now all vendored.
4. **Normal-aligned sparks/puff (pass surface normal into `impact()`)** —
   directional response makes walls feel solid instead of decorated.
5. **Tracer frequency per weapon + muzzle smoke accumulation** — sparse
   tracers + hanging burst-haze are what make sustained fire read as *spray*.
