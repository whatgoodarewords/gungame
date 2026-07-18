# Phase 0 implementation report

## Checkpoint 1 — install, typecheck, and test complete

### Conclusion

The pnpm workspace installs successfully; all workspace typechecks pass; the sim replay determinism hard-gate seed passes over 1,000 scripted ticks.

### Verification evidence

Command (sandbox-local Corepack and pnpm store paths are required because the host cache is not writable):

```sh
COREPACK_HOME=/private/tmp/gungame-corepack pnpm install --store-dir /Volumes/SD/gungame/.pnpm-store-10 --config.confirmModulesPurge=false --reporter append-only
```

Output tail:

```text
Progress: resolved 117, reused 55, downloaded 13, added 7, done
Done in 2m 30.9s using pnpm v10.34.5
```

Command:

```sh
COREPACK_HOME=/private/tmp/gungame-corepack pnpm -r typecheck && COREPACK_HOME=/private/tmp/gungame-corepack pnpm -r test
```

Output tail:

```text
packages/sim typecheck: Done
packages/sim test:  Test Files  1 passed (1)
packages/sim test:       Tests  1 passed (1)
packages/sim test:    Duration  12.09s (transform 879ms, setup 0ms, import 963ms, tests 2ms, environment 0ms)
packages/sim test: Done
```

### Material caveats

- This sandbox cannot write the normal Corepack/npm cache, so verification uses explicit writable cache/store paths. A normal development shell can run the documented commands without those prefixes.
- pnpm reports the esbuild install script as ignored by its default build policy; the platform esbuild binary package is installed. The client/server build checks will verify it directly.

### Next action

Build and size-check the client, then smoke-test `pnpm dev` and `pnpm dev:server`.

## Checkpoint 2 — client build, budget, and dev route complete

### Conclusion

The Vite client builds with three.js r185 WebGPURenderer, passes the 3 MB gzip hard budget, and `pnpm dev` serves the `/gg/` client route with its cube/FPS module.

### Verification evidence

Command:

```sh
COREPACK_HOME=/private/tmp/gungame-corepack pnpm --filter @gungame/client build && COREPACK_HOME=/private/tmp/gungame-corepack pnpm --filter @gungame/client size
```

Output tail:

```text
dist/assets/index-3MUJPoeI.js   769.30 kB │ gzip: 210.40 kB
✓ built in 13.57s
Size limit: 3 MB
Size:       207.93 kB gzipped
```

Commands:

```sh
COREPACK_HOME=/private/tmp/gungame-corepack pnpm dev
curl --fail --silent --show-error --dump-header - http://localhost:5173/gg/
curl --fail --silent --show-error http://localhost:5173/gg/src/main.ts | rg 'WebGPURenderer|setAnimationLoop|fps'
```

Output tail:

```text
VITE v8.1.5  ready in 16187 ms
➜  Local:   http://localhost:5173/gg/
HTTP/1.1 200 OK
const renderer = new WebGPURenderer({ antialias: true });
fps.textContent = `${Math.round(frameCount * 1e3 / elapsed)} fps`;
renderer.setAnimationLoop(render);
```

### Material caveats

- The in-app browser runtime exposed no browser backend, so visual screenshot verification was unavailable. HTTP delivery and the compiled WebGPU production bundle were verified; final visual confirmation remains a reviewer smoke step.
- Vite warns that the single 769.30 kB minified chunk exceeds its generic 500 kB warning threshold. Its gzip size is only 207.93 kB, safely below the spec's 3 MB hard budget; Phase 0 does not warrant premature splitting.

### Next action

Run `pnpm dev:server`, probe `/gg/healthz`, then consolidate the final report.

## Checkpoint 3 — server build and health route complete

### Conclusion

The Node server bundles through esbuild, loads uWebSockets.js v20, listens on the default port, and serves the exact Phase 0 health payload.

### Verification evidence

Commands:

```sh
COREPACK_HOME=/private/tmp/gungame-corepack pnpm dev:server
curl --fail --silent --show-error --dump-header - http://localhost:8787/gg/healthz
```

Output tail:

```text
dist/index.js      791b
dist/index.js.map  1.4kb
⚡ Done in 884ms
gungame server listening on http://localhost:8787
HTTP/1.1 200 OK
Content-Type: application/json; charset=utf-8
uWebSockets: 20
{"ok":true,"tick":0}
```

### Material caveats

