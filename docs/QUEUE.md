# Execution queue to 100% (standing, 2026-07-19)

1. ✅ phases 0-4c shipped + deployed
2. ▶ phase65 (god-tier) — running
3. hotfix1 — live findings 1-5 (server-crash P0 first) → deploy → live-QA sweep until green
4. phase7 — look/feel/perf overhaul + real assets → deploy → sweep + perf numbers
5. Codex settled-tree audit (server+client, the review the session limit killed) → fold → deploy
6. Phase 5 close-out (#8: verification of already-shipped flows + metrics)
7. Phase 6 (#9): adversarial re-verification, cross-browser matrix (real Safari manual), 12-client both-modes+ARSENAL scripted matches, cold-load check, ≥6-human playtest, burn-down
8. Owner gates: style bake-off (in-engine, judged in motion) + combat-feel sign-off + playtest ≥4/5
9. 100%: all §4 budgets green + sweep green + logs clean + spec success criteria 1-6 checked on issue #1

Rules: one heavy lane at a time on the SD volume; every deploy exits through the live-QA sweep + log mine; every lane carries the standing god-tier bar; Prime verifies everything independently before commit.
