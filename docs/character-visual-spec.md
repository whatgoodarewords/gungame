# Character visual spec — players you can read, presence you can feel

Status: SPEC (character-visual architect pass, 2026-07-23)
Register: `high-key` daylight (art-direction.md closing pivot — bright, warm,
flat-lit, instantly legible). Constraint: **no external art acquisition** —
procedural geometry + the vendored GLTFs already on disk
(`assets/vendor/quaternius-ultimate-guns/*.glb`, `assets/vendor/wrad-arms/arms.glb`,
`assets/vendor/creative-trio-crowbar/crowbar.glb`).

The owner verdict this answers: "looks shitty… feels like Doom II." The audit
below shows *why* it reads that way, and every fix is transform + vertex-data
work on assets we already ship. No skeletal animation system, no new downloads,
no post passes (pivot forbids them).

---

## 0. Audit — what a player actually looks like today

### Remote player (`client/src/combat-visuals.ts` → `RemoteCharacterSystem`)

Six instanced primitives, **all sharing one flat material** (`materials.actor`,
high-key red `0xe0483e`):

| part | geometry | placement |
|---|---|---|
| torso | Box 0.56 × 0.78 × 0.30 | center y 1.08 |
| head | **Sphere** r 0.22 | center y 1.62 |
| arms ×2 | Box 0.16 × 0.66 × 0.16 | center y 1.08, x ±0.38 |
| legs ×2 | Box 0.20 × 0.72 × 0.22 | center y 0.42 |

Why it reads "Doom II":

1. **Monochrome red golem.** One color for head, torso, limbs. No zones, no
   value structure — the eye gets a red smear, not a person.
2. **Sphere head on box body.** The one curved part is the head; under flat
   daylight a lone sphere reads "crash-test dummy", not "stylized character".
3. **No weapon in hand.** The entity snapshot carries `weaponId` and
   `weaponTier`, and gun-game's core information is *what tier is that enemy
   on* — currently invisible. hybrid-meta-spec.md's bar is readability =
   mechanics; this is a mechanics gap wearing an art costume.
4. **Facing comes from velocity** (`atan2(vel.x, vel.z)`), snapping to world
   +Z when the enemy stands still — i.e. exactly when they're aiming at you,
   they face a random direction. `viewYaw`/`viewPitch` ARE replicated
   (protocol `EntityFlags.Angles`) and are already on the objects main.ts
   passes in — combat-visuals just never reads them.
5. **Limbs rotate about their centers**, not shoulders/hips — the walk cycle
   scissors like helicopter blades instead of swinging.
6. **Duck = Y-scale 0.56 squash.** Reads "shrunken person", not "crouching
   person".
7. **The cyan additive rim shells** (`rimTorso`/`rimHead`, `0x65d4ff`,
   AdditiveBlending) are a Tron leftover: additive blending washes out to
   nothing against the bright high-key sky — the *exact* lesson already
   recorded in precision-viewmodel.ts's J3 muzzle-flash comment. Net effect
   today: ~zero enemy pop for 2 draw calls, in the wrong hue family.
8. **No damage feedback on the body** — hits show a crosshair hitmarker and
   sparks, but the enemy model never reacts.

What already works and stays: the part-type InstancedMesh architecture, the
zero-alloc scratch-object discipline, footstep dust, spawn/death bookkeeping
(generation map), the `HIDDEN` matrix parking pattern, `Math.max(1, count)`.

### First person (`client/src/precision-viewmodel.ts`)

Verified against the actual GLBs (all plain glTF 2.0, **no** required
extensions, no Draco/KTX2 decoders needed; loaded via Vite `?url` imports so
the `/gg/` base path is handled — the files structurally load fine):

1. **The guns DO load, then get lobotomized.** `loadVendoredModel()` replaces
   every mesh's material with the single flat-orange viewmodel material
   (`object.material = this.material`). The Quaternius guns ship 5 authored
   materials each (`DarkWood`, `Metal`, `Black`, `DarkMetal`, …) — all
   discarded. The player stares at a monochrome orange blob all match. **This
   is the single biggest "programmer art" tell in the game**, and it is why
   the vendored assets "don't look loaded" even though they are.
