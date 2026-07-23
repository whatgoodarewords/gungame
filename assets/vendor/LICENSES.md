# Vendored asset provenance

All runtime art/audio below is CC0 1.0. Attribution is not required; credits
are retained as provenance and thanks.

| Vendored path | Pack / author | Source | License |
|---|---|---|---|
| `wrad-arms/` | WRAD ARMS / wriks | https://wriks.itch.io/wrad-arms | CC0 1.0; archive includes `LICENSE.txt` |
| `quaternius-ultimate-guns/` | Ultimate Guns Pack / Quaternius | https://poly.pizza/bundle/Ultimate-Guns-Pack-cpgUfI4t2F | CC0 1.0 |
| `creative-trio-crowbar/` | Crowbar / CreativeTrio | https://poly.pizza/m/MkTjC7C7bN | CC0 1.0 |
| `kenney-impact/` | Impact Sounds / Kenney | https://kenney.nl/assets/impact-sounds | CC0 1.0 |
| `kenney-sci-fi/` | Sci-Fi Sounds / Kenney | https://kenney.nl/assets/sci-fi-sounds | CC0 1.0 |
| `kenney-interface/` | Interface Sounds / Kenney | https://kenney.nl/assets/interface-sounds | CC0 1.0 |
| `polyhaven/*` | textures and HDRIs / Poly Haven contributors | https://polyhaven.com | CC0 1.0 site-wide |
| `ffsl-firearms/` | The Free Firearm Sound Library / Jaszczak, Nelson, Heras, Nanney | https://opengameart.org/content/the-free-firearm-sound-library | CC0 1.0; pack `LICENSE.txt` |
| `freesound-cc0-weapon-foley/` | 16 individually CC0 Freesound recordings (per-file credits in pack `LICENSE.txt`) | https://freesound.org (license filter: Creative Commons 0) | CC0 1.0 per file |
| `oga-bullet-decal/` | Bullet Decal / musdasch | https://opengameart.org/content/bullet-decal | CC0 1.0; pack `LICENSE.txt` |
| `kenney-particle-pack/` | Particle Pack 1.1 (subset) / Kenney | https://kenney.nl/assets/particle-pack | CC0 1.0; pack `License.txt` |

The `.source.ogg` files preserve the selected source encodes; adjacent `.ogg`
files are normalized runtime derivatives. The KTX2 files are build derivatives
of the adjacent Poly Haven JPEGs/HDRIs.

## Acquisition flags

These CC0 packs remain download-gated in this environment and are represented
by the streamed procedural character/dressing fallback:

- Quaternius Animated Guns
- Quaternius Sci-Fi Modular Gun Pack / Sci-Fi Gun Pack
- Quaternius Universal Base Characters
- Quaternius Universal Animation Library

Owner action: download those four packs from the URLs in the acquisition plan
and place their GLB/glTF files in the matching empty vendor directories. The
runtime deliberately keeps the fallback until each archive passes validation.

The optional michorvath Freesound raw shots require authentication. Gunshot
body/mechanical/tail layers use Kenney CC0 plus synthesis when those files are
absent; no authenticated asset is represented as acquired.
