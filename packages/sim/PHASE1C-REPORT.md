# Phase 1c implementation report

## Progress log

- 2026-07-18: Read `docs/SPEC.md` sections 3.1 and 3.6, the shared feel surface, sim state/step/collision code, and the existing sim tests. Confirmed there is no repository-local `AGENTS.md`/`CLAUDEX.md` beyond the supplied workspace instructions.
- 2026-07-18: Chosen collision representation: retain the existing player reference point while parameterizing capsule height and bottom offset. A ducked capsule is 0.9 m tall with a +0.45 m bottom offset; grounded duck completion lowers the reference point by 0.45 m (feet fixed), while airborne duck leaves it unchanged (feet tuck upward).
- 2026-07-18: Added the seven Fable-owned feel dials and deterministic player-state fields; implemented ordered categorize/duck/jump/friction/accelerate/move/categorize flow, walkable-normal and upward-velocity grounding rules, coyote, airborne corner retrace, and duck landing slides.
- 2026-07-18: Added focused tests for the Phase 1c mechanics and expanded the replay input corpus. First full sim run: 16 passed, 4 failed due to over-strict exact-float or trajectory assertions in new tests; implementation-level duck, jumpbug, surf, coyote, slide entry, and all legacy tests passed.
- 2026-07-18: Workspace-wide `pnpm -r typecheck` passed after preserving the read-only Phase 1 client’s jump-buffer-only `FeelParams` setter through optional readonly override fields resolved over `DEFAULT_FEEL` in the sim.
- 2026-07-18: Workspace-wide `pnpm -r test` passed: sim 6 files / 23 tests; both greybox map validations passed. Added final threshold and kill-volume corner cases afterward, so the exact combined final gate is rerun below.

## Material specification notes

- The normative `normal.y >= 0.7` rule makes an exact 45° ramp (`normal.y ~= 0.7071`) walkable. The surf acceleration test therefore uses a 45.7° ramp (`normal.y < 0.7`) and separately asserts that exact 45° grounds while the steeper ramp does not.
- With the required existing friction formula (`speed -= speed * friction * dt`), `friction=6`, `slideFrictionScale=0.25`, and 300 ms (20 ticks), full-window retention is mathematically about 62%. The suite verifies the literal quarter-friction mechanism for the full timer and the requested >=85% retention six ticks into the active window; achieving >=85% after all 300 ms would require a different dial (approximately 0.086) or a different friction mechanism, neither of which was authorized.
- `CollisionWorld` now accepts kill-volume AABBs and disables corner correction across them. The current read-only client constructs it from `map.collision` only, so that caller must pass `map.killVolumes` in its owning lane to activate this guard in the playground.
