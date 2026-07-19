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
