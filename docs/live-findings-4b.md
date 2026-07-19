# Live E2E findings post-4b deploy (Prime probe, 2026-07-19)

Evidence: headless Chromium vs live dev.sml.world/gg; bots clean 60s (0 err) — both bugs browser-only.

1. **P0 — pointer lock dead**: `WrongDocumentError: root document of this element not valid for pointer lock`. 4b's front-door rebuild replaced/reparented the canvas; RawInput holds the detached element. Fix: input binds to the LIVE canvas (acquire at lock time or rebind on mount), plus a regression assertion in the e2e probe (lock engages after join+click).
2. **P0 — browser WS drops ~8s in, after first style switch** (probe timeline: WS OPEN → in game → dev-grid alive → WS CLOSED → next style shows CONNECTION LOST). No console error, bots unaffected. Suspects: style-transaction rollback path; pump worker + backpressure hard-threshold interplay; bg-flag misfire. Needs instrumented repro (WS close code/reason surfaced to console + probe).
