# Final report

## Conclusion

Phase 0 is implemented inside `/Volumes/SD/gungame`: strict ESM pnpm workspace; shared/sim/protocol/tools packages; three.js r185 WebGPU client with WebGL2 fallback, spinning cube, and FPS counter; Node/uWebSockets.js server; replay determinism test; size-limit; CI; and README commands.

All automated gates and HTTP smoke checks pass. No git operations were performed, and `docs/process-ledger.md` was untouched.

## Verification evidence

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
packages/sim test:    Duration  13.31s
packages/sim test: Done
```

The final `rg` produced no matches.

```sh
COREPACK_HOME=/private/tmp/gungame-corepack pnpm --filter @gungame/client build && COREPACK_HOME=/private/tmp/gungame-corepack pnpm --filter @gungame/client size
```

```text
dist/assets/index-3MUJPoeI.js   769.30 kB │ gzip: 210.40 kB
✓ built in 13.57s
Size limit: 3 MB
Size:       207.93 kB gzipped
```

```sh
COREPACK_HOME=/private/tmp/gungame-corepack pnpm dev
curl --fail --silent --show-error --dump-header - http://localhost:5173/gg/
```

```text
VITE v8.1.5 ready in 16187 ms
➜ Local: http://localhost:5173/gg/
HTTP/1.1 200 OK
```

```sh
COREPACK_HOME=/private/tmp/gungame-corepack pnpm dev:server
curl --fail --silent --show-error --dump-header - http://localhost:8787/gg/healthz
```

```text
dist/index.js 791b
⚡ Done in 884ms
gungame server listening on http://localhost:8787
HTTP/1.1 200 OK
uWebSockets: 20
{"ok":true,"tick":0}
```

The durable checkpoint and final report are in [phase0-report.md](/Volumes/SD/gungame/docs/codex-lanes/phase0-report.md).

## Material caveats

- The sandbox requires explicit writable Corepack/store paths. Normal shells can use the requested plain pnpm commands.
- No browser backend was available for screenshot-level verification. The route, cube/FPS module, declarations, and production bundle were verified.
- Local runtime smoke used Node v24.16.0. CI pins Node 22 and esbuild targets `node22`.
- pnpm ignored esbuild’s install script by policy, but both client and server builds ran successfully using the installed platform binary.
- Vite warns about the 769.30 kB minified chunk; its 207.93 kB gzip size is safely below the 3 MB hard limit.

## Next action

Prime review/integration: visually confirm `http://localhost:5173/gg/`, review the scaffold, and perform the git integration owned by the Prime.