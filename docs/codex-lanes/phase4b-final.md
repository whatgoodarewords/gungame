Implemented Phase 4b Parts A–C without git operations or changes under `docs/`/`deploy/`.

Key results:

- Redesigned live-world front door with persistent filtered names, segmented room controls, map pinning, responsive containment, and in-card connection states.
- Added Duna and Cascade generators, validators, client/server loading, and 16 FFA spawns each.
- Protocol bumped to v4; Gun Game rotates Foundry → Duna → Cascade, while pinned maps and Scoutz/Spire remain fixed.
- Rebuilt render-style switching transactionally with rollback, frame-loop recovery, and render-independent command pumping.
- Dev panel now defaults hidden, toggles with Backquote, persists, and no longer duplicates SPEED.

Verification:

```text
pnpm -r typecheck && pnpm -r test
exit 0

Protocol: 17 tests
Sim:      34 tests
Server:   22 tests
Client:   27 tests
```

All four maps validate in GLTF and blob formats. Production client/server builds pass.

Both 12-bot, 60-second matches completed with winners and restarts:

- Duna: 0 protocol errors/reconnects, 297.62 B mean snapshots.
- Cascade: 0 protocol errors/reconnects, 283.58 B mean snapshots.

Full evidence and manual matrix are in [PHASE4B-REPORT.md](/Volumes/SD/gungame/client/PHASE4B-REPORT.md). Bot receipts: [Duna](/Volumes/SD/gungame/tools/netsim/reports/phase4b-duna-long.json) and [Cascade](/Volumes/SD/gungame/tools/netsim/reports/phase4b-cascade-long.json).

Caveats: no browser was available for the real 360/768/1440 visual or live GPU style-switch matrix; responsive dimensions are unit-tested. Bot correction p95 was ~0.21 m, so the canonical impairment gate should be rerun separately.

Next action: perform the documented visual/WebGPU/WebGL2 matrix, then hand to the owner for review.