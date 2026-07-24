# Gun asset report — 2026-07-24

Hunt scope: poly.pizza, quaternius.com, Kenney.nl, OpenGameArt, itch.io
(KayKit / Pichuliru), Sketchfab. Everything vendored below was validated by
parsing the GLB JSON chunk (mesh/joint/animation census) **and** a full
`@gltf-transform/core` NodeIO read — all 26 new GLBs load clean.

## 1. Verdict on the existing `quaternius-ultimate-guns/` pack

**The models are real guns, not the problem — but they are statues.**

Evidence from the GLB JSON chunks (all 10 files parsed):

| File | Mesh node | Tris | Dims (X,Y,Z) | Parts |
|---|---|---|---|---|
| pistol.glb | `Pistol_1` | 1,040 | 1.82, 1.16, 0.32 | 1 merged mesh |
| smg.glb | `SubmachineGun_2` | 1,374 | 4.04, 1.85, 0.32 | 1 merged mesh |
| shotgun.glb | `Shotgun_2` | 746 | 5.79, 0.95, 0.25 | 1 merged mesh |
| rifle.glb | `AssaultRifle_2` | 1,304 | 5.42, 1.60, 0.20 | 1 merged mesh |
| scout.glb / deadeye.glb | `SniperRifle_5` / `_3` | 1,688 / 1,722 | ~6.3–7.2 long | 1 merged mesh |
| goldie.glb / sidewinder.glb | `Revolver_1` / `_5` | 1,046 / 1,334 | ~1.9 long | 1 merged mesh |
| boomstick.glb | `Shotgun_SawedOff` | 956 | 3.69, 1.02, 0.42 | 1 merged mesh |
| bayonet.glb | `Bayonet` | 240 | 1.17, 0.23, 0.13 | 1 merged mesh |

- Proportions are correct (pistol 1.8 units long × 1.16 tall; rifle 5.4 long —
  ratios match real weapons), mesh names are unambiguous, materials are sane
  multi-slot flat colors (`DarkMetal`, `Wood`, `Black`…). These will *read* as
  guns. If they aren't showing up in-game, that's a render/integration bug
  (scale/camera/layer), **not** a bad asset — nothing in the files is broken.
- **Fatal limitation:** every gun is a single merged mesh. Zero skeleton, zero
  slide/mag/bolt separation, zero animations. No future for reload/rack
  animation without re-modelling.
- Barrel axis: **+X**, up **+Y**. Arbitrary units (~1.8 u pistol), so they
  already need a per-model scale factor.

**Verdict: adequate as static props, dead end for a first-person viewmodel.
Superseded by the two packs below. Keep for pickups/world-drops if useful.**

## 2. What was fetched (26 new GLBs, 3 packs, all validated)

### `assets/vendor/pichuliru-flat-guns-west/` — THE viewmodel pack
CC0 Flat Guns West by Pichuliru (opengameart.org/content/cc0-flat-guns-west).
10 guns, US/European designs (M1911/Glock-ish pistols, MP5/UZI-ish SMGs, pump
+ auto shotguns, AR-15 + battle rifle, bolt sniper + DMR). 1.0–4.4k tris each.

Why it wins: every gun is skinned to a **functional rig** — e.g.
`Rifle_Assault_West.glb` joints: *Body, Magazine, Trigger, Selector, Bolt
Release, Magazine Release, Forward Assist, Charging Handle, Stock, Bolt, Rear
Sights, Front Sights, Dust Cover* + `Attach_Scope`, `Attach_Rail.*`,
`Attach_Muzzle` sockets. Pistol has *Slide / Slide Release / Hammer / Magazine*
bones. Shotgun has a *Pump* bone. You animate reload/rack by keying bones in
code — no Blender needed. Flat-color materials (no textures) fit the bright
stylized art direction and recolor trivially.

### `assets/vendor/pichuliru-flat-guns-east/` — the alternate skin set
Same author/format/rig conventions, 10 Russian/Eastern designs (AK-pattern
assault rifle, PM-style pistols, Saiga-ish auto shotgun, SVD-ish sniper).
Perfect as a second faction/team weapon set or arsenal-ladder variants.

### `assets/vendor/quaternius-animated-guns/` — free baked animations
Quaternius Animated Guns (quaternius.com/packs/animatedguns.html; Google
Drive; FBX→GLB via FBX2glTF 0.9.7, originals kept in `fbx/`). Six guns, each
with skeleton **and baked clips** (verified durations):

| File | Tris | Clips |
|---|---|---|
| Pistol.glb | 1,491 | Fire 0.54s, Reload 0.67s, Slide 0.29s |
| P90.glb | 954 | Fire 0.21s, Reload 0.79s |
| Rifle.glb | 1,912 | FireWBullet 2.0s, FireWOBullet 1.08s, Reload 1.08s |
| Shotgun.glb | 1,033 | FireWBullet 0.71s, FireWOBullet 0.42s, Reload 0.25s |
| SniperRifle.glb | 1,710 | FireWBullet 0.79s, FireWOBullet 0.38s, Reload 0.92s |
| Revolver.glb | 2,812 | Fire 0.71s, Reload 1.92s |

Chunkier toon style than Flat Guns; use if you want zero animation work, or
mine the clips for timing reference.

