# Map architecture spec — from greybox boxes to readable arenas

Owner verdict (2026-07-21): "looks shitty as fuck… feels like Doom II."
This spec turns the four generated maps into readable, memorable arenas using
**only the existing map pipeline** — no hand-authored art assets. Everything
below is emitted by `tools/mappipe/`, validated by `pipeline.ts`, and rendered
by the existing triplanar/high-key stack.

Serves: `docs/hybrid-meta-spec.md` (stop-to-shoot, planted-rifle discipline,
movement tech as rotation currency) and `docs/art-direction.md` (REGISTER
PIVOT: high-key daylight, crisp, zero post).

---

## 0. Ground truth (verified in-repo, 2026-07-21)

Facts every change below builds on — do not re-derive, they were measured:

- **Visual == collision.** The client renders the map by building a
  `BufferGeometry` directly from `map.collision.positions/indices` of the
  `.blob` (`client/src/main.ts` ~599, ~1572) and calling
  `computeVertexNormals()`. The `.gltf` is a build intermediate only. So
  generator geometry changes ARE the art pass. One mesh, one material,
  one draw call per map today.
- **Blob v2 layout** (`packages/shared/src/map.ts`): header GGMP + collision
  f32/u32 + spawns + bounds + kill AABBs + secrets. No material information.
- **Maps are emitted programmatically** by
  `tools/mappipe/generate-phase4-maps.ts` (`pnpm mappipe:phase4`) from ~6
  primitives: `box`, `rampX`, `rampZ`, `orientedBox`, `annularSlab`,
  `cantedAnnularSlab`. Everything is an axis-aligned extrusion.
- **Current collision tri counts** (read from blob headers):
  foundry **412**, spire **328**, duna **344**, cascade **1784** tris.
- **Triplanar zoning: NOT supported today.** `render-style.ts
  triplanarMapMaterial()` uses exactly one `PbrTextureSet` for the whole map,
  keyed by `mapId` via `material-assets.ts textureSetForMap()` (spire=plaster,
  duna=wall, cascade=concrete, foundry=metal). Four texture sets are already
  loaded for every map — zoning is a data-plumbing problem, not an asset
  problem. Because the material is a TSL node material sampling
  `positionWorld`, per-height tinting is a pure shader change with zero data.
- **Dressing** (`client/src/map-dressing.ts`) is a hand-typed table of ~7
  instanced boxes per map (3 draw calls), NOT collision-true (they claim
  `collisionSource: "baked-map"` but nothing in the blob matches — ghost
  cover). It must become a generator output.
- **Movement constants** (`packages/sim/src/params.ts`, `collision.ts`,
  `shared/src/feel.ts`):

  | quantity | value | derived design number |
  |---|---|---|
  | runSpeed | 6.4 m/s | — |
  | gravity / jumpVelocity | 20 / 5.3 | jump apex **0.70 m**, airtime **0.53 s** |
  | flat run-jump carry | 6.4 × 0.53 | **≈ 3.4 m** |
  | bhop carry (7.5–9 m/s kept speed) | — | **4.0–4.8 m** per hop |
  | capsule | r 0.4, h 1.8 / 0.9 ducked | min gap width 1.0 m; slide slot height ≥ 1.0 m |
  | feetTuck (air duck) | 0.45 m | duck-jump ledge ceiling ≈ **1.15 m** |
  | slide | 300 ms @ 0.25 friction | slide carry ≈ 2 m |
  | coyote / corner nudge | 50 ms / 0.05 m | drop lips are free; 0.05 m edge forgiveness |
  | walk/surf threshold | 45.57° | walkable ramps ≤ 40°, surf 47–50° |
  | Spire (SCOUTZ gravity 5.5) | apex **2.55 m**, airtime 1.93 s | jump carry 12–14 m with strafe gain |

- **Validators that exist**: coplanar-overlap (1 mm, cross-owner), ≥8 spawns
  per mode, per-map spawn counts (16 FFA / 24 scoutz), 1–2 race spots,
  per-map secret nodes, bounds node, kill volume ≥ 1. CI runs them on every
  gltf + blob (`tools/package.json` test script).

### Why it reads as Doom II (diagnosis)

1. **Sealed shoebox**: full-height perimeter slabs (foundry 18 m, spire 40 m)
   — no sky except straight up, no skyline, no depth cue. The high-key
   register is doing nothing because the maps are interiors of crates.