2. **Every weapon switch re-fetches and re-parses the GLB** (`new
   GLTFLoader().loadAsync(url)` per `setWeapon`). Gun game switches weapons
   every kill; that's a network fetch + parse + GPU upload hitch per tier-up,
   plus the model pops in mid-equip.
3. **Three weapons have no GLB at all** — `WEAPON_MODEL_URLS` has no entries
   for Arc, Peacemaker, Discus — so those tiers are *permanently* procedural
   prims (the fallback isn't silent in code — `console.warn` — but it is
   silent to the player, and for these three it isn't a fallback, it's the
   only path).
4. **WRAD arms load but are a corpse in bind pose.** `arms.glb` is a skinned
   mesh (52 nodes, full finger chains, zero animation clips). The code grabs
   `wrist_ik.l` and moves it to the foregrip — but glTF exports IK *targets*
   as plain empties and three.js runs **no IK solver**, so
   `this.leftIk.position.set(...)` is a silent no-op: the visible arm mesh
   never moves. The arms are bbox-centered, uniformly scaled (`1.25 /
   longest`), spun 180°, and left in whatever pose they were exported in —
   for every weapon, forever. The *real* bones (`shoulder.r`, `bicep.r`,
   `forearm.r`, `wrist.r`, mirrored `.l`, plus fingers) are ordinary nodes
   and CAN be posed directly by setting rotations — no animation system
   required.
5. On arms load failure: two procedural cylinders (warn-only). Acceptable
   last-resort; keep.

### Sim facts the visuals must honor (`packages/sim/src/collision.ts`)

- Capsule: radius **0.4**, height **1.8**, ducked **0.9**, eye **1.62**.
  `position` = feet.
- Headshots are real (`combat.ts`): the head zone is the capsule's top sphere
  — roughly **y 1.4 → 1.8** above feet. The visual head must honestly occupy
  that band. **The hitbox stays the sim capsule; everything in this spec is
  visual-only.**

### Budgets (art-direction.md, binding)

Draw calls ≤ 150 total, characters ≤ 1.0 ms, zero per-frame allocation in the
render loop, no post. Character visuals today cost 9 draw calls (6 parts + 2
rims + dust).

---

## 1. Remote character v2 — the boxy-stylized humanoid

