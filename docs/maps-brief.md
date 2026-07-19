# Maps brief — the two v1 maps (Fable-authored design; built in Phase 4)

Design law from the spec: map follows mode; 2 maps; geometry-first (RenderStyle
applied after the bake-off); every surface angle is a gameplay decision (walkable
< 45.57° < surf — the sim makes exactly-45° ground and steeper-than-45° surf).

## Map 1 — "Spire" (Scoutzknivez map)

The scoutzknivez archetype perfected: one grand vertical room, no corridors —
scoutz dies in corridors. Reference feel: scoutzknivez's open box + towers, but
composed like a cathedral nave.

- **Footprint** ~80×50 m, ceiling ~40 m (2-second hangtimes need headroom; at
  scoutz gravity a full jump arcs ~4 m up and ~14 m across — all gaps sized off
  that number).
- **Five platform masses**: two team "organ lofts" (spawn ends, 12 m up, three
  stepped tiers so spawns aren't a single sightline), a **central spire** (the
  power position: highest perch at 22 m, exposed from every direction — you take
  it by airshot dominance, you lose it the same way), and two **flanking fins**
  (8 m, offset laterally so cross-map jumps have a mid-route commit point).
- **Surf ribbons**: the two long walls are 50°-canted for their middle band —
  wall-ride escapes and flanks (the sim's surf mechanic, made architectural).
- **The floor is lava-floor rule, without lava**: floor is fully walkable but
  totally exposed to everything above; being grounded IS the danger state. One
  kill volume: a narrow center trench (drama + the only hard hazard).
- **Secret**: strafe-chain ledge high on the north wall → dev-times room
  (graffiti + names wall, per the Easter-egg plan).
- 12 spawns/team across the loft tiers, all facing the spire.

## Map 2 — "Foundry" (Gun Game arena)

Tight-but-tall FFA arena for 2–12: the gun-game archetype is a figure-eight flow
with no camping spot that two tiers of the ladder can't punish.

- **Footprint** ~45×45 m, ceiling 18 m. Central **crucible pit** (shotgun/knife
  heaven, two ramp exits + one 30° jump-ramp exit) ringed by a **catwalk ring**
  (rifle/rail lanes, broken by two pillar clusters so no full-circle sightline).
- **Figure-eight flow** through two side halls (SMG/pistol midrange), each with
  a stepped 0.4 m-ledge stack (duck-tap mantle route — rewards the mechanic).
- **One 47° surf wedge** across a corner of the pit: the fast rotate and the
  rocket-jump-free escape route; also the Discus airshot gallery in ARSENAL.
- **Verticality without dominance**: catwalk sees pit, pit has three fast ways
  up, halls see neither fully — every position is strong against one zone and
  weak to another.
- **Secret**: knifeable "gg" sigil behind a pillar (jingle, once per match).
- 16 FFA spawns, anti-farm scored (never spawn in a live sightline of your
  killer; the Phase 3 spawn selector already scores by threat distance).

## Shared build rules

- Author in Blender against the pipeline conventions (col_/spawn_/kill_ nodes);
  greybox first, style pass after the bake-off; every ramp angle chosen
  deliberately against the 45.57° threshold; a 0.4 m ledge somewhere on every
  main route (duck-tap texture); no surface a player can stand on that the
  designer didn't intend (audit with the validator + a bot-roam pass).

## Map 3 — "Duna" (Gun Game arena #2; the dust2 homage — owner request 2026-07-19)

Original geometry and name; the LAYOUT ARCHETYPE of de_dust2 (layouts aren't
copyrightable; the artistic work is — no textures, proportions, or landmarks
copied). What we keep is the flow everyone's hands remember:
- **Mid with doors-gap sightline** (our version: a broken arch slit) splitting
  two rotation halves; **Long** (the map's rail/Deadeye lane, one 70 m
  sightline, entrance dogleg so it can't be held from spawn); **Catwalk/short**
  elevated route with the classic drop-down into a site-like plaza; **Tunnels**
  (low, tight — Boomstick country) under the other half; two open "site"
  plazas as the FFA hot zones.
- Scaled to our movement: all routes 20% wider than CS proportions (we're
  faster), tunnel ceilings 4 m (bhop headroom), catwalk drop is coyote-friendly.
- One surf ribbon along Long's outer wall (the modern twist on the archetype).
- 16 FFA spawns, anti-farm scored. Secret: a crate-parkour ledge above mid
  with the graffiti room.

## Map 4 — "Cascade" (the most-fun-possible map — owner request 2026-07-19)

Design target: the map itself is a rhythm instrument. Every considerations
pass (movement thesis, flow, readability, 2–12 scale, comeback geometry):
- **The Loop**: a terraced canyon ring (~90 m circumference) with a continuous
  gentle downhill grade in the run direction — you can bhop the loop endlessly,
  each lap building speed like a velodrome. The floor undulates in 3 low waves
  per quarter (ramp-hop rhythm: jump timing IS the skill).
- **The Crossing**: two bridges span the canyon at different heights, offset
  45° — the airshot galleries. Anyone on the loop is periodically silhouetted
  to the bridges and vice versa: exposure is rhythmic, never constant.
- **Terraces**: three tiers up the inner wall, rocket-jump/duck-tap shortcuts
  between them; top tier sees both bridges but not the loop floor (no single
  dominant position).
- **Surf rim**: the entire outer canyon wall above 2 m is a 50° surf ribbon —
  the escape/flank layer; a full surf lap is possible and glorious.
- **The Well**: center-bottom kill-volume pit with a rim walkway — the
  highest-tension knife-hunt floor; falling in is always your own fault.
- Comeback geometry: spawns feed the loop tangentially (instant flow state,
  never spawn-facing-wall); no position holds more than one layer.
- Secret: a waterfall-notch room behind the surf rim, strafe-chain entry.