2. **Six primitives, zero mouldings**: every mass is a sharp extruded box.
   No arches, no caps, no chamfers → no catch-light edges, no silhouettes.
3. **Smoothed normals on boxes**: generator shares 8 verts per box;
   `computeVertexNormals()` averages across faces → mushy rounded-blob
   shading on hard geometry. This alone screams "programmer art."
4. **One texture, one tint, everywhere**: no floor zoning, no height
   gradient, no landmark accent → every corner of the map answers "where am
   I" identically.
5. **Dressing is seven floating boxes**, some offering fake cover.
6. **No thresholds**: spaces bleed into each other with no portal/arch
   framing, so nothing is nameable ("long", "pit", "arch") at a glance.

---

## 1. Arena grammar — the composable vocabulary

New module `tools/mappipe/grammar.ts`: pure functions returning
`{ geometry, materialId, dressing?, designMeta? }`. All primitives emit
**face-split vertices** (no shared verts across faces — see §5 P1) and
**never emit never-visible bottom/back faces** (existing z-fight rule).

Dimensions are ranges the composer may pick from; every number is tuned to
the movement table in §0.

### 1.1 Primitives (low level)

| primitive | signature (essentials) | rules |
|---|---|---|
| `chamferBox` | box + top-edge 45° chamfer, bevel 0.10–0.20 m | replaces `box` for every player-facing mass ≥ 0.5 m tall; the bevel is the catch-light line that kills the Doom look. +2 tris per chamfered edge. |
| `wedge` | generalizes `rampX/rampZ`, arbitrary yaw | walkable 12–30°; surf 47–50°; NOTHING authored between 40° and 47° (see §6 angle audit). |
| `archFrame` | opening w 2.8–4.0 m, h 2.6–4.0 m; shoulders + 3-segment faceted lintel | THE threshold marker between named spaces. Faceted (3 chords), not curved: 10 tris. Clear height ≥ 2.6 m (jump under lintel: 1.8 capsule + 0.7 apex needs 2.5; 2.6 gives margin). |
| `parapet` | h 1.10–1.30 m, thickness 0.30–0.40 m, coping ledge 0.40 m proud | covers a ducked player (0.9 m) fully; standing player plants and peeks. The 0.4 m coping is the duck-tap mantle texture on every route. |
| `pillar` | square 1.2–1.6 m, h 3–6 m, base + cap chamfer | plant cover: ≥ 1.2 m wide hides a 0.8 m-dia capsule with lean margin. Freestanding pillars always in pairs/clusters offset 2–4 m (one pillar = a post; two = architecture). |
| `buttress` | wedge against walls, 0.8–1.2 m proud, 2–4 m wide, full wall height | wall articulation every 6–10 m on any wall ≥ 8 m long; breaks the slab read and gives wall-hugging cover rhythm. |
| `colonnade` | 3–6 × `archFrame` in series, spacing 4–6 m | covered flank route along a lane (see §2). |
| `tieredPlatform` | 2–3 tiers; tier heights from §3 ladder | top ≥ 4×4 m; every tier edge gets `parapet` or drop lip, never bare box edge. |
| `towerShell` | 4–8 m square footprint, h 8–16 m, chamfered cap + 1–2 sky windows | the landmark unit (§4). Hollow only if play-space; else solid silhouette mass. |
| `crateStack` | cubes 0.7 / 1.05 / 1.5 m in clusters of 2–4 | shotgun-corner cover + crouch-jump ladders (1.05 ≤ duck-jump ceiling 1.15). Collision-true, emitted with matching dressing accent. |
| `jumpLedge` | ledge at 0.65 m (run-jump), or 1.05 m (duck-jump), gaps 3.6–4.2 m | the skill-shortcut unit: gap > 3.4 m flat carry ⇒ unreachable at walk, reachable at bhop speed. |
| `perimeterKit` | parapet ring h 2.5–4.5 m + towers + kill skirt AABB outside | replaces prison walls; the sky does the art direction (§4). Rocket-jump escapes land in the kill skirt, not out-of-bounds limbo. |

### 1.2 Spaces (mid level — what the composer places)

