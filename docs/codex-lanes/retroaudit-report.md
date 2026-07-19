# Prime-direct hotfix2 retro-audit

Target: `1afe24e1aaf7c28ea9cfc31d3564b92b730c00bf`  
Subject: `hotfix2 (Prime-direct, Codex retro-audit queued): 12 review findings`  
Normative sources: `docs/review-settled-tree.md`, `docs/SPEC.md`

## Verdict: REVISE

The commit fixes the central bots-as-statues failure, the ordinary 45-second hold/AFK conflict, abandoned bot-room cleanup, peerless event journals, ghost interpolation buffers, and render-rate pulse consumption. It does not introduce a rollback use-after-dispose: the old materials and viewmodel restored by rollback remain live, while the old rig is deliberately recreated.

It is not complete enough to pass. A per-client snapshot failure now destroys the entire room; the GPU cleanup omits rollback candidates and map-change ownership; bot rebalance can recursively operate on a stale bot array; the claimed `/r/:id` URL is not surfaced or parsed; one/all-occupied spawn pools still overlap players; fire pulses can register without local presentation; and the quarantine path does not run the normal disconnect lifecycle.

## Ranked findings

### 1. P1 — A single client's snapshot/send failure disbands the whole room

**Location:** `server/src/rooms.ts:1024-1051`, `server/src/rooms.ts:1257-1267`

`sendSnapshots` still has no per-slot quarantine boundary around `packSnapshot`, promoted `openBaseline`, `sendBaseline`, or `sendSnapshot`. Any exception attributable to one slot reaches `RoomManager.tick`, whose new catch calls `disbandOnError()` and deletes the room. All players are disconnected, and their reconnect URL points to a room that no longer exists.

This fixes the old *cross-room starvation* but does not implement the review's concrete second half, “wrap the per-slot baseline promotion.” It replaces that blast radius with an avoidable whole-match loss. `disbandOnError` is also not exception-safe: a throwing `peer.disconnect` prevents the subsequent `rooms.delete(id)` and can again abort iteration over later rooms.

**Concrete fix:** catch pack/open/send errors inside the per-slot loop, quarantine only that slot through the normal 45-second disconnect helper, and continue sending to other slots. Reserve manager-level disband for room-global simulation corruption. Make disband best-effort (`try` per peer) and delete the room in `finally`.

### 2. P2 — The GPU/resource-leak finding is only partially fixed

**Location:** `client/src/main.ts:188-245`, `client/src/main.ts:248-356`, `client/src/viewmodels.ts:172-195`, `client/src/viewmodels.ts:254-279`

Direct style-switch commit cleanup is correct: after the candidate renders, the old viewmodel geometry and old material set are disposed. The rollback path also does **not** dispose anything it later reuses: old materials/viewmodel stay live, and the old rig is recreated.

Three leaks remain:

1. On candidate rollback, `nextViewmodel` is only detached and `nextMaterials` is never disposed (`main.ts:227-240`).
2. `installVisualMap` overwrites the prior material set and detaches the prior viewmodel before `applyStyle` captures ownership (`main.ts:339-356`). The second, same-style set is cleaned on commit, but the pre-map-change set/viewmodel is already lost. Old ghost/marker materials and receipt textures are likewise detached without disposal.
3. When a vendored GLTF replaces its procedural silhouette, line 277 removes the silhouette without calling `disposeSubtree`; the new `setWeapon` cleanup cannot recover that orphan.

These are repeated on map rotation/weapon loading and preserve the hour-scale degradation from the review, albeit at a lower rate now that per-shot materials/geometries are shared or disposed.

**Concrete fix:** centralize `disposeMaterials`/scene-subtree ownership; dispose rejected candidate materials and viewmodel only after live meshes are rebound to the old set; make map installation one transaction that captures and disposes the actual prior resources after commit; dispose the procedural model before the GLTF replacement; invalidate in-flight loads in `WeaponViewmodel.dispose()`.

### 3. P2 — `rebalanceBots` can recurse through hold expiry and add a sixth bot

**Location:** `server/src/rooms.ts:331-338`, `server/src/rooms.ts:1093-1123`

`rebalanceBots` snapshots `bots`, then calls `addSlot` while filling. `addSlot` calls `expireHolds`; the hotfix made `expireHolds` call `rebalanceBots` again. If a different hold expires during that add, the nested rebalance adds from the live count and returns; the outer rebalance then continues from its stale `bots` array and adds again.

Focused reproduction:

```text
before final disconnect: 4 bots
after disconnect at 45,001 ms while the older hold expires:
{"players":7,"bots":6,"connected":0,"held":1}
```

The snapshot iteration inside `expireHolds` itself is mutation-safe, including when called by `shouldReap`; the defect is the re-entrant rebalance after it. Ordinary last-hold expiry still reaches target zero and allows reaping.

**Concrete fix:** make hold expiry non-reentrant (remove expired slots and return a boolean), then rebalance exactly once after expiry. Alternatively give bot-only `addSlot` a path that never expires holds. Recompute the live bot count after any operation that can mutate players. Add this exact two-hold boundary case as a regression test.

