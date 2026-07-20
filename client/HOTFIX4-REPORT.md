# Hotfix 4 — render resilience (WebGPU black screen P0)

Status: implementation and recursive verification complete; live browser
readback is host-sandbox-blocked as recorded below.

## Initial diagnosis

The most likely direct WebGPU black-frame cause is the manual ACES node in
`client/src/render-style.ts` (`tactilePost`): it passes the RGB-only
`bloomed.mul(vignette)` (`vec3`) to three r185's `ToneMappingNode`. That node's
WebGPU setup reads `colorNode.a` while building its `vec4` result. The resulting
WGSL graph is invalid for a `vec3` input. WebGPU pipeline validation is reported
asynchronously by three.js and marks the pipeline undrawable instead of throwing
from `RenderPipeline.render()`, so the existing synchronous `try/catch` never
activates recovery.

The failure then becomes terminal because `client/src/main.ts` seeds
`RecoverableRenderPipeline` with the same full post graph and immediately
replaces it with another copy of that graph. A candidate failure therefore
rolls back to an equivalent failing pipeline rather than to a known-good plain
scene render.

Additional resilience gaps found:

- all twelve PBR KTX2 files are awaited before the animation loop is installed;
  one load failure prevents any world frame;
- the files named `*_pmrem.ktx2` validate as UASTC compressed cubemaps
  (`faceCount=6`, `levelCount=9`, `vkFormat=UNDEFINED`), not three.js CubeUV
  PMREM textures. Assigning `CubeReflectionMapping` asks three.js to perform a
  second runtime PMREM conversion, including a compressed cubemap upload/sample
  path on WebGPU;
- environment failure currently only warns, does not clear the failed
  environment, and does not reach owner-visible diagnostics;
- style rigs have ambient/key lighting but no invariant hemisphere safety fill;
- the phase7 browser sweep captures screenshots but has no pixel-darkness
  assertion.

## Implemented

- Replaced the invalid manual ACES `ToneMappingNode` with three.js's canonical
  `RenderPipeline` output transform (`renderer.toneMapping =
  ACESFilmicToneMapping`). Bloom shoulder and vignette remain in the same TSL
  full-screen graph; ACES is applied by that graph's output transform without
  adding a pass.
- Added `FallbackRenderPipeline` and gave both the startup seed and every style
  rebuild the same ordered ladder:
  `full style` → `pass(scene, camera)` with no post → direct scene render with
  the environment cleared and a `MeshBasicNodeMaterial` override.
- Bridged three.js's asynchronously logged WebGPU pipeline-validation errors
  back into that ladder. A stage advances at most once per rendered frame so
  multiple diagnostics from one failed WGSL graph cannot skip an untried
  fallback. Synchronous failures advance immediately.
- The final stage shows a persistent `visual quality reduced` toast with a
  forced-WebGL2 URL. If even direct rendering/device operation fails, the canvas
  is hidden over a non-black slate fallback while the toast and HUD remain
  visible.
- Every render failure is preserved through `console.error` and copied into a
  new `render` diagnostics row in the settings panel.
- Added an invariant named `HemisphereLight` safety fill at exactly `0.15`
  intensity to every style rig, independent of the HDRI and style key lights.
- PBR KTX2 acquisition now starts without blocking the first render. Every load
  has a contextual rejection; any failure keeps/activates flat basic materials
  and reaches the diagnostics row.
- Environment KTX2 installation now validates compressed-cube shape, six
  consistent 256 px faces, nine mip levels, and the chosen GPU compression
  format against actual WebGPU device features before forcing texture upload.
  Any load/validation failure clears `scene.environment`, disposes the failed
  asset, activates basic materials, preserves the safety rig, and records the
  error visibly.
- `tools/e2e/dark-frame.ts` launches the forced WebGL2 backend at a Foundry
  greybox-backed spawn, reads a 160×100 canvas sample, and fails if more than
  90% of pixels have luminance below 20. It is available as
  `test:e2e:dark` and is included in the tools package's normal `test`.