| space | footprint | height | exits | role |
|---|---|---|---|---|
| **courtyard** | 18–30 × 18–30 m | open sky | 3–4, ≥ 3 m wide, ≥ 90° apart | FFA hot zone; rifle mid-range 12–30 m across the diagonal; 1 cover element (pillar pair / crateStack / parapet stub) per 60–80 m², center-weighted so edges stay runnable |
| **connector hall** | w 3.0–4.5 m, len 8–18 m | walls 3–4 m, ceiling optional (≥ 3.2 m if present; 4 m for bhop comfort) | 2 by definition | SMG/pistol pocket (8–18 m); ALWAYS doglegged or shouldered — a straight hall > 18 m is a lane and must be declared as one (§2) |
| **arch bridge** | span 8–16 m, deck 2.4–3.6 m | +2.5 to +5 m | 2 + the drop (drop = a third exit) | crossing over a lane or courtyard; parapets both sides; approach ramps 15–25° |
| **ramp run** | w ≥ 3 m main / 1.8 m side, 12–30° | gains 2–3.5 m per run | — | the accessible route between tiers; every ramp doubles as a bhop rhythm element (jump at the lip carries) |
| **pit / cellar** | 8–16 m across, −1.5 to −2.5 m | open above | ≥ 3 ways out (2 ramps + 1 jump-tech) | shotgun/knife heaven (5–10 m sightlines), exposed from rim = self-balancing |
| **terrace tier** | ring or bank segments 1.6–2.2 m deep | steps from §3 ladder | continuous + shortcut gaps | cascade's signature, reusable as bleachers anywhere |

### 1.3 FFA flow rules (composer-enforced, mode = 6-player gun-game FFA)

1. **No dead ends.** Every space has ≥ 2 exits with ≥ 90° angular
   separation. Sole exception: secret rooms (already off the flow graph).
2. **Pocket depth ≤ 6 m**: any alcove deeper than 6 m from its opening must
   gain a second exit or shrink. (Camping pocket ⇔ shotgun-check cost rule.)
3. **Loop structure**: the space graph has cycle rank ≥ 2 (E − V + 1 ≥ 2) —
   a figure-eight minimum, so a chase always has a counter-rotation.
4. **Exit widths ≥ 2.8 m** (0.8 m capsule at 9 m/s needs steering room);
   main-flow routes 3.6–4.5 m.
5. **Full-loop time budget**: outer loop lap 18–28 s at run speed
   (115–180 m); 6-player FFA density target = 1 encounter per 8–12 s.
6. **Every route carries one 0.4 m coping/ledge** (duck-tap texture rule,
   inherited from maps-brief, now enforced by grammar not by hand).

---

## 2. Sightline design for the hybrid meta

The hybrid meta makes sightline length a *weapon selector*: a planted rifle
deletes at range, a moving one misses. Geometry must therefore price every
lane in "seconds standing still."

### 2.1 Lane taxonomy (per-weapon-tier engagement pockets)

