## Conclusion

Phase 1 code lane is complete.

Implemented:

- Clean-room Q3-style pmove with DEFAULT/SCOUTZ presets, jump buffering, slope handling, swept BVH capsule collision, sub-stepping, four clip iterations, and 0.45 m step-up in [packages/sim](/Volumes/SD/gungame/packages/sim/src/step.ts).
- Zero-dependency gameplay-map codec in [map.ts](/Volumes/SD/gungame/packages/shared/src/map.ts).
- GLTF mappipe CLI, validator, format documentation, and programmatic greybox generator in [tools/mappipe](/Volumes/SD/gungame/tools/mappipe/README.md).
- Shipped [greybox.gltf](/Volumes/SD/gungame/maps/greybox.gltf) and [greybox.blob](/Volumes/SD/gungame/maps/greybox.blob).
- Isolated playground seam in [sim-bridge.ts](/Volumes/SD/gungame/client/src/sim-bridge.ts), without camera, input handling, pointer lock, UI, or canvas methods.

## Verification evidence

```text
$ pnpm -r typecheck && pnpm -r test
...
tools test: valid maps/greybox.gltf: 219 triangles, 24 spawns, modes 0,1, 1 kill volumes
tools test: valid maps/greybox.blob: 219 triangles, 24 spawns, modes 0,1, 1 kill volumes
packages/sim test: Test Files  4 passed (4)
packages/sim test: Tests       6 passed (6)
exit 0
```

```text
$ pnpm mappipe maps/greybox.gltf
emitted /Volumes/SD/gungame/maps/greybox.blob:
219 triangles, 24 spawns, modes 0,1, 1 kill volumes
exit 0
```

Client production build also exited 0. Blob header inspection confirmed `GGMP`, version 1, 438 position floats, 657 indices, 24 spawns, and one kill volume.

## Caveats

- I did not append `docs/codex-lanes/phase1-report.md` because the same request explicitly prohibited touching `docs/codex-lanes/`. This handoff contains the requested report instead.
- The client build retains its existing >500 kB chunk warning but remains below the 3 MB gzip budget.
- Temporary generated `tools/maps` and `client/dist` directories were moved recoverably to `/tmp/gungame-tools-maps-20260718` and `/tmp/gungame-client-dist-20260718`.

## Next action

Fable can import `createPlayground()` and connect the separately owned camera, §3.6 input path, dev panel, and feel controls for owner sign-off.