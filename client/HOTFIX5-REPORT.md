# Hotfix 5 — environment pipeline reconciliation + room routing

Progressive implementation record. Normative inputs: `docs/SPEC.md` and
`client/HOTFIX4-REPORT.md`. This lane does not modify `docs/` or `deploy/`.

## Prime evidence accepted

- All four live environment loads fall back to safety lighting even though the
  bundled KTX2 URLs fetch successfully.
- The environment failure path emits a secondary `TypeError` while reporting
  or applying its fallback.
- Sequential quickplay hellos do not reliably resolve to one room, and a guest
  invite hello does not reliably preserve an ARSENAL room's id/config.
- External probes cannot currently read the last WebSocket close code/reason
  from DOM state.

## Initial source findings

- `prefilter-hdri.mjs` writes Basis UASTC cubemaps with six faces and nine
  explicit roughness mip levels. The generic asset validator checks only KTX2
  magic, dimensions, and aggregate budget; it does not enforce the runtime
  compressed-cubemap contract or level-index consistency.
- `environment-assets.ts` validates the post-transcode Three.js texture shape,
  but there is no shared build-time contract for the committed bytes.
- Room manager unit coverage ranks rooms directly, while no regression carries
  the exact URL/session-derived hello through both quickplay and invite
  resolution.
- Close forensics reach the HUD but are not exposed as a stable DOM data
  attribute.

## Implemented

- Chose one offline environment contract: Basis UASTC LDR cubemap, six 256 px
  faces, nine explicit linear roughness mips. `prefilter-hdri.mjs` now rejects
  its own output unless both the KTX2 byte contract and the exact Basis
  JS/WASM decoder shipped to browsers accept and transcode every face/mip.
- Three r185's common renderer cannot upload the `CompressedCubeTexture` that
  KTX2Loader returns: `Textures.needsMipmaps()` dereferences the absent
  texture-level `mipmaps`, and the subsequent compressed upload branch treats
  cubes as 2D textures. Runtime therefore forces KTX2Loader's universal RGBA32
  target, validates the decoded compressed-cube faces/mips, and normalizes them
  to a regular `CubeTexture` with eight explicit subordinate mip levels. That
  representation uploads on both WebGL2 and WebGPU.
- Regenerated all four committed `*_1k_pmrem.ktx2` assets from the vendored HDR
  sources. The standalone validator runs the same shipped Basis decoder and is
  an explicit CI step as well as part of the tools test suite.
- Environment install state is exposed as `data-env-state=loading|applied|safety`.
  The dark-frame test covers both `webgl2` and `webgpu`, requires `applied`, and
  retains its pixel darkness assertion.
- Contained failures from environment install, safety-material activation,
  diagnostics reporting, and style reapplication independently. A secondary
  diagnostics/fallback exception can no longer escape the original catch path.
- Made URL-derived hello routing explicit. Legacy `?room=` joins never reuse an
  inherited owner reconnect token; room-scoped quickplay removes the room route
  and all room configuration; and a reconnect token is now eligible only when
  a non-empty room id remains resolved.
- Room capacity is based on human slots. Quickplay ranking admits rooms whose
  physical slots are temporarily full of fill bots, and a joining human
  displaces a fill bot for both quickplay and invite routing.
- Exposed the last WebSocket close as `data-last-close="ws CODE · reason"` on
  `#app`, initialized to `none`, with a direct DOM-contract regression.
- The dual-backend browser harness reproduced close `4002 · cross-epoch
  reference`. Commands accepted during a baseline-resync window were classified
  only when consumed, after the baseline ack had already closed that window.
  The command window now preserves valid arrival-time epoch classification
  across the ack race while retaining consume-time quarantine for invalid
  epochs.

## Failing-test-first receipt

The resumed server routing test file predates the corresponding room-manager
edit (`04:53:31` vs `04:54:33`). Tightening the client half to carry a
room-scoped quickplay URL through hello construction produced this additional
red receipt before its fix:

```text
$ pnpm --filter @gungame/client test -- environment-assets.test.ts hud-state.test.ts netcode.test.ts --reporter=verbose
FAIL test/netcode.test.ts > hello routing > turns a room-scoped page back into a fresh quickplay hello
AssertionError: expected 3 to be +0
Expected: JoinKind.Quickplay (0)
Received: JoinKind.Resume (3)
Test Files  1 failed | 12 passed (13)
Tests       1 failed | 74 passed (75)
```

Root cause: `quickplayUrl` correctly removed the room id, but `createJoinHello`
still accepted the prior room's reconnect token. With an empty room id that
hello could not resume the intended room and was never true quickplay.

The browser harness also supplied a red receipt for the WebSocket report:

```text
$ pnpm --filter @gungame/tools test:e2e:dark
data-env-state=applied
render-diagnostic=ok
warning: websocket closed · code 4002 · cross-epoch reference
```

The focused protocol regression failed before the epoch-race fix:

```text
$ pnpm --filter @gungame/protocol exec vitest run test/cmd-window.test.ts --reporter=verbose
FAIL preserves arrival-time epoch classification across the baseline ack race
ProtocolError: cross-epoch reference
Test Files  1 failed (1)
Tests       1 failed | 6 passed (7)
```

## Verification log