| tier | pocket | max clear sightline | geometry that creates it |
|---|---|---|---|
| shotgun / knife | pits, tunnel bends, crate corners | **5–10 m** | pit, crateStack clusters, dogleg halls, tunnel w/ 4 m ceiling |
| SMG / pistol | connector halls, courtyard edges | **8–18 m** | hall lengths capped at 18 m, buttress rhythm breaks wall-hug lines |
| rifle (planted) | declared lanes | **25–45 m** | straight floor bands w/ plant pockets at both ends |
| scout / deadeye | ONE signature lane per map | **30 m+** (duna long stays 70 m as the map's identity) | long floor band + dogleg entrance so it can't be held from spawn |

### 2.2 Lane rules

1. **Declared, not accidental.** The composer emits every sightline ≥ 22 m
   into `maps/<name>.design.json` as a lane record
   `{ from, to, lengthM, tier, crossings[] }`. The validator raycasts the
   lane clear at eye height (1.62 m) and FAILS on any *undeclared* clear
   ray ≥ 25 m sampled between space centers (§6.3). Accidental cross-map
   lines are how greyboxes leak into "one guy planted deletes the server."
3. **Plant pockets at both ends**: a pillar, buttress, or parapet 1–2 m off
   the lane axis within 3 m of each lane mouth. Planting is a *position you
   take*, not a free state — the pocket is where you take it.
2. **Every lane crossed by ≥ 1 covered flank** at 40–60 % of its length:
   a colonnade, a sunken cut (−1.2 m with 0.4 m lips), or a bridge above.
   Crossing must have entry cover on BOTH sides (arch shoulders count).
   Time-to-cross ≤ 1.2 s at run speed (crossing width ≤ 7.5 m).
4. **Lane floors get material id 1** (accent floor, §4.3): you SEE you are
   standing in a rifle lane. This is the readability contract with the meta:
   danger is legible before it fires.
5. **No lane may see another lane's plant pocket.** Checked by raycast
   between pocket positions in design.json.
6. **Bridges never dominate lanes**: a bridge over a lane exposes ≤ 40 % of
   the lane (parapets block the rest) — cascade's "rhythmic exposure" rule
   generalized.

---

## 3. Verticality — the height ladder

Three tiers, fixed ladder, every map (spire keeps its taller scoutz-specific
masses on top of this ladder):

| tier | height | access |
|---|---|---|
| T0 ground (incl. pits −2.5 to 0) | 0 m | — |
| T1 mezzanine | **+2.5 to +3.5 m** | ramps (accessible route) + jump-tech shortcuts |
| T2 high | **+5 to +7 m** | ramps + chained shortcuts only (no single jump) |

Rules:

1. **Ramps AND shortcuts, always both.** Every tier connection has a ≥ 3 m
   wide ramp route (anyone can rotate) and at least one jump-tech shortcut
   that is strictly faster (movement skill buys *time and angle*, never
   damage):
   - 0.65 m ledge chains (run-jump) — everyone, slow
   - 1.05 m ledge chains (duck-jump) — knows-the-mechanic, medium
   - 3.6–4.2 m bhop gaps at ledge height (needs > 7 m/s — carried speed only)
   - 47–50° surf ribbons where the personality calls for them (spire walls,
     duna long, cascade rim — all already exist; grammar formalizes them)
2. **Bhop-reachable ledges sit at jump-apex heights**: 0.65 m (safe margin
   under 0.70 apex) and 1.05 m (margin under the 1.15 m duck-jump ceiling).
   Never 0.8–1.0 m (dead zone: fails run-jump, trivial duck-jump — feels
   random) and never 1.2–1.4 m (fails both, reads as jumpable, infuriates).
3. **High ground is exposed high ground**: any T2 position is visible from
   ≥ 2 distinct T0/T1 zones and holds NO shotgun pocket (min 12 m sightlines
   up there). Planted-rifle on high ground is strong but silhouetted against
   sky (§4) — the counter-snipe read is free.
4. **Drops are always legal**: no fall damage assumption changes; every T2
   edge has a clean landing zone (no 1 m-deep trash geometry below rims).
5. **Race spots** (1–2 per map, validator-enforced) sit at the END of the
   hardest jump-tech chain on the map — position as trophy, unchanged.

---

## 4. Readability on the daylight register

The high-key pivot says: bright sky, warm sun, zero post, crisp. The maps
must *use* it — currently they wall it out.

### 4.1 Open the sky (perimeterKit)

Replace full-height perimeter slabs with the perimeter kit: parapet ring
2.5–4.5 m + landmark towers + kill-skirt AABB outside (catches rocket-jump
exits; `bounds_` unchanged). Foundry's 18 m and duna's non-lane walls drop
to parapet height; spire keeps its nave walls (its identity is the interior
volume) but gains 4×4 m **sky windows** punched high (y 18–30 m) — shafts of
sky between buttresses; cascade's canyon rim becomes stepped terraces
against sky instead of a cliff slab. The skyline IS the free art asset.

### 4.2 Landmark rule — one silhouette per quadrant

Each map declares 4 landmarks (one per XZ quadrant) in its personality;
each is a distinct grammar composition ≥ 8 m tall, visible from ≥ 60 % of
its quadrant's play space, silhouetted against sky:

- **foundry**: chimney stack pair (towerShell ×2, offset heights) NW; crane
  gantry (beam on two towers) SE; tiered smelter block NE; arch colonnade SW.
- **spire**: the spire itself is the global landmark (all-quadrant); each
  quadrant differs by wall treatment — organ-loft tiers W, sky windows N,
  surf-ribbon band walls (visible cant) N/S, secret-ledge stack NE.
- **duna**: broken arch (the mid slit, now a proper ruined double-arch) at
  center-N; ruin tower SW; colonnade fragment along long E; dune-bank
  (15° wedge banks, sand-material id) S.
- **cascade**: the two bridges (already offset 45°) + waterfall monolith
  (towerShell at the notch, W) + rim stair-tower E.

Landmark masses use **material id 3** (landmark accent) so they differ in
surface as well as silhouette.

### 4.3 Floor-material zoning — blob v3

Answer to the spec question: **the triplanar system does NOT support zones
today** (one texture set per map, §0) — but all four Poly Haven sets are
already loaded on every map, and the material is TSL. Plumb a per-triangle
material id through the blob and split the map mesh into ≤ 4 groups:

- **id 0 — field**: default floor + general masses (per-map base set)
- **id 1 — accent route**: declared lane floors + main flow ramps (metal on
  foundry, wall-stone on duna…) — "you are in a lane" is a floor read
- **id 2 — wall**: vertical masses ≥ 2 m (different set than floor ⇒ walls
  stop reading as extruded floor)
- **id 3 — landmark**: landmark masses + arch frames + race-spot lips

Blob v3: bump `MAP_BLOB_VERSION` to 3; append `u8 materialId[triCount]`
(4-byte aligned) after secrets. `loadGameplayMap` defaults v1/v2 to all-zero
ids. Client (`main.ts`): sort triangles by id at load, `geometry.addGroup`
per id, `materials.map` becomes `Material[]` of ≤ 4 triplanar materials
(render-style `materials()` gains the per-zone set table in
`material-assets.ts`). Map draw calls: 1 → ≤ 4. Server ignores ids entirely.

### 4.4 Height tint + sun as compass (pure client shader/data, zero geometry)

- **Height-based tinting** in `triplanarMapMaterial`: multiply albedo by
  `mix(warm(1.0, 0.97, 0.92) at bounds.min.y → cool-light(0.94, 0.97, 1.0)·1.06 at bounds.max.y,
  smoothstep(positionWorld.y))` — grounded = warm, high = airy. "How high am
  I" becomes a color read. (materials() already receives the GameplayMap —
  bounds are available.)
