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
| 4 | fresh pair (severity valve) | Claude REVISE (1 MAJOR + 2 fold-fidelity); Codex pending | pending fold → rev 5 (will also fold: feel-first section, dev.sml.world/gg deploy rewrite, gungame rename) |

## Token / compute accounting

Observable sub-agent spend (output tokens reported by harness per agent):

| workstream | tokens | notes |
|---|---|---|
| Research fan-out (3 agents) | 152,468 | 49,163 + 55,717 + 47,588; ~78 tool calls total |
| Round 1 audits (3 agents) | 73,820 | 24,614 + 24,582 + 24,624 |
| Round 2 Claude cold | 43,934 | |
| Round 3 Claude cold | 29,938 | |
| Round 4 Claude cold | 31,118 | |
| Infra recon (sw-dev, Explore agent) | pending | |
| **Claude sub-agent subtotal so far** | **~331k** | excludes prime-session tokens |
| Codex xhigh rounds 2–4 | not yet pulled | to be read from codex session logs/usage meter at next milestone |
| Prime orchestrator session | not directly observable mid-session | pull from usage meter at milestones |

Owner prompts so far: ~14 messages (1 substantial voice-note brief + short steering messages). Everything else is agent-to-agent.

## Method notes (for the blog post)

1. **Research before opinions.** 3 parallel agents verified the 2026 landscape (WebTransport Baseline since Safari 26.4; no maintained JS FPS netcode lib exists; Hathora dead, Rivet pivoted; Krunker proved three.js+WS at ~$100M scale) before any matrix was scored.
2. **Weighted matrices → owner picks tracks, not details.** 3 matrices (server language, client engine, build track); owner made 3 clicks (Track A / both modes / MIT) + taste calls.
3. **Audits are loops, not passes.** Fold never self-certifies; every round is fresh-context; fold-fidelity (grep the retired language) is a first-class target — it caught real survivors in rounds 3 and 4.
4. **Cross-model adversarial audit works.** Codex and Claude independently converged on the same top defects three rounds running (netsim TCP-loss modeling; WS interp buffer vs lag-comp clamp) — convergence = signal; their disjoint findings (Codex: Fly multi-Machine trap, interpTargetTick cheat vector; Claude: GPL clean-room wording, gate threshold gaps) = coverage.
5. **Overthinking guard is load-bearing.** Round 2 folded 30 findings but trimmed 3 and killed 1 by simplification (deleted a feature instead of speccing it). Severity valve from round 4 prevents cosmetic-nit death spirals.
6. **Durability plumbing matters.** Codex runs in detached tmux with pipe-pane logs + incremental findings files (survives orchestrator session death); smoke-test the transport before spending an xhigh run; the orchestrator's sandbox blocked codex config reads — tmux (whose server lives outside the sandbox) was the fix.