### Rejected (and why)
- **Kenney Blaster Kit** — CC0, GLTF, removable mags/scopes, but 100% sci-fi
  blasters; fails "reads as a real weapon instantly".
- **KayKit (Kay Lousberg)** — fantasy melee only (swords/bows); no firearms.
- **OGA "Low Poly Guns Pack"** — is literally the Quaternius Ultimate Guns
  mirror; already vendored.
- **OGA "Ultimate Low Poly Guns"** (71 guns, TastyTony/Pichuliru) — CC-BY 4.0
  would be fine with CREDITS, but `.blend`-only; no Blender here, conversion
  not trivial → skipped.
- **OGA "Low Poly Weapons Pack with rigged arms"** — CC0 but only 2 weapons,
  format unstated; strictly dominated by Flat Guns.
- **Sketchfab CC0** — per-model downloads sit behind account auth/API token;
  no credentials in this environment. Nothing seen there beat Flat Guns
  anyway. Revisit only if a specific hero model is wanted.

## 3. Recommended weapon → file mapping (single best pick per slot)

| Slot | File | Why |
|---|---|---|
| **Pistol** | `pichuliru-flat-guns-west/Pistol_Full_West.glb` | Unmistakable full-size service pistol; Slide + Hammer + Magazine bones for rack/reload |
| **SMG** | `pichuliru-flat-guns-west/SMG_Full_West.glb` | MP5 silhouette; Bolt/Magazine/Stock bones |
| **Shotgun** | `pichuliru-flat-guns-west/Shotgun_Pump_West.glb` | Classic pump; dedicated **Pump** bone = the one animation that sells a shotgun |
| **Assault rifle** | `pichuliru-flat-guns-west/Rifle_Assault_West.glb` | AR-15 silhouette; richest rig (19 joints incl. Charging Handle, Bolt, Dust Cover) |
| **Sniper** | `pichuliru-flat-guns-west/Sniper_Rifle_West.glb` | Bolt-action with scope-ready `Attach_Scope`; Bolt bone for cycle animation |

One pack for all five slots = one coherent art style, one scale, one
orientation convention, one material system. East pack = team-2 / upgrade
variants (`Rifle_Assault_East` is the AK counterpart). Quaternius animated
pack = fallback / timing reference.

## 4. Orientation & scale notes

**pichuliru-flat-guns-west / -east (all 20 models)**
- Real-world meters: Pistol_Full 0.218 long, Rifle_Assault 0.697,
  Sniper_Material 1.167. Use ~1.0 scale in a metric world.
- **Barrel/forward = −Z, up = +Y** (verified numerically: Rifle_Assault_West
  world bone positions — Attach_Muzzle z=−0.304, Front Sights z=−0.248, Stock
  z=+0.30). This is exactly three.js camera-forward: parent to the camera with
  no rotation.
- Guns are `SkinnedMesh`es: set `frustumCulled = false` on the viewmodel
  (skinned bounds don't follow bones), and pose parts via
  `skeleton.getBoneByName("Slide")` etc. `Attach_*` bones are empty sockets
  for scopes/muzzle flash — put the muzzle-flash sprite on `Attach_Muzzle`.

**quaternius-animated-guns**
- Arbitrary units, ~8.5–11 u long per gun → scale ~0.07–0.10 for meters.
  Not uniform: Pistol is 9.7 u long, P90 11.1 u.
- Axes are inconsistent per model: **Pistol barrel = +X** (verified: Muzzle
  bone world x=+4.68), the other five are long on **±Z**; sign needs a
  one-look visual check in-engine (recoil/eject are baked in the clips, so a
  wrong guess is instantly obvious — flip with `rotation.y = Math.PI`).
- Clips are named `<X>Armature|Fire` etc. (note: SniperRifle's armature name
  has a trailing space: `"SniperRifle |Fire..."`) — play via `AnimationMixer`.

**quaternius-ultimate-guns** (existing): barrel +X, up +Y, arbitrary units
(pistol 1.8 u).

## 5. License table

| Pack | Author | License | Attribution required | Proof |
|---|---|---|---|---|
| pichuliru-flat-guns-west | Pichuliru | CC0 1.0 | No (credited anyway) | OGA page states CC0; pack `LICENSE.txt` |
| pichuliru-flat-guns-east | Pichuliru | CC0 1.0 | No (credited anyway) | OGA page states CC0; pack `LICENSE.txt` |
| quaternius-animated-guns | Quaternius | CC0 1.0 | No (credited anyway) | Pack page links CC0 deed; pack `LICENSE.txt` |
| quaternius-ultimate-guns (existing) | Quaternius | CC0 1.0 | No | `LICENSES.md` |

No CC-BY, NC, or "personal use" material was vendored; nothing needs a
CREDITS entry to be compliant. All three new packs are registered in
`assets/vendor/LICENSES.md`.

## 6. Bytes

| Pack | Files | Bytes |
|---|---|---|
| quaternius-animated-guns | 6 GLB + 6 source FBX + LICENSE | 1,828,717 |
| pichuliru-flat-guns-west | 10 GLB + LICENSE | 2,541,358 |
| pichuliru-flat-guns-east | 10 GLB + LICENSE | 2,021,746 |
| **Total** | **35 files** | **6,391,821 (~6.1 MB)** |

Largest single file: `Rifle_Assault_West.glb` at 457,644 B. No textures
anywhere — all flat materials — so nothing else to load.
