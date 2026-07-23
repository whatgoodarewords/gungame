# Asset Sourcing Report — real CC0 weapon audio, decals, particles

Date: 2026-07-23. Task: source REAL, redistribution-safe (MIT-repo-compatible)
gunshot audio, impact decals, and impact particles, vendored into
`assets/vendor/`. Nothing is wired into code; this is acquisition only.

Total added: **53.3 MB** (52,072 KB) across 4 new packs: 51 asset files
plus per-pack license/metadata files.
Every pack is CC0 1.0 — safe to redistribute inside this MIT repo, no
attribution legally required. All credits below are retained as thanks.

| Pack | Files | Size | License |
|---|---|---|---|
| `assets/vendor/ffsl-firearms/` | 10 WAV + CSV + LICENSE | 47.6 MB | CC0 1.0 |
| `assets/vendor/freesound-cc0-weapon-foley/` | 16 OGG + LICENSE | 1.3 MB | CC0 1.0 (per file) |
| `assets/vendor/oga-bullet-decal/` | 1 PNG + LICENSE | 0.34 MB | CC0 1.0 |
| `assets/vendor/kenney-particle-pack/` | 24 PNG + License | 1.6 MB | CC0 1.0 |

---

## 1. Gunshots — The Free Firearm Sound Library (`ffsl-firearms/`)

Source: https://opengameart.org/content/the-free-firearm-sound-library
(Kickstarter-funded field-recording project by Ben Jaszczak, Brian Nelson,
Kevin Heras, Matthew Nanney; "CC0 NO RIGHTS RESERVED" per the authors).
Full "Prepared SFX Library" archive is 194 MB / 56 recordings of 22 real
firearms; I curated 10 files — one weapon per gameplay class, each with the
library's **near** (player-perspective) and **mid** (distant/other-player)
takes. Format: 24-bit/96 kHz stereo WAV, ~4–10 s each including natural tail.
`Prepared-Master-Sheet.csv` (the library's own metadata) is retained.

### Weapon → sample mapping (opinionated)

| Game class | Real gun recorded | Player shot (near) | Remote/distant shot (mid) |
|---|---|---|---|
| Pistol | Colt 1911 .45 ACP | `pistol-1911-shot-near_A42P.wav` | `pistol-1911-shot-mid_A34P.wav` |
| SMG | Carl Gustav M45 9mm SMG | `smg-m45-shot-near_G31P.wav` | `smg-m45-shot-mid_G20P.wav` |
| Shotgun | Benelli Nova 12ga pump | `shotgun-nova-shot-near_O21P.wav` | `shotgun-nova-shot-mid_O17P.wav` |
| Rifle | AR-15 5.56 | `rifle-ar15-shot-near_D32P.wav` | `rifle-ar15-shot-mid_D24P.wav` |
| Sniper | Tikka T3 .30-06 bolt | `sniper-tikka-shot-near_W29P.wav` | `sniper-tikka-shot-mid_W24P.wav` |

Rationale: the 1911 is the classic punchy game pistol (the 9mm PPQ take is
7 MB heavier for no audible gain); the M45 is a true 9mm SMG (the PPSh takes
are 9–17 MB each); the Nova pair is the smallest of four recorded shotguns and
the most modern-sounding; AR-15 is the canonical FPS rifle; Tikka .30-06 has
the sharpest bolt-gun crack for sniper. Suffix (`A42P` etc.) = original
archive filename, so any file can be traced back to the master sheet.

Integration notes:
- Play **near** for the local player, **mid** for other players / positional
  audio. Mid takes double as the "distant-shot variants" requirement; for
  very far fire also layer `distant-gunshot-*` from the Freesound pack.
- Files are full-tail 24/96 stereo. If repo weight or decode time becomes an
  issue, the sanctioned move is the existing repo pattern (normalize to OGG,
  keep `.source` provenance) at integration time — I deliberately did not
  transcode (directive: convert nothing).
- Automatic fire: retrigger the single-shot sample per round. The library's
  burst recordings exist (AK-47/PPSh/M45 bursts) but were not vendored —
  engines fire per-shot; re-pull from the archive URL if wanted.

## 2. Foley, ricochets, distant shots — Freesound CC0 (`freesound-cc0-weapon-foley/`)

16 recordings, each individually CC0 (selected with Freesound's
`license:"Creative Commons 0"` search filter). Files are Freesound's own HQ
Ogg Vorbis encodes (~110–190 kbps, 44.1/48 kHz) — small and directly
web-playable. Per-file source URL + author + original title:
`assets/vendor/freesound-cc0-weapon-foley/LICENSE.txt`.

### Mapping

| Purpose | File | Notes |
|---|---|---|
| Pistol reload (full) | `pistol-reload-full_fs854499.ogg` | mag out → in → slide, 3.1 s |
| Pistol mag eject (layer) | `pistol-mag-out_fs719243.ogg` | 0.5 s, good for partial-reload UI |
| Pistol/SMG slide rack | `pistol-slide-rack_fs442560.ogg` | Sig P229; multiple racks — slice |
| Rifle reload | `rifle-reload_fs256912.ogg` | tight 3.5 s assault-rifle reload — primary |
| Rifle reload alt | `rifle-reload-m4_fs326042.ogg` | M4, 8.9 s full sequence — slice or alt |
| Shotgun pump (per-shot rack) | `shotgun-pump_fs673320.ogg` | primary pump between shells |
| Shotgun pump variants | `shotgun-pump-cycle_fs370344.ogg` | 11 s, multiple clean cycles — slice for round-robin |
| Sniper bolt cycle | `sniper-bolt-cycle_fs370345.ogg` | Mosin bolt, 14 s multi-take — slice |
| Weapon equip/draw | `weapon-equip-draw_fs239959.ogg` | holster draw, 1.7 s; use for weapon switch |
| Ricochet A | `ricochet-1_fs478345.ogg` | bright zing w/ tail |
| Ricochet B | `ricochet-2_fs394187.ogg` | classic western-style whine |
| Ricochet C | `ricochet-22cal_fs523403.ogg` | short real .22 ricochet — best for round-robin bulk |
| Distant gunfire 1 | `distant-gunshot-1_fs384717.ogg` | far echo, for off-map ambience / far players |
| Distant gunfire 2 | `distant-gunshot-3_fs384715.ogg` | variant |
| Bullet flyby (crack) | `bullet-flyby_fs855248.ogg` | 80 ms real supersonic snap — play when shots pass camera |
| Bullet whiz (subsonic) | `bullet-whiz-subsonic_fs789222.ogg` | 1.3 s whoosh variant |

Bullet **surface impacts** (metal/stone/concrete/wood/glass) map onto the
already-vendored `kenney-impact/` (CC0) — Freesound's CC0 pool for genuine
bullet-on-surface hits was thin, and Kenney's impact set is cleaner. Suggested:
metal hits → `impactMetal_*`, stone/concrete → `impactSoft_*`/`impactPlate_*`
layered with `spark_*` particles + a ricochet sample at low probability.

## 3. Bullet-hole decal — OGA Bullet Decal (`oga-bullet-decal/`)

- `bullet_hole.png` — 512×512 8-bit RGBA, by **musdasch**, CC0.
  https://opengameart.org/content/bullet-decal
- Grayscale-on-alpha; tint/multiply per surface material, and randomize
  rotation + scale (0.6–1.0) per hit for variety from the single texture.
  Layer `scorch_*`/`scratch_01` from the particle pack for material flavor
  (scorch on concrete, scratch on metal).

## 4. Impact particles — Kenney Particle Pack 1.1 subset (`kenney-particle-pack/`)

Source: https://kenney.nl/assets/particle-pack (CC0; pack's own `License.txt`
included). Vendored 24 of 80 sprites (512×512 transparent PNGs):

