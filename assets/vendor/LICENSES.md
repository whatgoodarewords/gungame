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
