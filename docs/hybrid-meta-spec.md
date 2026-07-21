# Hybrid meta pivot — "more fun than CS" (owner directive 2026-07-20)

Verdict that triggered this: "all of the mechanics feel bad… it's like you made
Doom and I'm asking for Counter-Strike 3." Weighted meta analysis (chat log
2026-07-20) ranked the **movement-precision hybrid** first: CS's gunfight
discipline fused with our movement fun-floor. CS's weight without CS's
punishing first hour.

## The keystone: velocity-based accuracy

Shooting while moving is inaccurate; planting makes you a laser. This one
coupling creates the tactical rhythm ("stop → shoot → move") that IS the CS
feel. Movement tech stays (bhop, air-strafe, slide, rocket-jump — the fun
floor and the differentiation), but it now carries a cost in fights: moving
fast is for rotating and dodging, not for beaming. The mechanic self-balances
the movement meta — no nerfs needed.

Model (shared sim — client and server compute identical values):

```
frac  = clamp((hSpeed/runSpeed − accurateFraction) / (1 − accurateFraction), 0, 1)
spread = lerp(baseSpread, moveSpreadDegrees, frac)
if (!grounded) spread = max(spread, airSpreadDegrees)
```

- `accurateFraction` — the plant threshold: below this fraction of run speed
  you have full accuracy (CS walk-speed lineage).
- Scoped rifles get a separate moving-scoped spread (the scout discipline:
  moving while scoped is ruined, planted is divine).
- Projectiles (Peacemaker/Discus), Arc beam, and Knife are exempt: their
  identity is mobility.

Per-weapon table (degrees):

| Weapon | base | move | air | accurateFrac | identity |
|---|---|---|---|---|---|
| Pistol | 0.35 | 2.2 | 5.0 | 0.34 | plant-and-tap |
| SMG | 1.25 | 2.0 | 4.0 | 0.55 | the run-and-gun exception — mild penalty, high threshold |
| Shotgun | 5.5 | 6.5 | 8.0 | 0.45 | forgiving up close |
| Rifle | 0.18 | 3.4 | 7.0 | 0.30 | the discipline gun |
| Scout | 2.8 / 0.03 scoped | 6.0 / 1.2 scoped-moving | 9.0 | 0.25 | plant or nothing |
| Sidewinder | 0.22 | 2.2 | 5.0 | 0.34 | pistol family |
| Boomstick | 7.2 | 8.2 | 10.0 | 0.45 | shotgun family |
| Deadeye | 3.0 / 0.025 scoped | 6.0 / 1.1 scoped-moving | 9.0 | 0.25 | scout family |
| Goldie | 0.08 | 1.5 | 4.0 | 0.30 | the ceremony demands the plant |
| Arc / Knife / Peacemaker / Discus | — | — | — | — | exempt (mobility identity) |

## Deterministic spray (autos: SMG, Rifle)

RNG cones are what Krunker veterans mock; learnable patterns are what CS
players love. Fixed per-weapon pattern data (yaw°, pitch° per burst index),
applied to the fire direction server-side BEFORE the (now small) residual
cone. Burst index: consecutive shots within 1.8× refire; resets otherwise or
on weapon switch.

**Client parity contract:** the camera kick reads the SAME pattern table, so
pulling down/counter-steering compensates the actual bullet path — the CS
spray-control contract, by construction (one shared data source).

Rifle pattern (12): rises ~4.5° over 6 shots then weaves horizontally.
SMG pattern (16): rises ~2.6° over 8 then tight weave. First shot always
(0,0) — first-shot accuracy is sacred.

## Weight & read

- FOV default 105 → **95** (range stays 90–120). Tighter = weightier, and the
  CS-lineage read. Players who want 105 keep the dial.
- Crosshair bloom is LIVE-HONEST: the gap renders from the same
  effectiveSpread the server will use for your current velocity/air state —
  the mechanic teaches itself through the crosshair.
- Landing (air→ground) inherits air spread decaying to ground spread over
  ~90 ms (recovery reads as weight; number tuned by feel).

## Explicitly unchanged

64 Hz + sub-tick + lag comp (already genre-best), gun-game ladder, movement
tech itself, TTK values, damage table, no-gimmick clause: no abilities, no
loadouts, no economy in quickplay.

## Acceptance

- Sim unit tests: still=base, full-run=move, airborne=air, threshold
  boundary exact, scoped-moving table, exempt weapons unchanged, pattern
  determinism (identical bursts ⇒ identical directions), pattern reset.
- Replay parity: client/server effectiveSpread bit-identical over a recorded
  strafe+fire run.
- Feel gate (owner): rifle at plant deletes, rifle at full sprint misses;
  scout quickscope while moving whiffs; SMG run-and-gun still viable at
  close range; spray pull-down controls the rifle by shot 4.
