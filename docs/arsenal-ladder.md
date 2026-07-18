# ARSENAL — the second gun-game ladder (owner directive 2026-07-18)

> Design doc, Fable-authored (taste surface). Mechanics are homages; all names are
> ours (mechanics aren't copyrightable, names/art are). Folded into SPEC §3.5 as
> Amendment A1. Implementation lands in Phase 3 (Codex).

## Design thesis

A gun-game ladder is a tasting menu. The classic ladder (pistol→SMG→shotgun→
rifle→scout→knife) is CS comfort food. ARSENAL is the museum tour: eight weapons,
each the all-time best at a DIFFERENT kind of satisfaction, ordered so the match
escalates from warm competence to assassin tension, with a movement explosion in
the middle. One rule shaped every pick: it must reward a skill our movement
system makes MORE expressive, not less — low gravity and 2-second hangtimes are
the canvas.

## The ladder

| # | Ours | Homage | Class | Why it's all-time |
|---|---|---|---|---|
| 1 | **Sidewinder** | Halo CE Magnum | hitscan pistol, 3-tap, headshot bonus | The greatest starting weapon ever shipped — instantly lethal in good hands, honest in bad ones. Sets the tone: aim is everything. |
| 2 | **Boomstick** | Doom II Super Shotgun | 20-pellet double blast, one-shot inside ~3 m, slow rack | The most physically satisfying trigger pull in games. Forces hug-range play — a rhythm break after tier 1's poking. |
| 3 | **Arc** | Quake Lightning Gun | continuous hitscan beam, DPS-while-tracking | The pure tracking test. In low gravity, tracking a floating enemy with a crackling beam is hypnotic. |
| 4 | **Peacemaker** | Quake Rocket Launcher | projectile, ~25 m/s, 3 m splash + falloff, knockback (self-knockback ON) | The most beloved FPS weapon of all time — and the mid-match twist: **rocket jumps unlock here**. Low gravity × splash knockback = flight. The match's tempo visibly changes at tier 4. |
| 5 | **Discus** | Tribes Spinfusor | fast flat disc ~40 m/s, direct-hit bonus, small splash | The airshot instrument, in the game literally named for airshots. Leading a floating target with a disc across a 2-second hangtime is our signature moment, distilled. |
| 6 | **Longshot** | Quake 3 Rail × AWP | heavy one-shot hitscan, slow refire, visible beam + ding | Rail culture is scout culture graduated. After two projectile tiers, snapping back to instant-hit discipline is the skill whiplash that makes ladders fun. |
| 7 | **Goldie** | GoldenEye Golden Gun | one-shot-kill pistol, ONE round, 1.2 s reload | The original party-game finisher. One bullet means every engagement is a duel with a held breath. Peak tension exactly where a ladder should peak. |
| 8 | **The Bar** | Half-Life crowbar | melee finish, bonk | The humiliation finish, GoldSrc dialect. Melee-kill demote rule applies all match (getting Bar'd sends you down a tier). First Bar kill wins. |

Escalation logic: aim → meat → tracking → movement → prediction → precision →
nerve → humiliation. Tiers 4–5 are the emotional core; 6–8 tighten the screws.

## Engine honesty (what this costs)

- Tiers 1–3, 6–8: existing hitscan/melee machinery. SSG = 20 traces with spread;
  Arc = per-tick trace while held; Goldie = ammo-count state. Cheap.
- **Tiers 4–5 require the minimal projectile system** — the one real scope add,
  and the reason this is a spec amendment: server-simulated projectiles as
  replicated entities (create/delete/generation bits already exist in the
  protocol), client predicts its OWN projectiles (spawn locally, reconcile),
  splash + knockback feed the existing pmove velocity (knockback is just a
  velocity add — and it's what makes rocket jumps real). Projectiles do NOT use
  lag-comp rewind (industry standard: they exist in server time; hitscan keeps
  the rewind path). One archetype, two tunings (rocket arc vs disc speed).
- Justification against no-nonsense: rocket-jumping in 5.5 m/s² gravity is the
  single highest-fun-per-line feature available to this codebase. The movement
  system is already built for it (knockback = one vector add into a sim that
  already handles ballistic flight beautifully).

## Rules

- Room creation picker: Gun Game offers ladder choice — CLASSIC or ARSENAL
  (immutable at creation, like every room config).
- All existing gun-game rules unchanged: kill advances, melee-kill demotes the
  victim one tier, late-joiner rule per Phase 3 decision, map follows mode.
- Feel constants (damage, speeds, splash radii, knockback impulse, refire times)
  live in `shared/weapons.ts` as dials — tuned in-playground like movement was.