### 4. P2 — The commit claims `/r/:id`, but only adds `?room=`

**Location:** `client/src/main.ts:399-416`, `client/src/net/session.ts:82-121`, `client/src/hud.ts:342-354`

Adding `room` to the query on Welcome correctly repairs quickplay/create token lookup on reload. It does **not** surface the claimed or normative `/gg/r/:id` path: `history.replaceState` never changes `pathname`, and `joinHello` only reads the query. A clean cold deep link `/gg/r/r000001` without `?room=` therefore quickplays instead of joining that room.

The review's non-creator invite defect also remains. `hud.showInvite(roomId)` is still called only for `?create=1`, while the scoreboard copy handler is installed only inside `showInvite`; quickplay and invited players still have a dead “copy invite” button.

**Concrete fix:** use one canonical room-URL helper; on every Welcome replace the path with `/gg/r/${roomId}` while removing player-specific/create parameters; parse that pathname in `joinHello` (retain `?room=` only as a legacy fallback); wire scoreboard copy for every Welcome independently of the creator-only invite toast.

### 5. P2 — Max-min spawn scoring still overlaps with one or all occupied candidates

**Location:** `server/src/rooms.ts:955-988`

The deterministic max-min scorer is correct when at least one candidate is actually clear. It has no clearance threshold or no-safe-spawn branch. With one candidate and one living player on it, the second player is placed at the identical position; the focused probe measured `oneCandidateDistance: 0`. The same occurs when every candidate is within capsule-overlap distance.

Shipped maps currently validate to 16 Gun Game or 24 Scoutzknivez spawns, which lowers production frequency, but the code comment's “never spawn inside a body” and the review fix are not guaranteed.

**Concrete fix:** after scoring, compare `bestDist` with a squared capsule-clearance threshold. If unsafe, deterministically defer the spawn/respawn until a candidate clears (or apply an explicitly designed telefrag rule). Cover one candidate and all-candidates-occupied cases.

### 6. P2 — Pull-at-tick preserves gameplay fire but can lose its local presentation

**Location:** `client/src/input.ts:362-390`, `client/src/main.ts:520-527`, `client/src/main.ts:607-614`, `client/src/main.ts:701-712`, `client/src/sim-bridge.ts:138-157`

The core 144 Hz fix is sound: `sampleTick` is pulled by the off-render fixed tick and clears jump/fire exactly once. It also runs while dead and continues sending commands, so death does not defer a queued pulse into respawn; menu clicks do not latch because input handlers require the live canvas/pointer-lock conditions. `peek` is correct for held zoom state.

Fire presentation is different. `peek()` exposes only `this.buttons`, not `queuedFire`. If mouse-down/up completes before a render, or the fixed tick consumes the queued press while rendering is stalled, the server receives the fire pulse but the next render sees no `Button.Fire`; recoil, fire audio, and aim tracer at `main.ts:705-712` never happen.

**Concrete fix:** have the tick-input pull enqueue a separate non-consuming presentation event/counter whenever it consumes a fire pulse; drain it once in `renderFrame`. Keep held zoom on `peek`. Do not make rendering consume authoritative input.

### 7. P2 — Protocol quarantine preserves the token hold but skips disconnect bookkeeping

**Location:** `server/src/rooms.ts:512-517`, compared with `server/src/rooms.ts:422-428`

The new assignment prevents next-tick deletion and gives the slot approximately 45 seconds in production. It uses global `performance.now()` instead of the tick's `nowMs`, and—unlike normal disconnect—does not rebalance bots or reset the empty-room timestamp. The transport close callback cannot repair this because `slot.peer` has already been cleared and the peer-identity guard rejects it.

Focused forced-consume-error output:

```text
{"bots":4,"connected":0,"held":1,"emptySince":0,"holdRemainingMs":44998}
```

Thus the last quarantined human leaves a four-bot room instead of the configured five-bot held-room state, and reap age is measured from stale history. Ladder progress itself is retained, so this is a partial rather than failed fix.

**Concrete fix:** save the peer, disconnect it, then delegate state changes to a single `disconnect/quarantineSlot(slotId, nowMs, peer)` helper that sets the hold, rebalances, and updates `lastNonEmptyMs`. Use the injected `nowMs` clock.

## Hunk-by-hunk disposition

