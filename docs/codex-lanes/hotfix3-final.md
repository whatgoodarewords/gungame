Implemented all seven retro-audit findings plus Finding 8, with phase7 overlap reconciled.

Verification:

- `pnpm -r typecheck` — exit 0 across all packages.
- `pnpm -r test` — exit 0: protocol 23, sim 39, server 35, client 63; tools validators passed.
- Required hotfix probes — 7/7 passed, including two-hold boundary, unsafe spawn deferral, and forced consume-error bookkeeping.
- Bot scoreboards use curated `BOT_NAMES`, never `pN`.
- Phase7 landed work compiles and tests with these fixes.

Full implementation receipt: [HOTFIX3-REPORT.md](/Volumes/SD/gungame/client/HOTFIX3-REPORT.md)

Caveat: the dark-on-dark viewmodel remains phase7-owned and is documented for its hold-spec contact sheet. No `docs/`, `deploy/`, or git operations were performed.