- `muzzle_01..05.png` — muzzle flashes (billboard at barrel, 1–2 frames)
- `smoke_01/03/05/07/09.png` — impact dust puffs + lingering barrel smoke
- `spark_01/03/05/07.png` — metal-impact sparks
- `dirt_01..03.png` — concrete/stone debris chunks
- `scorch_01..03.png` — surface burn decal variants (blend under bullet_hole)
- `trace_01/04/06.png` — tracer/streak billboards
- `scratch_01.png` — metal-surface gouge decal

## Licensing summary / CREDITS

All four packs: **CC0 1.0 Universal** — compatible with committing to a public
MIT repo and commercial use, no attribution required. Each vendored directory
carries its own license/provenance file; `assets/vendor/LICENSES.md` table
updated. Voluntary credits: FFSL authors (Jaszczak/Nelson/Heras/Nanney),
Kenney, musdasch, and the 12 Freesound recordists listed in the foley pack's
LICENSE.txt.

**Excluded on license grounds:** Sonniss GDC bundles — royalty-free to *use*
but their license bars redistributing the raw files, which vendoring in a
public repo would do. **Not replaced:** Quaternius weapon GLBs — surveyed
alternatives (Kenney Blaster Kit is sci-fi-only); nothing clearly better in
CC0 modern-weapon GLB form, so the vendored Quaternius set stands.

## Verification

All 51 asset files confirmed on disk (`ls` + `file`): WAVs are PCM 24-bit/96 kHz
stereo RIFF, OGGs are Vorbis 44.1/48 kHz and decode cleanly (ffprobe), PNGs
are well-formed 512×512. Browser-playable: WAV/OGG/PNG all decode natively in
Chrome/Firefox/Safari WebAudio + textures.
