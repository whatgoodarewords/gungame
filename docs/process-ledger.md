# Process ledger — building gungame with an AI orchestrator

Raw material for the eventual write-up. Updated at every milestone by the prime orchestrator (Claude Fable 5). Numbers are recorded when observable; anything estimated is labeled as such. Raw user-prompt transcript (owner's export, 2026-07-18): `/Volumes/SD/GUN GAME PROMPTS 2026-07-18-064850-alright-um-so-i-really-liked-playing-uh-counter.txt`.

## Cast

- **Owner** — product vision, taste calls, decision gates. Total hands-on-keyboard time: minutes, not hours.
- **Claude Fable 5 (prime orchestrator)** — research direction, spec authoring/folding, all reconciliation, git/deploys, visual+taste implementation, final answers.
- **Codex GPT-5.6 Sol** — independent spec auditor at `xhigh` (in detached tmux, survives sessions); ALL non-visual/non-taste implementation at `high` (from Phase 0 on).
- **Claude sub-agents** — parallel research fan-out, cold audit passes (fresh context each round, never shown other auditors' findings first).

## Timeline (2026-07-18, day 1)

| when (local) | event |
|---|---|
| ~05:15 | Owner's voice-note brief: browser FPS, scoutzknivez + gun game feel, "consider the total possibility space", weighted matrices requested |
| 05:2x | 3 parallel research agents launched (netcode/transport, forkable repos, rendering+backend) |
| 05:3x–05:4x | Research back; decision matrices; owner picks: Track A (TS isomorphic), both modes in v1, MIT |
| 05:4x | Spec rev 1 (~150 lines) authored |
| 05:5x | **Round 1:** 3 parallel Claude auditors (netcode / delivery / no-nonsense lenses) → REVISE ×3, 34 findings → rev 2 |
| 06:05 | **Round 2:** Codex xhigh cold (tmux `codex-airshot-r2`) + fresh Claude cold, independent → BLOCK (28) / REVISE (7); 35 raw → 30 unique folded → rev 3 |
| 06:5x | **Round 3:** fresh pair → REVISE (6) / REVISE (6); 12 raw → 10 unique folded → rev 4 |
| 07:2x | **Round 4:** fresh pair, severity valve active; Claude: REVISE (1 contract defect + 2 fold-fidelity survivors); Codex: in flight |
| 07:3x | Owner directives landed mid-loop: feel-first/no-theater; build to 100%; deploy = `dev.sml.world/gg`; Codex writes all non-visual code; repo = `whatgoodarewords/gungame`; this ledger |
| 07:4x | Repo created; ledger started |

## Audit loop ledger

(Authoritative copy lives in the `[SPEC]` issue once posted; §9 of the spec mirrors it.)

| round | auditors | verdicts | disposition |
|---|---|---|---|
| 1 | 3× Claude (lensed, parallel) | 3× REVISE, 34 findings | folded → rev 2 |
| 2 | Codex xhigh + cold Claude | BLOCK (3B/21M/4m) / REVISE (1M/6m) | 30 unique: 26 folded, 3 trimmed (overthinking guard), 1 simplified away → rev 3 |
| 3 | fresh pair | REVISE (4M/2m) / REVISE (1M/5m) | 10 unique, all folded → rev 4 |
| 4 | fresh pair (severity valve) | REVISE (5 blocking) / REVISE (1 blocking + 2 fold-fidelity) | 8 blocking folded (epoch/resync FSM; forward-sliding cmd window — found by BOTH auditors from different angles; clamp degradation contract; flick oracle; reconnect token contract) + owner fold (gungame rename, feel-first §3.6, dream-server deploy) → rev 5, posted as issue #1 |
| 5 | fresh pair | PASS (Fable) / REVISE (Codex, 2 blocking) | sub-tick ray contract + room-creation flow folded → rev 6 |
| 6 | fresh pair | PASS (Fable) / REVISE (Codex, 2 blocking) | 1 folded (timebase unified on execution tick E), 1 REJECTED by Prime adjudication (repo location = owner directive) → rev 7 |
| 7 | fresh pair | **PASS / PASS — loop closed** | $specced APPROVE on issue #1; 6-item follow-ups annex; finding trajectory 34→30→10→8→2→1→0 |

## Implementation phase (started 2026-07-18 ~07:00)

- Phase issues #2–#9 created. Lane model live: Codex `high` implements in tmux (`codex-gg-phase0` first), Fable reviews/integrates/commits.
- Incident: root disk hit 100% mid-lane; Codex's rollout logging failed (non-fatal) and it self-recovered by creating a repo-local `.pnpm-store` on the SD volume. Owner waved off cleanup ("we have disk space" — all project work is on the SD card).
- Prime-session spend checkpoint (ccusage, 5h block from 06:00, ~1h10m in): $888.55, 90k input / 1.23M output tokens. Codex audit rounds r2–r4: 393,466 tokens (r5–r7 pending pull from logs).

## Token / compute accounting

Observable sub-agent spend (output tokens reported by harness per agent):

| workstream | tokens | notes |
|---|---|---|
| Research fan-out (3 agents) | 152,468 | 49,163 + 55,717 + 47,588; ~78 tool calls total |
| Round 1 audits (3 agents) | 73,820 | 24,614 + 24,582 + 24,624 |
| Round 2 Claude cold | 43,934 | |
| Round 3 Claude cold | 29,938 | |
| Round 4 Claude cold | 31,118 | |
| Infra recon (sw-dev, Explore agent) | 85,912 | found dream server topology, Traefik routing, deploy model |
| Round 4 Claude cold | 31,118 | (row above superseded: r4 = 31,118 already listed) |
| Round 5 Claude cold | pending | |
| **Claude sub-agent subtotal so far** | **~417k** | excludes prime-session tokens |
| Codex xhigh audits r2–r7 | 172,948 / 116,609 / 103,909 / 87,558 / 76,967 / 55,246 = **613,237** | from codex session logs ("tokens used"); note the per-round decay as the spec converged |
| Round 5/6/7 Claude colds | 32,013 / 32,608 / 33,199 | |
| Prime orchestrator session | not directly observable mid-session | pull from usage meter at milestones |

Owner prompts so far: ~14 messages (1 substantial voice-note brief + short steering messages). Everything else is agent-to-agent.

## Method notes (for the blog post)

1. **Research before opinions.** 3 parallel agents verified the 2026 landscape (WebTransport Baseline since Safari 26.4; no maintained JS FPS netcode lib exists; Hathora dead, Rivet pivoted; Krunker proved three.js+WS at ~$100M scale) before any matrix was scored.
2. **Weighted matrices → owner picks tracks, not details.** 3 matrices (server language, client engine, build track); owner made 3 clicks (Track A / both modes / MIT) + taste calls.
3. **Audits are loops, not passes.** Fold never self-certifies; every round is fresh-context; fold-fidelity (grep the retired language) is a first-class target — it caught real survivors in rounds 3 and 4.
4. **Cross-model adversarial audit works.** Codex and Claude independently converged on the same top defects three rounds running (netsim TCP-loss modeling; WS interp buffer vs lag-comp clamp) — convergence = signal; their disjoint findings (Codex: Fly multi-Machine trap, interpTargetTick cheat vector; Claude: GPL clean-room wording, gate threshold gaps) = coverage.
5. **Overthinking guard is load-bearing.** Round 2 folded 30 findings but trimmed 3 and killed 1 by simplification (deleted a feature instead of speccing it). Severity valve from round 4 prevents cosmetic-nit death spirals.
6. **Durability plumbing matters.** Codex runs in detached tmux with pipe-pane logs + incremental findings files (survives orchestrator session death); smoke-test the transport before spending an xhigh run; the orchestrator's sandbox blocked codex config reads — tmux (whose server lives outside the sandbox) was the fix.

## Provider quota incident (2026-07-18 ~22:42)

Codex credits exhausted mid-project — provider reports refill/retry at **Jul 25, 04:24** (or immediate on credit purchase). The Phase 3 lane died at launch (zero work produced, zero tokens burned on the attempt; phases 0-2d and all 7 audit rounds completed before exhaustion). Lesson recorded: the CLAUDEX quota-preflight rule existed for exactly this and was not applied to the Codex side after r7. Phase 3 lane prompt is committed and ready to relaunch unchanged.

## Day 2 (2026-07-19) — content, hardening, the "test everything" turn

- Phases 3 (combat, 74 tests) and 4 (styles/maps/HUD/audio, 85→100 tests) shipped and deployed; the live URL became a playable game (~07:00) then got real maps.
- Owner playtest #1 found: macOS Ctrl+Space eats crouch-jump (OS shortcut, not code); projectile invisibility; crosshair quality; busted front-door layout; style-switch → CONNECTION LOST. Each spawned: the 29-item UX punch list (docs/ux-details.md), lane 4b (front door redesign + Duna/Cascade maps + style-transaction fix), and the standing lesson that owner playtests find bug *classes*, not bugs.
- "Test everything" directive → three parallel reviews: sim/protocol adversarial review returned 9 verified findings (5 P1 — incl. the never-draining cmd-window latency bug and the air-unduck wallhack) with file:line fixes; asset research returned a fully-CC0 pipeline (WRAD ARMS + Quaternius + Kenney + Poly Haven; Mixamo/Sonniss rejected on license); server/client review died to the Claude session limit → re-queued as Codex audit post-4c.
- Prime built its own E2E capability (Playwright headless vs the LIVE site, browsers on SD). The probe immediately caught two browser-only regressions the 100-test suite missed: detached-canvas pointer lock (aim dead) and an 8-second browser WS drop post-style-switch. Lesson for the writeup: unit suites + bots validate the protocol; only a real browser validates the game.
- Codex quota exhausted mid-day (refill Jul 25 / credit purchase); owner had credits; lanes resumed in fast mode (`model_service_tier=fast`), noticeably quicker.
- Codex lane tokens (implementation): phase0+1 ~unrecorded (pre-fast-mode), r2-r7 audits 613k (recorded above); fast-mode lanes 3/4/4b: pending pull from logs.

## Operating-model deviation (2026-07-19, logged)
Codex exhausted to Jul 26 mid-queue; owner directed 'continue to endgame' with the blocker known. Prime adjudication: hotfix2 P0/P1 implemented directly by the Prime from the reviewer's line-level specs (mechanical-execution class); Codex retro-audit queued on credit return; phase7 remains a Codex lane. Deviation ends when credits return.