Register choice: **chunky boxy-stylized** (Crossy-Road / Fall-Guys-adjacent
proportions). It's the right answer on a decision matrix, not taste:
*coherence* (the whole world is boxes + triplanar; the current parts are
already boxes), *UX* (big head + high-contrast zones = maximum read at 40 m on
a Chromebook screen), *elegance* (BoxGeometry only — no new geometry pipeline),
*production-grade* (this register is exactly what the genre's winners ship).
A "realistic" proportion set with the same primitive budget reads as a store
mannequin — worse than committing to the stylization.

### 1.1 Proportions (meters, y = height above feet, standing)

Eight parts, all `BoxGeometry`. Total height 1.80 = capsule height; head band
matches the headshot zone.

| part | size (w × h × d) | pivot | rest placement |
|---|---|---|---|
| head | 0.34 × 0.32 × 0.34 | center | center y **1.60** (spans 1.44–1.76 → head hit zone 1.4–1.8) |
| torso | 0.46 × 0.50 × 0.26 | center | center y 1.14 (spans 0.89–1.39) |
| hips | 0.38 × 0.20 × 0.24 | center | center y 0.78 |
| upper arm ×2 | 0.13 × 0.30 × 0.13 | **top** (shoulder) | shoulder at (±0.30, 1.36, 0) |
| forearm+hand ×2 | 0.11 × 0.30 × 0.11 | **top** (elbow) | elbow = end of upper arm |
| leg ×2 | 0.16 × 0.64 × 0.18 | **top** (hip) | hip at (±0.11, 0.68, 0) |

- Head is deliberately oversized (stylization + honest headshot silhouette +
  the zone the eye should land on).
- Overall silhouette is *narrower* than today (shoulders 0.73 vs 0.92 total
  span) so it sits inside the r 0.4 capsule instead of overhanging it —
  today's model visually lies about its hitbox width.
- **Pivot-at-top limbs**: bake the offset into the local compose —
  `local = T(pivotPos) · R(swing) · T(0, −len/2, 0)` — one extra matrix
  multiply per limb using the existing scratch matrices. This kills the
  helicopter-blade walk on its own.
- Forearm split exists for ONE reason: the right forearm aims the gun (§1.4)
  while the upper arm keeps the walk-cycle counter-swing. If implementation
  pressure demands, forearms can fold into single 0.60 m arms for Phase B and
  split in Phase C — but the split is two more instanced parts, not a system.

Part list becomes:
`["torso", "hips", "head", "leftUpperArm", "rightUpperArm", "leftForearm", "rightForearm", "leftLeg", "rightLeg"]`
→ **9 InstancedMeshes**, capacity 12, same constructor pattern as today.

### 1.2 Palette zones via `instanceColor`

One shared character material for all parts: clone of the style's actor
material **with its color node forced to white** (`instanceColor` multiplies
the material color in three — a non-white base would tint every zone). Zones
are written per-instance with `setColorAt` (precedent: `impact-visuals.ts`
already drives `instanceColor` in this codebase; allocate the buffers in the
constructor by writing every slot once, never lazily in the frame loop).

| zone | parts | color (high-key) | why |
|---|---|---|---|
| actor/team | torso, hips | `palette.actor` `0xe0483e` | the "who" color — biggest mass |
| head | head | warm neutral `0xf2d8b8` | brightest zone → eye lands on the headshot band |
| limbs | arms, legs | `palette.ink` `0x2b3036` | dark limbs anchor the silhouette against bright ground and make the walk cycle legible at range |

- Per-style: derive head/limb tones from `RenderPalette` (`ink` exists;
  add `skin?: number` with a default) so `?style=` variants stay coherent.
- Team/actor hook: the zone writer takes a base color per player id. FFA today
  = `palette.actor` for everyone; a future team mode passes team color with
  **zero further changes** (this is the "team/actor color torso" contract).
- Dynamics reuse the same buffer (§1.5): damage flash, spawn flash, death fade
  are all `instanceColor` lerps — no material swaps, no extra draws.

### 1.3 Facing and aim — readability is mechanics

Extend the state contract (main.ts already passes full `InterpolatedEntity`
objects, which carry every field below — **no main.ts plumbing needed**, the
structural interface just widens):

```ts
export interface RemoteCharacterState {
  readonly id: number;
  readonly generation?: number;
  readonly position: Readonly<{ x: number; y: number; z: number }>;
  readonly velocity: Readonly<{ x: number; y: number; z: number }>;
  readonly viewYaw: number;    // NEW — was replicated all along
  readonly viewPitch: number;  // NEW
  readonly weaponId: number;   // NEW — drives held prop (§1.4)
  readonly health: number;     // NEW — drives damage flash (§1.5)
  readonly grounded: boolean;
  readonly alive: boolean;
  readonly ducked?: boolean;
}
```

- **Body yaw = `viewYaw`. Always.** Velocity no longer steers facing; it only
  drives the gait. A standing enemy now visibly aims where they aim — the
  single highest-value readability fix in this spec (you can finally tell
  "has he seen me?" at a glance, which is the CS read the hybrid meta wants).
- **Aim pitch distribution** (transform-only "spine"): torso pitches
  `clamp(viewPitch, ±0.35 rad) × 0.4`, head pitches `× 0.8`, right arm + gun
  pitch the full `viewPitch`. Three extra rotation components in existing
  compose calls — zero new systems.
- Strafe read: lean torso roll `clamp(lateralSpeed × 0.02, ±0.08 rad)` where
  lateral speed is velocity projected on the view-right axis (dot product with
  scratch vectors — no alloc).

### 1.4 Held weapon — the tier, visible (reuses `WEAPON_MODEL_URLS`)

New shared module **`client/src/weapon-geometry.ts`** (also the engine of the
first-person fix, §3):

```ts
// One fetch+parse per weapon per session. Bakes each GLB into ONE
// BufferGeometry: world transforms applied, material base colors written
// into a vertex color attribute, groups merged (BufferGeometryUtils
// .mergeGeometries), pre-rotated to -Z forward, pre-scaled so the model's
// length equals REMOTE_GUN_LENGTH[silhouette].
export function getWeaponGeometry(weaponId: WeaponIdValue): Promise<BufferGeometry>;
```

- Arc / Peacemaker / Discus (no GLB): run the same bake over the
  `buildSilhouette()` prim group — merge to one geometry, vertex-colored with
  `palette.accent`. One code path, thirteen weapons, no gaps.
- Nominal lengths (m), so a scout reads long and a pistol reads small in the
  enemy's hands: pistol-family 0.38, smg 0.55, shotgun-family 0.80, rifle
  0.85, scout-family 1.00, knife/crowbar 0.45, arc 0.65, launcher 0.90,
  discus 0.45.
- In `RemoteCharacterSystem`: one `InstancedMesh` per **weaponId actually
  seen**, created lazily on first sighting (async bake resolves → mesh added;
  until then the enemy simply shows no gun, which is today's status quo),
  capacity 12, `mesh.visible = count > 0`. Material: one shared
  `MeshStandardNodeMaterial({ vertexColors: true })` for all weapon props.
- Gun matrix per player: `root · T(0.30, 1.30, 0.22) · R(pitch = viewPitch) ·
  R(yaw ≈ 0)` — held at the right hand, aimed with the view. Right forearm
  points along the same pitch; left forearm reaches toward the gun when the
  hold is two-handed (reuse `VIEWMODEL_HOLDS[weaponId].twoHanded`).
- Draw cost: + (# distinct weapons on screen). FFA gun-game typical ≤ 6,
  worst 13. See budget table (§4).

### 1.5 Procedural animation (all transform/instanceColor, zero alloc)

| state | pose |
|---|---|
| **walk/run** | Legs swing about hips ±`min(0.72, speed·0.09)` (as today, but pivoted). Left arm counter-swings; **right arm stays on aim** (gun discipline read). Hips+torso bob `|sin(2·phase)|·0.03`; torso roll from §1.3. Phase formula unchanged (`4 + speed·1.3`, cap 12). |
| **air** | Asymmetric tuck: legs forward 0.55 / 0.75 rad, arms out ±0.25 rad, torso pitch −0.1. (Asymmetry is what makes it read "jumping" instead of "sitting".) |
| **duck** | **Not a squash.** Hips drop to center y 0.40; legs fold (pivot-at-top rotation 0.9 rad + `scaleY 0.55`); torso pitches forward 0.28, center y → 0.62; head center y → 0.76 (top ≈ 0.92 ≈ ducked capsule 0.9). Blend main-state → duck-state with the existing per-frame lerp feel (120 ms), tracked per id in a preallocated `Float32Array(capacity)`. |
| **death pop** | Replace roll-90°-and-shrink with: 120 ms scale pop ×1.12 → fall backward about the **feet** (rotX from 0 → −1.4 rad over 0.4 s, eased) with limbs flared, while `instanceColor` fades toward `palette.ink` and scale fades out over the existing 0.85 s window. Same `diedAt` bookkeeping, same fade math. |
| **spawn** | Replace the scale jitter shimmer with a 300 ms `instanceColor` flash from white → zone colors. Cleaner on daylight, one less scale term. |
| **damage flash** | Track previous `health` per id (preallocated map, same lifecycle as `generations`). On decrease: `flashUntil = t + 0.12 s`; while flashing, lerp every zone color 70 % toward **white**. White, not red — red-on-red torso is invisible, and whiteout reads on every zone in daylight. Pairs with the existing hit sparks so the *body* confirms the hit, not just the crosshair. |

All state lives in preallocated typed arrays / existing Maps keyed by id with
the existing eviction sweep. No `new` in `update()` — same discipline the file
already follows.

### 1.6 Enemy pop on daylight — cost-checked

Decision matrix over the three candidates:

| option | pop | Chromebook cost | verdict |
|---|---|---|---|
| additive rim shells (today) | ~zero (washes out on bright sky — J3 precedent) | 2 draws | **delete** |
| fresnel rim emissive in material | weak — rim lighting needs curvature; these are flat boxes | ~free | reject |
| **inverted-hull ink outline** | strong — dark contour on bright world, the toon-cel precedent already in the style contract | +9 instanced draws, ~×2 vertex load on ~500 verts/character = trivial; zero fill-rate risk (BackSide, opaque) | **adopt** |

Implementation: 9 more `InstancedMesh`es sharing the part geometries, one
`MeshBasicNodeMaterial({ side: BackSide })` colored `palette.ink`, matrices
written in the same loop as the parts with scale ×1.05 (compose once into the
scratch, multiply scale, `setMatrixAt` — no alloc). Screen-space outlines are
rejected outright: the pivot's "zero post" is binding.

`rimTorso`/`rimHead` and `writeRim` are **deleted** in the same change.

### 1.7 Nameplates

Keep the DOM system (cheap, already occlusion-tested). Changes:

- Anchor `+1.9` → `+2.05` (taller head + outline).
- Add tier to the label: `p3 · 4/8` → rendered as name + small tier pips
  (CSS `::after`, data-attribute driven — zero draw calls). `weaponTier` is
  on the entity, already in `remotePlayers`. This is the second half of the
  tier-readability contract: gun silhouette at close/mid range, pips at
  nameplate range.
- Damage-flash tie-in: add `.hit` class for 120 ms when that player's health
  drops (main.ts already iterates `remotePlayers` next to the nameplate loop).

---

## 2. Instancing strategy (the §4 question, answered)

Decision matrix, 6–12 characters × 9 parts + outlines + weapons:

| strategy | draws | alloc | coherence | verdict |
|---|---|---|---|---|
| **one InstancedMesh per part type** (today's architecture, extended) | 9 + 9 + W, **flat regardless of player count** | zero (matrix writes into existing buffers) | is literally the current code shape | **winner** |
| merged non-skinned rig per player (one Mesh each) | 12–24 (scales with players), per-part movement requires per-frame geometry rewrite or bones | geometry rewrite = worst-case alloc/upload | new pipeline | reject |
| SkinnedMesh per player | needs a skeleton/animation system this spec explicitly avoids; 12 skinned draws | bone matrices per frame | foreign to codebase | reject |

Per-part instancing also gets zone colors for free (`instanceColor` is
per-instance = per-player = exactly the granularity zones need) and keeps the
`HIDDEN`-matrix parking + `Math.max(1, count)` patterns untouched.

---

## 3. First-person presence

### 3.1 Verdict on "do the GLTFs actually load?"

**Yes — and then the code makes them look procedural.** Files exist, are
plain glTF (no decoder deps), URLs are base-path-safe (`?url` imports).
The failure is downstream:

- guns: authored materials overwritten with flat orange (§0.2 item 1) — the
  fallback prims and the "loaded" guns are near-indistinguishable in tone,
  which is why the game reads as if assets never landed;
- arms: bind-pose skinned mesh with a no-op IK poke (§0.2 item 4);
- Arc/Peacemaker/Discus: no GLB mapped at all — prim-only by construction.

### 3.2 Fixes

1. **Vertex-color bake + session cache** (`weapon-geometry.ts`, §1.4).
   `loadVendoredModel` consumes `getWeaponGeometry(weaponId)` instead of
   loading raw: one fetch/parse per weapon per session (kills the per-tier-up
   hitch), single merged geometry (fewer viewmodel draws than today's
   multi-mesh scene), **authored Quaternius color scheme visible at last**
   via one shared `vertexColors: true` standard material. The style-swap hook
   (`setMaterial`) keeps working — the vertex-color material is style-owned.
   Keep per-weapon normalization but switch from `0.95/longest` to the
   §1.4 length table divided by `hold.scale`, so first-person and third-person
   guns agree on proportions.
2. **Arm poses per weapon class — pose the real bones.** Data table keyed by
   silhouette class (`oneHanded` = pistol-family/goldie, `twoHanded` =
   smg/rifle/shotgun/scout/arc/launcher/discus, `blade` = knife):

   ```ts
   interface ArmPose { // euler XYZ per bone, radians
     readonly right: Readonly<Record<"shoulder"|"bicep"|"forearm"|"wrist", V3>>;
     readonly left:  Readonly<Record<"shoulder"|"bicep"|"forearm"|"wrist", V3>>;
     readonly leftVisible: boolean; // one-handed: left arm drops out of frame
   }
   ```

   On `setWeapon`: look up bones once (`getObjectByName` at load, cached in a
   `Map<string, Object3D>` — never per frame), then slerp bone quaternions to
   the pose over the existing 140 ms equip window (preallocated target
   quaternions; slerp in `update`). Delete the `wrist_ik.l` code path — it
   provably does nothing. Initial pose values are author-by-eye against the
   crowbar/pistol/rifle holds; they are data, tunable without code.
3. **Optional (P5b): analytic left-arm reach.** If the posed left arm doesn't
   convincingly meet `hold.foregrip` across all two-handed weapons, add a
   closed-form 2-joint solve (shoulder→elbow→wrist to a point: law of
   cosines, ~30 lines, scratch vectors only). Explicitly optional — the pose
   table alone must ship first and may be enough.
4. Fallbacks stay (cylinders / prim silhouettes, warn-once), but add a
   one-time `perf`-panel note (`assets: fallback`) so a broken deploy is
   visible in the backtick panel instead of silent in the console.

---

## 4. Draw-call & frame budget delta

| system | today | after spec | delta |
|---|---|---|---|
| character parts | 6 | 9 | +3 |
| rim shells | 2 | 0 | −2 |
| ink outlines | 0 | 9 | +9 |
| held weapon props | 0 | ≤6 typical / 13 worst | +6…13 |
| footstep dust | 1 | 1 | 0 |
| **character subtotal** | **9** | **≤25 typical / 32 worst** | **+16 typical** |

Headroom check: budget is ≤150 total; the character allocation stays a small
slice, and every added draw is instanced with static geometry. Vertex cost:
~500 verts/character ×2 (outline) ×12 + weapon geometry (a few k verts each,
shared) — noise on Iris Xe. CPU: matrix composes grow from 6 to ~19 per
character per frame (~230 total at 12 players) — trivial next to the sim
tick; the `characters` perf mark (already emitted by main.ts) is the regression
tripwire, budget 1.0 ms holds.

Zero-alloc audit points for review: no `new` inside `update()`; instanceColor
buffers created in constructor; per-id state in preallocated arrays/Maps with
the existing eviction sweep; `getWeaponGeometry` promises resolve outside the
frame loop and only flip `visible`/add meshes once.

---

## 5. Implementation plan — phases ranked by look-impact-per-effort

Ordered strictly by (how much less shitty the game looks) ÷ (effort). Each
phase ships independently and leaves the game consistent.

### P1 — First-person gun truth (S effort, highest impact density)
Files: `client/src/weapon-geometry.ts` (new), `client/src/precision-viewmodel.ts`,
`client/src/viewmodels.ts` (fallback path only).
- Build `getWeaponGeometry` (fetch-once cache, transform+vertex-color bake,
  merge, length-normalize; prim-bake path for Arc/Peacemaker/Discus).
- `loadVendoredModel` consumes it; shared `vertexColors` material; delete the
  material-override traverse.
- Acceptance: tier-up shows a *colored* gun with no fetch hitch on second
  equip of the same weapon; Quaternius wood/metal tones visible; visual test
  pixel diff of the viewmodel changes (expected).
- Why first: it upgrades the pixels the player stares at 100 % of the time,
  touches two files, and builds the exact machinery P3 needs.

### P2 — Remote silhouette v2 (M effort, transforms every fight)
Files: `client/src/combat-visuals.ts` (rewrite `RemoteCharacterSystem`
internals; public constructor/update shape unchanged), `client/src/render-style.ts`
(add `skin` palette slot + white-base character material rule).
- 9-part proportions (§1.1), pivot-at-top limbs, zone colors via
  `instanceColor` (§1.2), viewYaw facing + aim-pitch spine (§1.3), duck pose,
  death pop, spawn flash, damage flash (§1.5). Delete rim shells.
- Widen `RemoteCharacterState` (§1.3) — no main.ts changes needed for data
  (entities already carry the fields); only the nameplate `.hit` class touch.
- Acceptance: standing enemy visibly points their aim at you; duck reads as
  crouch; body whitens on your hits; `?visualtest=1` bot updated with the new
  fields' real values; `characters` perf mark ≤ 1.0 ms at 12 bots.

### P3 — Weapons in enemy hands (S–M effort; rides P1)
Files: `client/src/combat-visuals.ts`, `client/src/main.ts` (nameplate pips),
`client/src/style.css`.
- Lazy per-weaponId InstancedMesh props from `getWeaponGeometry`; right-arm
  aim carry, left-arm two-handed reach; nameplate tier pips.
- Acceptance: at 20 m you can tell a scout from a pistol; tier pips match the
  scoreboard; draw calls stay ≤ budget in the perf panel with a full lobby.

### P4 — Ink outlines (S effort, the "pop" line item)
Files: `client/src/combat-visuals.ts`.
- 9 BackSide-hull InstancedMeshes at scale ×1.05, `palette.ink`, matrices
  written in the same part loop; weapon props excluded (their vertex-color
  contrast is enough — revisit only if playtest disagrees).
- Acceptance: enemy at 40 m against the bright sky/ground boundary is
  unmistakable; frame time delta < 0.2 ms on the Chromebook-class target.

### P5 — WRAD arms posed per class (M effort, polish tier)
Files: `client/src/precision-viewmodel.ts`.
- Bone-pose table + equip-window slerp (§3.2.2); delete the `wrist_ik.l`
  no-op; `assets: fallback` perf-panel surfacing. Optional P5b analytic
  left-arm reach if the table alone can't sell two-handed grips.
- Acceptance: pistol vs rifle vs knife show visibly different arm holds; no
  bind-pose "corpse hands" in any weapon; zero per-frame allocation
  (quaternion targets preallocated).

Dependency edges: P3 depends on P1 (geometry cache) and P2 (hand transforms).
P4 and P5 are independent of each other. P1 has no dependencies — start there.

---

## 6. Explicitly out of scope / rejected

- **Skeletal animation system, clip playback, ragdoll physics** — the spec's
  motion is 100 % transform composition + instanceColor; that ceiling is a
  feature (zero new runtime, zero GC surface).
- **Screen-space outlines / rim post** — pivot forbids post; additive rims
  empirically die on the high-key sky.
- **New character asset downloads** (Quaternius Universal Characters etc.) —
  out of contract for this spec; if they land later, the part-instancing
  system remains the LOD/fallback and the state contract (§1.3) already
  carries everything a skinned rig would need.
- **Per-player cosmetic variation** (hue nudges, hats) — cheap later via the
  zone-color writer, but it's theatre until the base read is right.