- The smoke process was intentionally stopped after the successful probe; pnpm therefore reports the expected signal termination for the long-running dev command.
- The test host runs Node v24.16.0. The package and CI both require/run Node 22, and esbuild targets `node22`, but this sandbox does not expose a Node 22 binary for a second local runtime smoke.

### Next action

Prime review/integration: visually confirm the cube in a browser backend, then integrate the scaffold without changing the Phase 0 boundaries.

---

# Final report

## Conclusion

Phase 0 is implemented inside `/Volumes/SD/gungame`: a strict ESM pnpm workspace; shared/sim/protocol/tools packages; a three.js r185 WebGPU client with WebGL2 fallback, lit spinning cube, and FPS counter; a Node/uWebSockets.js health server bundled by esbuild; the 1,000-tick replay determinism test; gzip size-limit enforcement; CI; and README development commands. All automated gates and HTTP smoke checks pass. No git operations were performed, and `docs/process-ledger.md` was not touched.

## Verification evidence

Final frozen install, typecheck, replay test, and forbidden-sim-source scan:

```sh
COREPACK_HOME=/private/tmp/gungame-corepack pnpm install --store-dir /Volumes/SD/gungame/.pnpm-store-10 --frozen-lockfile --reporter append-only && COREPACK_HOME=/private/tmp/gungame-corepack pnpm -r typecheck && COREPACK_HOME=/private/tmp/gungame-corepack pnpm -r test && rg -n 'Math\.random|Date\.now' packages/sim || true
```

```text
Lockfile is up to date, resolution step is skipped
Already up to date
Done in 30.1s using pnpm v10.34.5
client typecheck: Done
packages/sim typecheck: Done
packages/sim test:  Test Files  1 passed (1)
packages/sim test:       Tests  1 passed (1)
packages/sim test:    Duration  13.31s (transform 3.81s, setup 0ms, import 7.30s, tests 2ms, environment 0ms)
packages/sim test: Done
```

The final `rg` produced no matches.

Client build and gzip budget:

```sh
COREPACK_HOME=/private/tmp/gungame-corepack pnpm --filter @gungame/client build && COREPACK_HOME=/private/tmp/gungame-corepack pnpm --filter @gungame/client size
```

```text
dist/assets/index-3MUJPoeI.js   769.30 kB │ gzip: 210.40 kB
✓ built in 13.57s
Size limit: 3 MB
Size:       207.93 kB gzipped
```

Client dev smoke:

```sh
COREPACK_HOME=/private/tmp/gungame-corepack pnpm dev
curl --fail --silent --show-error --dump-header - http://localhost:5173/gg/
curl --fail --silent --show-error http://localhost:5173/gg/src/main.ts | rg 'WebGPURenderer|setAnimationLoop|fps'
```

```text
VITE v8.1.5  ready in 16187 ms
➜  Local:   http://localhost:5173/gg/
HTTP/1.1 200 OK
const renderer = new WebGPURenderer({ antialias: true });
fps.textContent = `${Math.round(frameCount * 1e3 / elapsed)} fps`;
renderer.setAnimationLoop(render);
```

Server dev smoke:

```sh
COREPACK_HOME=/private/tmp/gungame-corepack pnpm dev:server
curl --fail --silent --show-error --dump-header - http://localhost:8787/gg/healthz
```

```text
dist/index.js      791b
⚡ Done in 884ms
gungame server listening on http://localhost:8787
HTTP/1.1 200 OK
uWebSockets: 20
{"ok":true,"tick":0}
```

## Material caveats

- This sandbox cannot write the normal Corepack/npm cache, so local verification required explicit writable Corepack/store paths. In a normal shell, the requested `pnpm install`, `pnpm -r typecheck`, and `pnpm -r test` commands use the same committed lockfile and scripts without those prefixes.
- The in-app browser exposed no browser backend, so screenshot-level visual verification was unavailable. The `/gg/` route, delivered WebGPURenderer/cube/FPS module, TypeScript declarations, and production bundle were verified; the Prime should visually confirm the cube during review.
- The local smoke host is Node v24.16.0. CI pins Node 22 and esbuild targets `node22`, but this sandbox did not expose a Node 22 binary for a second local runtime smoke.
- pnpm reports esbuild's install script as ignored by its default build policy; both Vite and the server esbuild script ran successfully using the installed platform binary.
- Vite emits its generic warning for a 769.30 kB minified chunk. The measured gzip size is 207.93 kB against the spec's 3 MB hard ceiling, so no Phase 0 code split was added.

## Next action

Prime review/integration: visually confirm `http://localhost:5173/gg/`, review the scaffold, and perform the git integration owned by the Prime.