- **Per-map sun azimuth table** replaces the hard-coded
  `key.position.set(34, 62, 22)`: foundry NW, spire N, duna E (long shadows
  down long), cascade SW. Within a map the sun never moves ⇒ shadow
  direction is a compass. Elevation stays high (~55°) for the high-key read.
- **North-face cool bias**: `dot(normalWorld, sunDir)` lerps a ±3 % warm/cool
  albedo bias — free directional legibility on every wall.

---

## 5. Generator work plan (concrete, ordered)

All work in `tools/mappipe/` unless stated. Regeneration stays
`pnpm mappipe:phase4` (rename script to `mappipe:maps` at the end of P4).

### P1 — "Sky and silhouette" — restyle in place (no layout/spawn changes)

*Files: new `grammar.ts`; edit `generate-phase4-maps.ts`, `pipeline.ts`.*

1. `grammar.ts` low-level primitives: `chamferBox`, `wedge` (subsumes
   rampX/rampZ), `archFrame`, `parapet`, `pillar`, `buttress`, `towerShell`,
   `crateStack`, `jumpLedge`, `perimeterKit`. Each returns
   `{ name, geometry, materialId }[]`. All top-edge chamfers, no bottom
   faces, grounded bases sunk 0.02 m (existing rules).
2. **Face-split bake**: in the emit path, duplicate vertices per face before
   writing gltf/blob so `computeVertexNormals()` yields flat normals.
   Applies to ALL primitives incl. legacy. (Positions ~3×; tri count
   unchanged; see budget §7.)
3. Rework the four map functions *keeping their floor plans, spawns, kill
   volumes, secrets and race spots exactly where they are*:
   - foundry: walls 18 m → perimeterKit at 4.5 m; pillar clusters →
     `pillar` pairs with caps; hall walls get buttresses; landmarks per §4.2.
   - duna: non-long perimeter → perimeterKit 3.5 m; mid arch → double
     archFrame ruin; long outer wall keeps 12 m but buttressed every 8 m;
     dune banks (15° wedges) against S perimeter.
   - spire: nave walls stay 40 m, gain buttresses + sky windows; organ-loft
     tiers get parapets + chamfers; spire mass gets chamfered setbacks.
   - cascade: bounds cliff → stepped rim terraces + monolith; terrace edges
     get parapet stubs; bridges get parapets + faceted arch undersides.
