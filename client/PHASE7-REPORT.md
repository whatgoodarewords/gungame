# Phase 7 — look / feel / performance overhaul

Progressive implementation record. Measurements are left explicitly pending
until captured by the WebGL2 headless probes; no projected values are reported
as measured.

## Part 0 verification

Current-tree source audit:

- Live 6: style changes use `history.replaceState` and transactional
  `RecoverableRenderPipeline`; no navigation.
- Live 7: quickplay ranks rooms by connected-human count; fill bots are not
  counted.
- Live 8: welcome handling writes the canonical `/r/:id?room=:id` URL and both
  invite controls use it.
- Live 9: typed `room-not-found` refusal opens an in-card quickplay choice.
- Review P0/P1 1–9: bot commands execute; disconnected slots retain the
  45-second hold; empty rooms shed bots and reap; event journals exclude bots
  and held slots; canonical reconnect routing is present; interpolation prunes
  deleted entities; jump/fire pulses are consumed only at fixed ticks; spawn
  choice maximizes nearest-player distance; transient GPU geometry/material
  resources are disposed or shared.

The requested remaining review fixes 10, 11, 15, 16, and 17 plus focused tests
were already present when this lane began. They were preserved and will be
included in the full-suite verification receipt.

## Performance acceptance

The perf HUD breakdown shipped before Phase 7 visual features. Backtick now
shows smoothed frame, render-submit, lighting, post, particles, and character
rows. Particle and character CPU work is measured live without per-frame
instrumentation allocations; lighting/post rows are reserved for backend GPU
samples from the headless budget probe.

| Feature allocation (1440p M-series) | Budget | Measured WebGL2 |
|---|---:|---:|
| Lighting + shadows | ≤ 2.0 ms | not measured — no browser/GPU context available |
| Combined post chain | ≤ 1.0 ms | not measured — no browser/GPU context available |
| Particles + casings | ≤ 0.5 ms | not measured — browser launch aborted |
| Characters | ≤ 1.0 ms | not measured — browser launch aborted |
| Draw calls | ≤ 150 | not measured — browser launch aborted |
| 60 s heap delta | < 5 MB | not measured — browser launch aborted |
| Cold load at 50 Mbps | < 5 s | not measured — browser launch aborted |

These cells are deliberately not populated with zeroes, CPU projections, or
bundle-size estimates. The CI probe contains hard assertions for draw calls,
particles, characters, the 60-second heap delta, and throttled cold load; it
also captures per-style diagnostics for lighting/post analysis. It could not
execute in this sandbox: Browser control returned `No browser is available`,
Computer Use returned `Computer Use was not approved to use Google Chrome`,
and repository Playwright launched PID 70179 but Chrome exited `SIGABRT`
before a page/context existed. This is an acceptance blocker.

## Visual and audio deliverables

1. Real lighting: every style rig now uses one ambient IBL contribution and one
   tight-frustum 1024 px shadow-casting directional light with PCF soft
   shadows. Foundry, Spire, Duna, and Cascade each stream a different
   offline-prefiltered Poly Haven environment.
2. PBR: four 1K Poly Haven surface sets are triplanar sampled from world
   position with map-specific diffuse, AO, roughness, and metalness. Runtime
   requests KTX2, not source JPEGs.
3. Post: the tactile styles use a single TSL chain containing ACES, an
   emissive/highlight-only bloom shoulder, and a 9% maximum vignette. It
   contains no chromatic aberration or film grain. Diagnostic duotone/toon
   styles retain their deliberately different final quantization.
4. Impacts: pooled one-draw instanced sparks, surface-tinted puffs, rocket
   scorch flashes, one-frame pooled point lights, a 32-entry recycled casing
   pool, and a viewmodel-local muzzle light are installed.
5. Viewmodel: a fixed 54°/.01 m viewmodel camera is composited over the world
   camera. The centralized hold table covers all 13 unique weapon IDs and all
   14 ladder configurations, including exact per-weapon kick/rack/backpush,
   1.2° critically damped velocity sway, 6 mm/60 ms landing dip, 80 ms recoil
   decay, 140 ms overshooting equip raise, and 2 mm/3 s breathing. The real
   WRAD `socket.r`, `wrist_ik.r`, and `wrist_ik.l` bones are used. Contact
   shadow and left-hand foregrip targets ship. The 28-shot owner contact sheet
   remains pending browser capture and Prime review, so the hold is not yet
   called accepted.