```text
$ node tools/assets/prefilter-hdri.mjs
{"prefiltered":4,"format":"KTX2 Basis UASTC LDR cubemap, 256px, six faces, nine explicit linear roughness mips","outputs":[{"file":"assets/vendor/polyhaven/empty_warehouse_01/empty_warehouse_01_1k_pmrem.ktx2","bytes":524896},{"file":"assets/vendor/polyhaven/industrial_sunset_02_puresky/industrial_sunset_02_puresky_1k_pmrem.ktx2","bytes":524896},{"file":"assets/vendor/polyhaven/rogland_sunset/rogland_sunset_1k_pmrem.ktx2","bytes":524896},{"file":"assets/vendor/polyhaven/overcast_industrial_courtyard/overcast_industrial_courtyard_1k_pmrem.ktx2","bytes":524896}]}

$ pnpm --filter @gungame/tools assets:validate:environment
{"validator":"offline-environment-contract","format":"KTX2 Basis UASTC LDR cubemap, 256px, six faces, nine explicit linear roughness mips","validated":[{"file":"assets/vendor/polyhaven/empty_warehouse_01/empty_warehouse_01_1k_pmrem.ktx2","bytes":524896,"faces":6,"levels":9,"transcodedBytes":2097144},{"file":"assets/vendor/polyhaven/industrial_sunset_02_puresky/industrial_sunset_02_puresky_1k_pmrem.ktx2","bytes":524896,"faces":6,"levels":9,"transcodedBytes":2097144},{"file":"assets/vendor/polyhaven/rogland_sunset/rogland_sunset_1k_pmrem.ktx2","bytes":524896,"faces":6,"levels":9,"transcodedBytes":2097144},{"file":"assets/vendor/polyhaven/overcast_industrial_courtyard/overcast_industrial_courtyard_1k_pmrem.ktx2","bytes":524896,"faces":6,"levels":9,"transcodedBytes":2097144}]}

$ pnpm --filter @gungame/server exec vitest run test/hotfix5-routing.test.ts --reporter=verbose
✓ routes quickplay hellos three seconds apart into the same room
✓ routes an invite guest into the created ARSENAL room and preserves its ladder
✓ lets a human displace a fill bot for 'quickplay' routing
✓ lets a human displace a fill bot for 'ARSENAL invite' routing
Test Files  1 passed (1)
Tests       4 passed (4)

$ pnpm --filter @gungame/protocol exec vitest run test/cmd-window.test.ts --reporter=verbose
✓ preserves arrival-time epoch classification across the baseline ack race
Test Files  1 passed (1)
Tests       7 passed (7)

$ shasum -a 256 assets/vendor/polyhaven/*/*_pmrem.ktx2
4e5a875b7af6da83202044e14b783f9989e3986f0fcaf618f215d569c7b75c08  empty_warehouse_01_1k_pmrem.ktx2
0862831d1849ba241a56cbcf4477f28966ebbc33eec08c958f9804586b9cea20  industrial_sunset_02_puresky_1k_pmrem.ktx2
457585cfc931fb9435ea1623109295790a93a147b81713459d82a7d56a0ad137  rogland_sunset_1k_pmrem.ktx2
deb4ed04af43ee265602cbd3d76459eead6d8f9544b117decbd935a436fa70b4  overcast_industrial_courtyard_1k_pmrem.ktx2
```

## Completion gate

```text
$ pnpm -r typecheck && pnpm -r test
exit 0

typecheck:
packages/protocol Done
packages/shared   Done
packages/sim      Done
server            Done
client            Done
tools             Done

tests:
packages/protocol  4 files passed, 24 tests passed
packages/sim       7 files passed, 39 tests passed
server             7 files passed, 39 tests passed
client            13 files passed, 76 tests passed
tools              map/race/netsim/assets/browser chain Done

tools asset validator:
4 files × 6 faces × 9 levels; 2,097,144 RGBA fallback bytes transcoded per file
GPU texture budget: 30,758,240 / 67,108,864 bytes

tools browser:
{"test":"webgl2-greybox-spawn-not-dark-with-environment","passed":true,"envState":"applied","darkRatio":0.7031875,"blackRatio":0,"width":160,"height":100}
{"test":"webgpu-greybox-spawn-not-dark-with-environment","passed":true,"envState":"applied","darkRatio":0.7031875,"blackRatio":0,"width":160,"height":100}
```

After adding the final explicit socket-stability assertion to that harness:

```text
$ pnpm --filter @gungame/tools typecheck && pnpm --filter @gungame/tools test:e2e:dark
exit 0
{"test":"webgl2-greybox-spawn-not-dark-with-environment","passed":true,"envState":"applied","lastClose":"none","darkRatio":0.7031875,"blackRatio":0,"width":160,"height":100}
{"test":"webgpu-greybox-spawn-not-dark-with-environment","passed":true,"envState":"applied","lastClose":"none","darkRatio":0.7031875,"blackRatio":0,"width":160,"height":100}
```

## Conclusion

Hotfix 5 is complete in code. All four environments use one producer/runtime
contract, validate with the shipped decoder in CI, upload successfully on both
render backends, and remain non-safety/non-black. The fallback path cannot emit
a secondary uncaught diagnostic error. Quickplay and ARSENAL invite routing
preserve the requested room/config, including bot-capacity edges. External
probes can read close code/reason, and the reproduced epoch-race close is fixed.

## Material caveats

- The on-disk environment payload stays compact UASTC, but three r185 requires
  the runtime RGBA32 normalization described above. The corrected asset budget
  accounts for it and remains below half of the 64 MiB ceiling.
- Verification is local/headless against both backends. This lane intentionally
  did not touch `deploy/`; the live deployment still needs Prime's normal
  publish and mega-sweep.
- No unrelated changes were removed or overwritten. No git operations were
  performed.

## Next action

Prime can review this report, publish through the existing deployment lane, and
rerun the live mega-sweep with `data-env-state` and `data-last-close` probes.