4. `pipeline.ts`: add tri/vert ceiling assertions (§7) so P1 cannot silently
   blow the budget.

*Result: same gameplay byte-for-byte where it matters (spawns/lanes/kills),
completely different picture. This phase alone retires "Doom II."*

### P2 — "Zones and light" — material ids end to end

*Files: `packages/shared/src/map.ts` (blob v3), `pipeline.ts` (carry ids
from grammar output through bake), `generate-phase4-maps.ts`; client:
`main.ts` (groups), `render-style.ts` (per-zone materials + height tint +
sun table), `material-assets.ts` (zone→set mapping per map).*

Per §4.3–4.4. The gltf carries the id as a node-name suffix
(`col_<label>__m<id>`) so `bakeGltf` needs no gltf-schema change — it
already tracks per-triangle owners; strip the suffix for owner names.

### P3 — "Dressing from the pipe" — kill the hand table

*Files: `generate-phase4-maps.ts` (emit `maps/<name>.dressing.json`),
`client/src/map-dressing.ts` (load JSON via `?url` import, build one
InstancedMesh per kind), delete the DRESSING literal.*

- Kinds (all unit-box based, still zero assets): `crate`, `rail`, `beam`,
  `coping-trim`, `stack`. ≤ 64 instances/map, ≤ 8 draw calls.
- **Collision-true rule**: any dressing piece with a footprint inside play
  space and height ≥ 0.4 m must be emitted WITH a matching `col_` mass by
  the same grammar call (crateStack already does). Rails/beams above 2.2 m
  head clearance are exempt. This deletes the ghost-cover bug class and the
  `collisionSource` lie in one move.

### P4 — "Composer + re-layout" — the flow pass (the big one)

*Files: new `composer.ts`, new `personalities.ts`; rewrite the four map
functions as personality-driven compositions; emit
`maps/<name>.design.json`.*

1. `composer.ts`: takes `{ seed, spaces[], portals[], lanes[], landmarks[] }`
   (a personality), places grammar spaces, resolves portals to archFrames /
   ramp runs, enforces §1.3 flow rules + §2 lane rules + §3 ladder at
   compose time (throw on violation — composer errors are spec violations,
   not warnings). Seeded PRNG (mulberry32) drives jitter only: buttress
   spacing, crate cluster rotation, tower heights ±15 % — variety, never
   topology.
