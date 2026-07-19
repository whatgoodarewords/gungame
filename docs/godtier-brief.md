# Phase 6.5 — god-tier features (owner-approved 2026-07-19)

Three features, owner verdicts applied. Fable owns the presentation values; the
lane implements. All three respect the no-theater clause.

## 1. Bots fill empty rooms (v1 critical path)

- Quickplay rooms start with **5 bots** (owner: "starting with 5 bots to fight
  seems good"). Bots use the standard character rig, real names from a curated
  neutral pool (no "Bot_37", no player-mocking names), play at a tuned-fair
  skill (aim error + reaction delay dials; never aimbot-perfect).
- One bot leaves per human that joins (room cap unchanged); bots never win a
  match milestone silently — if a bot would win, closest human tension rules
  stay honest (bots CAN win; a loss to a bot is a fair loss).
- Bots are labeled subtly in the scoreboard (small dot, no shame column).
- Time-trial ghost: per-map bhop lap route (Cascade's loop is the flagship);
  translucent ghost replays your best lap (localStorage); HUD lap timer
  appears only inside the route's start gate. Zero UI when not racing.

## 2. Clip-that (high-effort clean version — owner directive)

- Rolling 12 s frame ring (canvas capture at render res, capped 1080p) +
  game-audio track. One keypress (default F8, rebindable) OR one-click from
  the kill banner exports webm; auto-suggest after airshots/multikills as a
  quiet toast, never auto-download.
- Burned-in overlay: bottom-left wordmark + map name, bottom-right the
  killfeed lines from the clip window — composited clean (no HUD clutter, no
  dev panel), 60 fps target, correct color.
- "High effort clean": no watermark spam, no confetti; the clip looks like
  broadcast footage of the game.

## 3. Match-end stats (owner: yes — but NO dry-tone gags, "cringe")

- Pure numbers, zero editorializing, no parentheticals, no jokes. Labels are
  flat nouns: `airshots 4 · top speed 31.2 m/s · longest hop chain 9 ·
  flicks landed 2 · knife kills 1 · accuracy 41%`.
- One screen after the win freeze, same typography as the scoreboard, share
  button (copies a text summary + URL). Personal-best markers as a thin
  accent underline, nothing animated.
- The sim already tracks every input; stats computed server-side, shipped in
  the mode-end event.

## 4. IMPRESSIVE (owner-added 2026-07-19)

Two consecutive scout/Deadeye hits without a miss → the accolade: our own
voice-sting + a 500 ms typographic banner (same flat register as the stats
screen — the word alone, no confetti). Tracked per-life, scoped to the two
rail-culture weapons. Chain continues (4 hits = second IMPRESSIVE), miss
resets silently. Server-computed (hit events already carry weapon + sequence).

## 5. Rocket-jump race spots (owner-added)

Cascade's terraces + one or two "you clearly get up there somehow" visible
ledges per gungame map: a lip you can SEE from the floor with something
glinting on it (a secret marker, a graffiti sigil, a names-wall alcove).
No UI, no hint text — the geometry is the invitation. Reached only by
rocket jump (or an inhumanly good strafe chain — never wall it off).
Experimentation is the reward loop; the secret is the receipt.

## 6. Near-miss audio (owner-added)

Projectiles (rocket/disc) within 1.5 m of a player's head that do NOT hit
emit a doppler whoosh scaled by closing speed; hitscan near-misses get the
crack-whizz (supersonic snap) at a lower gain. Dodging becomes a felt skill.
Already queued in projectile-presence work — now a named deliverable with a
dial set (radius, gain curve, doppler amount).

## The standing bar (owner directive, binding on ALL future work)

"Everything should be god-tier ux/feel/vibes/taste — game-wide — for all
things." Operationalized: every surface, sound, message, animation, and
transition in this game is held to the ux-details.md standard — nothing
ships as "functional but unconsidered." Every lane prompt from now on
carries this as an acceptance criterion; the Prime rejects work that is
correct but charmless. The no-theater clause still governs: god-tier means
considered, not busy.