| Commit hunk | Result | Audit note |
|---|---|---|
| `rooms.ts` bot command consumption | PASS | Bots now step and enqueue fresh fire; fire resolves after every slot has moved/pushed its hull, preserving deterministic in-tick ordering. |
| `rooms.ts` consume-error hold | PARTIAL | Token hold survives; finding 7 covers missing lifecycle bookkeeping. |
| `rooms.ts` `disbandOnError` / manager isolation | PARTIAL | Later rooms are isolated from ordinary room errors; finding 1 covers the new whole-room/per-client blast radius and non-exception-safe cleanup. |
| `rooms.ts` spawn scorer | PARTIAL | Max-min selection works for a clear multi-candidate pool; finding 5 covers no safe candidate. |
| `rooms.ts` event journaling | PASS | Bots and held slots no longer accumulate events they cannot acknowledge. |
| `rooms.ts` AFK/hold expiry/rebalance | PARTIAL | AFK now honors 45 seconds and normal empty rooms purge bots; expiry iteration is safe, but finding 3 covers re-entrant ordering. |
| `main.ts` style transaction | PARTIAL | Successful switches dispose old resources; rollback reuses no disposed old resource, but rejected/new-map resources leak. |
| `main.ts` Welcome URL | PARTIAL | Query-based reconnect is repaired; `/r/:id` and non-creator copying are not. |
| `input.ts` + `sim-bridge.ts` pull-at-tick | PARTIAL | Authoritative pulses are 144 Hz-safe and death-safe; render presentation is not. |
| `main.ts` tracer resources | PASS | Line materials and impact geometry are session-shared; per-shot line geometries are disposed. |
| `interpolation.ts` authoritative pruning | PASS | `NetworkSession` passes its full reconstructed entity map, so deleting unseen buffers correctly removes leaver husks and full-snapshot survivors. |
| `viewmodels.ts` subtree disposal | PARTIAL | Tier replacement and committed style replacement dispose current geometry; asynchronous GLTF replacement still orphans the silhouette. |
| `process-ledger.md` deviation note | PASS | Documentary only; consistent with the commit metadata. |

## Claims audit

- **“Bots consume commands”** — implemented.
- **“45s hold honored by AFK sweep”** — implemented for ordinary disconnect.
- **“Bot rooms reap”** — ordinary path implemented; re-entrant edge is wrong.
- **“Journal only for snapshot-receiving slots”** — implemented as claimed.
- **“Quarantine preserves holds”** — token/state hold implemented; lifecycle incomplete.
- **“Occupancy-aware spawns”** — scoring implemented, safety guarantee incomplete.
- **“Per-room tick isolation + disbandOnError”** — cross-room isolation implemented; per-slot isolation omitted.
- **“`/r/:id` surfaced on Welcome”** — not implemented; only `?room=` is added.
- **“Ghost-husk interpolation pruning”** — implemented.
- **“144Hz pulse latch / pull-at-tick”** — authoritative path implemented; local fire presentation regressed.
- **“Shared tracer materials”** — implemented.
- **“Style-swap disposal / viewmodel subtree disposal”** — only partially implemented.
- **“129 tests green”** — numerically consistent. The moving worktree ran 136 passing Vitest tests, and exactly seven tests were added after `1afe24e`, yielding the claimed 129 at the target tree. The hotfix itself added no regression tests for its changed behavior.

## Verification evidence

```text
$ git log --oneline --all --grep='hotfix2' --regexp-ignore-case
1afe24e hotfix2 (Prime-direct, Codex retro-audit queued): 12 review findings

$ git show --stat --summary 1afe24e
7 files changed, 154 insertions(+), 27 deletions(-)

$ <focused tsx bot lifecycle probe>
{"before":{"players":6,"bots":4,"connected":1,"held":1},
 "after":{"players":7,"bots":6,"connected":0,"held":1}}

$ <focused tsx one-spawn + quarantine probe>
{"oneCandidateDistance":0,
 "quarantine":{"bots":4,"connected":0,"held":1,"emptySince":0,"holdRemainingMs":44998}}

$ pnpm test
protocol: 23 passed
sim:      39 passed
server:   28 passed
client:   46 passed
tools: map/race/netsim checks passed, then asset validation failed:
       "expected 3 source archives, got 5"

$ git diff --unified=0 1afe24e -- client/test packages/sim/test server/test packages/protocol/test \
    | rg '^\\+\\s*(it|test)\\(' | wc -l
7
```

## Material caveats

- The repository changed underneath this read-only audit: a later asset-restoration commit and an in-progress Phase 7 lane modified unrelated assets/source/tests. No such changes were altered or included here. All findings and line numbers above are from `git show 1afe24e:<path>`.
- The final `pnpm test` failure is outside the target commit: later asset restoration added two archives while the validator still expected three total. The four Vitest projects passed; the seven post-target tests explain 136 versus the target's 129.
- Actual shipped map validation reports 16/24 spawn candidates, so the one-candidate overlap is a correctness/contract edge rather than evidence that current production maps routinely hit it.

## Conclusion and next action

**Conclusion: REVISE.** There is no P0 and the primary statues/reconnect/ghost fixes are real, but the P1 whole-room failure boundary and six concrete incomplete/regression edges prevent a PASS.

**Next action:** implement findings 1-7 with focused regressions for per-slot snapshot failure, nested hold-expiry rebalance, one/all-occupied spawn pools, quick-tap fire presentation, rollback/map resource disposal, canonical cold `/r/:id`, and quarantine lifecycle; then rerun the target suite plus a one-hour map/style soak.
