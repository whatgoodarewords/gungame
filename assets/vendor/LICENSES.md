# Vendored asset licenses

All assets listed here are dedicated to the public domain under CC0 1.0. Credits
are included as a courtesy, not an attribution requirement.

| Directory | Author / pack | Source | License |
|---|---|---|---|
| `quaternius-ultimate-guns/` | Quaternius, Ultimate Guns Pack | https://quaternius.com/packs/ultimategun.html and https://poly.pizza/u/Quaternius | CC0 1.0 |
| `creative-trio-crowbar/` | CreativeTrio, Crowbar | https://poly.pizza/m/MkTjC7C7bN | CC0 1.0 |
| `kenney-impact/` | Kenney, Impact Sounds | https://kenney.nl/assets/impact-sounds | CC0 1.0 |
| `kenney-sci-fi/` | Kenney, Sci-Fi Sounds | https://kenney.nl/assets/sci-fi-sounds | CC0 1.0 |
| `kenney-interface/` | Kenney, Interface Sounds | https://kenney.nl/assets/interface-sounds | CC0 1.0 |

The `.source.ogg` files are unmodified excerpts from the listed Kenney packs.
Their sibling `.ogg` files are build inputs normalized to a decoded peak of
-6 dBFS. The original Kenney zip archives are retained for provenance and
validation but are not imported into the client bundle.

Procedural fallbacks contain no third-party assets:

- first-person capsule arms replace WRAD ARMS, whose itch.io payload could not
  be fetched by the headless build environment;
- the instanced humanoid rig and run/strafe/jump/death poses replace the
  Quaternius Universal Base Characters and Universal Animation Library payloads,
  whose JavaScript-gated download could not be fetched headlessly;
- Kenney samples plus existing synthesis replace the authentication-gated
  michorvath Freesound files.