6. Characters: streamed post-control character visuals use one instanced mesh
   per body part, a rim accent, pooled footstep dust, and an 850 ms
   single-impulse rag-pose fade. The gated Quaternius character/animation files
   are explicitly represented by the procedural rig fallback.
7. Dressing: three instanced batches (crates, pillars, rails) stream after the
   first controllable frame for every map. Placements correspond to baked map
   collision structures and are tagged with their baked collision source; they
   do not introduce a second coplanar collision surface.
8. Audio: gunshots have mechanical/body/tail layers; footsteps and landing
   whumps vary by surface/fall speed; near misses and four map room tones are
   present; Kenney UI sounds are used; the master routes through a gentle
   -12 dB, 3:1 compressor.

## Asset acquisition

Validated acquisition now contains 12 real GLBs, five real ZIP archives, 12
normalized runtime OGGs, four source HDRIs, 16 material KTX2s, and four
offline-prefiltered environment KTX2s. `assets/vendor/LICENSES.md` records the
source and license of every landed pack.

KTX Software `toktx` produces mipped 1K Basis/UASTC artifacts at build.
ImageMagick + FFmpeg perform the equirectangular-to-cubemap projection and an
explicit nine-level roughness convolution before `toktx`; no runtime PMREM
generator is used. Validator-estimated GPU residency is 24,466,784 bytes
against the 67,108,864-byte ceiling.

**OWNER FLAG — two-minute manual list:** the Quaternius Animated Guns, Sci-Fi
Gun/Modular Gun, Universal Base Characters, and Universal Animation Library
downloads remain gated in this headless environment. Put their GLB/glTF files
in the already-named empty vendor directories. Procedural streamed
character/dressing and energy-weapon fallbacks remain active until validation
passes. The optional authenticated Freesound raw shots are also absent;
Kenney+synthesis supplies the three shot layers.

## Streaming and hot-loop discipline

The combat-character module and map-dressing module are dynamic imports started
from a `requestAnimationFrame` only after a nonzero local player ID confirms the
first controllable state. The build emits them outside the initial module.
Projectile, character, impact, casing, dust, and perf loops reuse matrices,
vectors, typed arrays, sets, maps, and result objects. The browser CI script
collects garbage before and after a live 60-second bot interval and fails a
delta at or above 5 MiB.

## Verification log

- `node tools/assets/validate.mjs`
  → `{"glbs":12,"archives":5,"normalizedAudio":12,"ktx2":20,
  "offlinePmrem":4,"hdri":4,"gpuTextureBytes":24466784,
  "gpuTextureCeilingBytes":67108864,"vendorBytes":28504926,
  "clientPayloadGzipBytes":3806760,"ceilingBytes":8388608}`
- Focused P2/client regression run
  → 6 files passed, 25 tests passed (107.37 s).
- Client TypeScript (before the final dressing integration)
  → exit 0; the post-integration rerun is in progress.
- Direct production build with KTX2 textures + four PMREM assets
  → exact final-source 172-module build exited 0 in 2m01s. Deferred chunks are
  `map-dressing` 0.86 kB gzip and `combat-visuals` 2.77 kB gzip; they are not
  in the first controllable module.
- `pnpm -r test`
  → exit 0. Protocol: 4 files / 23 tests; sim: 7 / 39; server: 5 / 28;
  client: 12 / 57; tools map/race/net fixture/asset validations all passed.
- `pnpm -r typecheck`
  → exit 0 across protocol, shared, sim, client, server, and tools.
- Post-integration focused client regressions
  → 7 files / 32 tests passed, including all P2 behaviors, viewmodel dials,
  perf budgets, streamed dressing, and render rigs.
- Map receipt
  → coplanar validator passed; Spire (328 triangles), Foundry (412), Duna
  (344), and Cascade (1784) each passed source GLTF and baked-blob validation.
- Browser acceptance command
  → failed before page creation with Chrome `SIGABRT`; no visual artifact or
  measurement was emitted.

Conclusion: rendering/audio/assets implementation is integrated; final
acceptance is not claimed while browser measurements and Prime’s viewmodel
contact-sheet review remain outstanding.

Material caveats: gated packs are flagged rather than fabricated; this sandbox
has not yielded a hardware M-series GPU timer sample or any browser screenshot.

Next action: run `pnpm --filter @gungame/tools test:e2e` on a host where Chrome
can launch. It will enforce the WebGL2 CPU allocations/draw/load/heap ceilings,
write style × backend screenshots and `measurements.json`, and generate the
28-frame `client/artifacts/phase7/viewmodel-contact-sheet.png`; then Prime must
review that sheet.
