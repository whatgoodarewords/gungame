# Business model — future consideration (not a v1 decision)

> Saved 2026-07-18 from an in-session analysis at the owner's request. Nothing here
> blocks or changes v1 (MIT, free, open, self-hostable at dev.sml.world/gg).
> Revisit when the game has players.

## Premise

MIT license is locked. The game must remain **open source, moddable, and
self-hostable** — the business model has to thrive on openness rather than fight
it. History here is instructive because open-source games are sharply bimodal:
beloved-and-broke, or quietly sustainable.

## What history actually teaches

- **id Software (Doom/Quake, 1997–2005)** — the ethical gold standard: sell the
  game, then GPL the engine. Bought id decades of goodwill and immortality
  (ioquake3 descendants are alive 25+ years later). Lesson: code openness creates
  longevity; content is what people pay for. But their model assumed a paid
  client, which conflicts with our type-a-name-and-play thesis.
- **Mindustry (Anuke)** — the best modern template for a small team: 100% GPL on
  GitHub, free playable web/itch build, paid convenience builds on Steam and
  mobile (~$7). Tens of thousands of paying customers who could have compiled it
  free chose to pay for convenience, auto-updates, Steam workshop, and to support
  the dev. Zero community resentment because nothing is withheld. The single most
  sensible precedent for us.
- **Minecraft** — not FOSS, but the moddability/self-hosting lesson: letting
  anyone run a server and mod everything is why it conquered the world. Server
  openness was the growth engine, not a revenue leak.
- **Krunker.io** — proves browser-FPS economics: cosmetics-only monetization at
  massive scale (sold for a reported ~$100M). Also proves the ethical failure
  mode to avoid — its economy drifted into marketplace/gambling-adjacent
  territory.
- **Battle for Wesnoth / Veloren / Xonotic / Teeworlds** — pure FOSS + donations:
  beloved, immortal, never meaningful income. Donations alone are a tip jar, not
  a model.
- **Quake Live** — cautionary: free browser Quake with subscription, later
  abandoned the browser entirely. Subscriptions for *access* in a competitive FPS
  create constant pressure to paywall gameplay.

## Decision matrix

Bespoke criteria, equal weight: Ethics (no P2W, no gambling, nothing withheld),
Revenue ceiling, FOSS-fit (does openness help or hurt it), Ops burden (solo+AI
team), Community flywheel, Precedent strength. Scored 1–5.

| Model | Ethics | Revenue | FOSS-fit | Ops | Flywheel | Precedent | Σ |
|---|---|---|---|---|---|---|---|
| **A. Mindustry hybrid: free web + paid Steam/app convenience build** | 5 | 4 | 5 | 4 | 4 | 5 | **27** |
| B. Cosmetics on official servers (one-time buys, no lootboxes; self-hosts unlock everything) | 4 | 4 | 4 | 3 | 5 | 4 | 24 |
| C. Open-core hosted: free self-host; official ranked/tournaments as supporter sub | 4 | 3 | 5 | 3 | 4 | 3 | 22 |
| D. Donations/sponsors only | 5 | 1 | 5 | 5 | 3 | 2 | 21 |
| E. id model (paid game, open engine) | 5 | 3 | 3 | 4 | 2 | 4 | 21 |
| F. Ads/tracking on official site | 1 | 3 | 2 | 4 | 1 | 3 | 14 |

## Recommendation

**A now (structurally), B later (if there's a crowd), C only if ops grow a team.**

1. **Ship v1 exactly as planned:** free, open, browser-first at dev.sml.world/gg.
   The web build IS the marketing. No monetization surface in v1 at all —
   nothing to design, nothing to moderate, nothing to regret.
2. **When (if) the game has real players:** package the Mindustry move — a paid
   **Steam/desktop convenience build** (Electron/Tauri wrapper: instant launch,
   auto-update, Steam friends/workshop, native raw input) at an honest ~$5–8.
   The repo stays 100% complete; the purchase is convenience + patronage, never
   capability. This is the highest-Σ model and the one with zero ethical
   downside and near-zero added ops.
3. **Cosmetics (B) only as a later, additive layer** on official servers —
   one-time purchases, visible-price store, no lootboxes, no trading economy, no
   FOMO timers; self-hosted servers can unlock everything (a config flag —
   openness is the point, and it doubles as the anti-gambling guarantee).
   Krunker proves the ceiling; our guardrails avoid its drift.
4. **Never:** paywalled gameplay/ranked (Quake Live lesson), ads/tracking (F —
   torches trust for pennies), subscriptions for access, and any
   marketplace/trading economy.
5. **Donations stay on** (GitHub Sponsors) from day one — not as the model, but
   because the audience for an MIT FPS includes people who want to say thanks.

## Guardrails (bind any future model)

- The public repo always builds the complete, competitive game. No
  "open-source-except-the-good-parts".
- Self-hosting is first-class forever: server in the repo, one-container deploy,
  protocol documented.
- Official servers may hold *accounts/cosmetics/ranking* — never exclusive
  mechanics, weapons, maps, or tick rates.
- Any real-money surface: one-time purchases at visible prices only. No loot
  boxes, no gacha, no trading, no limited-time scarcity.