2. `personalities.ts` — the four maps as data:
   - **foundry** (seed `0xf0…`): industrial courtyards — orthogonal 2-courtyard
     figure-eight around the crucible pit; catwalk ring kept; lanes: two 28 m
     rifle lanes N/S of pit, crossed by colonnade + sunken cut.
   - **spire** (seed `0x51…`): vertical tower — keep the scoutz nave layout
     (it serves its mode); composer only re-expresses it in grammar terms +
     sky windows. Spawns/tiers unchanged (validator pins 24 scoutz spawns).
   - **duna** (seed `0xd0…`): open dunes + ruins — keep the dust2 archetype
     graph (mid/long/short/tunnels/2 plazas — hands remember it); re-express
     spaces in grammar, add dune banks, keep long at 70 m as the signature
     scout lane with its dogleg.
   - **cascade** (seed `0xca…`): tiered waterfall terraces — keep loop +
     bridges + well; terraces re-cut to the §3 ladder; monolith landmark;
     rhythm waves kept (they are the map's fun thesis).
3. **Spawn re-placement**: composer emits spawn candidates (one per space
   edge, facing along flow, cover within 4 m), then selects 16 (24 spire)
   maximizing pairwise graph distance. Existing anti-farm runtime selector
   unchanged — this only improves the candidate set.
4. **Race spots re-placed** at the end of each map's hardest new jump chain
   (1–2, validator unchanged). Secrets keep their kinds and rough regions
   (they're shipped features); composer treats their volumes as fixed
   constraints.
5. `design.json` (composer truth for validators + future tools): spaces,
   graph edges, lanes + crossings, plant pockets, landmark positions,
   authored-angle list, shortcut chains with required tech tags.

### P5 — "Validation hardening" (parallel with P4, lands with it)

*Files: `pipeline.ts`, new `raycast.ts` (Möller–Trumbore vs baked
collision), extend `tools/package.json` test script; new
`grammar.test.ts`, `composer.test.ts`.*

New checks (all CI, all per map):

1. Tri ≤ 4000 / verts ≤ 12000 (from P1, kept).
2. **Angle audit**: every up-facing tri (normal.y > 0.05) must be < 40.5° or
   ≥ 46.5° — the 40.5–46.5° band requires an entry in design.json's
   authored-angle list (the 45.57° threshold stays a *decision*, never an
   accident).
3. **Lane audit**: declared lanes raycast clear end-to-end at 1.62 m;
   declared crossings blocked from both lane ends; no clear ray ≥ 25 m
   between space centers that isn't a declared lane; plant-pocket
   cross-visibility ban (§2.2).
4. **Spawn audit**: no spawn↔spawn clear LOS < 20 m; every spawn has ≥ 1
   blocked ray within 4 m among 8 compass rays (cover exists); spawn yaw
   points into its space's flow direction ± 45°.
5. **Flow audit**: from design.json — exit counts, angular separation,
   cycle rank ≥ 2, pocket depth, shortcut ledge heights within the legal
   bands (0.60–0.70 / 1.00–1.10 m), bhop gaps within 3.6–4.2 m.
6. Existing checks unchanged (coplanar, spawn counts, secrets, race spots).

### Phase ranking — look-impact per effort

| rank | phase | effort | look impact | meta impact | note |
|---|---|---|---|---|---|
| 1 | **P1 sky + silhouette + flat normals** | S–M (~2 focused days) | ★★★★★ | none (layouts frozen) | the "not Doom II" moment; ship alone |
| 2 | **P2 zones + height tint + sun compass** | M (blob v3 + client groups) | ★★★★ | readability = meta legibility | 4 draw calls, zero new assets |
| 3 | **P3 dressing pipeline** | S | ★★ | kills ghost cover | mostly deletion; do right after P2 |
| 4 | **P4 composer + re-layout** | L | ★★★ | ★★★★★ (lanes, pockets, verticality) | the gameplay payoff; foundry+duna first, spire mostly re-expression |
| 5 | **P5 validation** | M | 0 | locks it all in | raycast validator is P4's safety net — start it when P4 starts |

Execution order = rank order; P5 overlaps P4.

---

## 6. Budgets (Chromebook contract)

Baselines measured from current blobs (§0). Ceilings are validator-enforced
(P1/P5), not aspirations:

| budget | current | ceiling | rationale |
|---|---|---|---|
| collision tris / map | 328–1784 | **≤ 4000** | ~2.2× cascade, 10× foundry; server physics + coplanar O(n²) CI check both comfortable; client renders it trivially |
| collision verts / map (post face-split) | ~1–3.6 k | **≤ 12000** | 3 × tri budget upper bound |
| blob size / map | 5–36 KB | **≤ 300 KB** | 4 k tris face-split ≈ 190 KB; < 5 s cold-load untouched |
| map draw calls | 1 | **≤ 4** (one per material group) | §4.3 |
| dressing draw calls | 3 | **≤ 8** (one InstancedMesh per kind) | instancing only, ≤ 64 instances |
| map + dressing total | 4 | **≤ 12 of the 150 global budget** | leaves the art-direction budget untouched |
| shadow | 1 cascade, per-map frustum | unchanged | perimeterKit lowers wall heights ⇒ tighter frustum for free |
| new textures | 0 | **0** | zoning reuses the four loaded Poly Haven sets |

Coplanar validator cost note: 4000 tris ⇒ ~8 M AABB pre-checks per map in
CI — seconds, acceptable; if it creeps, add the obvious owner-AABB bucket
grid before relaxing anything.

---

## 7. Acceptance

- All four maps regenerate + validate green with every P5 check on.
- Screenshot set (per map: each quadrant looking inward, one from T2):
  sky visible in ≥ 70 % of ground-level frames; the quadrant landmark
  identifiable in each; lane floors visibly distinct.
- Blind read test: a screenshot from any spawn answers "which map, which
  quadrant, roughly where" — the §4 stack is the mechanism, this is the bar.
- Feel gate (owner): rifle lanes hold at plant and die to the flank
  crossings; shotgun tiers own the pits; a bhop lap of each map flows
  without a single forced full-stop; "where am I" answerable in one glance.
- Perf: draw calls ≤ 150 total in-match, ≥ 60 fps Iris-Xe class, cold load
  < 5 s — unchanged numbers, now with the map layer costing ≤ 12 calls.
