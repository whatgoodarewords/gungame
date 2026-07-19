# HOTFIX3 — retro-audit findings

Progressive implementation record for all seven findings in
`docs/codex-lanes/retroaudit-report.md`, plus Prime live-probe Finding 8.

## Scope

- Implement Findings 1–7 exactly at their concrete failure boundaries.
- Apply `BOT_NAMES` on the bot join path and prove scoreboard names never fall
  back to `pN`.
- Reconcile phase7 overlaps without duplicating already-correct work.
- Add focused regressions for the two-hold rebalance boundary, one/all-occupied
  spawn pools, quick-tap fire presentation, canonical room URLs, per-slot
  snapshot quarantine, resource ownership, and forced consume-error
  bookkeeping.
- Do not modify `docs/` or `deploy/`.

## Progress

- Finding 1: per-slot snapshot packing/baseline/send quarantine is implemented;
  healthy slots continue receiving snapshots. Room-global disband is
  best-effort per peer and manager deletion is in `finally`.
- Finding 2: rejected style candidates now dispose candidate viewmodels and
  materials after old bindings are restored. Map replacement captures the
  actual prior map/viewmodel/material/marker/ghost resources and disposes them
  after commit. Both legacy and phase7 precision viewmodels dispose replaced
  procedural geometry and invalidate in-flight loads on disposal.
- Finding 3: hold expiry only mutates/returns a boolean; bot fill no longer
  expires holds recursively. The exact 45,001 ms two-hold boundary regression
  expects five bots and one held human.
- Finding 4: one canonical room URL helper emits `/gg/r/:id`, strips
  player/create parameters, parses cold path joins before the legacy `?room=`
  fallback, and arms scoreboard copy on every Welcome.
- Finding 5: unsafe one/all-occupied spawn pools defer the living spawn and
  retry deterministically once capsule clearance exists.
- Finding 6: fixed-tick fire consumption enqueues a separate presentation
  counter, drained once by rendering while held zoom remains on `peek()`.
- Finding 7: forced consume quarantine uses the injected tick clock and the
  same disconnect lifecycle as transport close, including hold expiry, bot
  rebalance, and empty-room timestamp.
- Finding 8: bot fill selects directly from `BOT_NAMES`; decoded baseline
  scoreboard regression requires every bot name to be curated and rejects
  `pN`.

Focused and monorepo verification are complete.

## Phase7 owner note

Prime's live probe found the current viewmodel dark-on-dark. Phase7 owns this
visual issue; include it in the pending hold-spec contact sheet review. Hotfix3
does not change the phase7 look specification.

## Verification log

### Required reproduction probes

`pnpm --filter @gungame/server exec vitest run test/hotfix3.test.ts --reporter=verbose`

```text
Test Files  1 passed (1)
Tests       7 passed (7)
```

The test file includes the report's three focused reproductions:

```text
two-hold boundary at 45,001 ms
{"players":6,"bots":5,"connected":0,"held":1}

one/all-occupied candidates
new player remains non-living until a candidate has squared capsule clearance,
then respawns deterministically on the cleared candidate

forced consume error at injected nowMs=1,234
{"bots":5,"connected":0,"held":1,"emptySince":1234,
 "holdRemainingMs":45000}
```

It also decodes an authoritative full snapshot and proves all four fill-bot
scoreboard entries are members of `BOT_NAMES`, with no `/^p\d+$/i` fallback.

### Focused client regressions

`pnpm --filter @gungame/client exec vitest run test/hud-state.test.ts test/phase4c-ux.test.ts test/render-style.test.ts test/viewmodels.test.ts --reporter=verbose`

```text
Test Files  4 passed (4)
Tests       31 passed (31)
```

These cover canonical cold `/gg/r/:id` parsing, legacy query fallback,
parameter stripping, repeatable invite copy, separate fire-presentation drain,
unique material/subtree disposal, procedural-model replacement disposal, and
in-flight viewmodel load invalidation.

### Required monorepo gates

`pnpm -r typecheck`

```text
packages/protocol typecheck: Done
packages/shared   typecheck: Done
packages/sim      typecheck: Done
client            typecheck: Done
server            typecheck: Done
tools             typecheck: Done
exit 0
```

This is also the requested compile verification of phase7's landed work with
the reconciled hotfix3 resource lifecycle.

`pnpm -r test`

```text
protocol  4 files / 23 tests passed
sim       7 files / 39 tests passed
server    6 files / 35 tests passed
client   12 files / 63 tests passed
tools     map, race-spot, netsim, and asset validators passed
exit 0
```

Phase7 validation remained green:

```json
{"glbs":12,"archives":5,"normalizedAudio":12,"ktx2":20,
 "offlinePmrem":4,"hdri":4,"gpuTextureBytes":24466784,
 "gpuTextureCeilingBytes":67108864,"vendorBytes":28504926,
 "clientPayloadGzipBytes":3806760,"ceilingBytes":8388608}
```

## Conclusion

All seven normative retro-audit findings and Prime live-probe Finding 8 are
implemented with focused regressions. The required monorepo typecheck and test
commands are green, including the report's three reproduction probes.

## Material caveats

- The live-probe dark-on-dark viewmodel remains phase7-owned and is explicitly
  queued for its pending hold-spec contact sheet; hotfix3 did not alter the
  phase7 visual specification.
- No browser screenshot acceptance or one-hour GPU soak was run in this lane;
  the requested compile and automated regression gates are complete.
- `docs/` and `deploy/` were not modified.

## Next action

Phase7 should include the dark-on-dark observation in the owner contact sheet
and complete its browser visual acceptance. No further hotfix3 code action is
required.