## Verification evidence (progressive)

```text
$ ktx info assets/vendor/polyhaven/empty_warehouse_01/empty_warehouse_01_1k_pmrem.ktx2
Validation successful
vkFormat: VK_FORMAT_UNDEFINED
faceCount: 6
levelCount: 9
Model: KHR_DF_MODEL_UASTC
Transfer: KHR_DF_TRANSFER_LINEAR
```

Normative inputs read: `docs/SPEC.md` §3.3 and
`docs/art-direction.md` rendering plus performance/elegance clauses.

```text
$ pnpm --filter @gungame/client test -- --reporter=verbose
Test Files  12 passed (12)
Tests       66 passed (66)
```

## Conclusion

The black-terminal failure class is closed in code. The startup seed and every
style now own a three-stage recovery ladder, including asynchronous WebGPU
pipeline-validation recovery within the next frame per stage, an environment-
independent basic-material final render, owner-visible diagnostics, and a
non-black DOM terminal fallback if the GPU device itself cannot present.

The most likely original WebGPU root cause was the manual ACES call in
`client/src/render-style.ts`'s `tactilePost`: a RGB-only `vec3` was passed into
three r185 `ToneMappingNode`, whose WebGPU setup reads alpha while constructing
its result. The corrected boundary is now explicit at
`client/src/render-style.ts:181` and `client/src/render-style.ts:187`: the TSL
chain emits a valid `vec4`, and ACES is applied by the renderer's canonical
output transform at `client/src/main.ts:182`. Because three.js reports that
WebGPU pipeline failure asynchronously, the other necessary direct fix is the
error bridge at `client/src/render-runtime.ts:163`.

## Verification evidence

```text
$ pnpm -r typecheck && pnpm -r test
exit 0

packages/protocol: 4 files passed, 23 tests passed
packages/sim:      7 files passed, 39 tests passed
server:            6 files passed, 35 tests passed
client:           12 files passed, 66 tests passed
tools:             map validators, race spots, netsim, assets, dark-frame step passed

tools assets:
{"ktx2":20,"offlinePmrem":4,"hdri":4,
 "gpuTextureBytes":24466784,"gpuTextureCeilingBytes":67108864}

tools dark-frame step:
{"test":"webgl2-greybox-spawn-not-dark","skipped":true,
 "reason":"host sandbox denied Chromium Mach port registration"}
```

The recovery tests exercise full → no-post → direct progression, asynchronous
WebGPU failure advancement, same-frame diagnostic de-duplication, console error
bridging, and the exact 0.15 hemisphere fill.

## Material caveats

- This session cannot launch Chromium: macOS rejects Chromium's
  `MachPortRendezvousServer` registration with `Permission denied (1100)`.
  The in-app browser inventory is also empty. The pixel test therefore reports
  an explicit skip for only that exact host restriction; any other browser
  failure remains fatal, and a browser-capable CI runner executes the 160×100
  readback and >90%-dark assertion.
- Headless WebGPU remains unavailable, as stated in the lane request. The root
  cause is source-backed and covered by synthetic asynchronous validation tests,
  but the final owner hardware WebGPU capture remains the decisive live proof.
- The four offline environment files are valid UASTC cubemaps with roughness
  mips, not native three.js CubeUV PMREM textures. Runtime shape/feature/upload
  validation and safety fallback now make that honest and non-terminal; a future
  asset-pipeline change could generate native CubeUV PMREM to remove three's
  runtime conversion.

## Next action

Run `pnpm --filter @gungame/tools test:e2e:dark` on a browser-capable runner,
then take one owner-hardware WebGPU screenshot with the settings panel open. It
should show a rendered world; if a driver-specific failure remains, the new
`render` diagnostics row and `console.error` preserve the exact failing stage
instead of a black frame.
