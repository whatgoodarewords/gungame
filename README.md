# gungame

A browser-native multiplayer FPS built on the two things that made CS scoutzknivez and gun game great: floaty high-skill movement (low gravity, air-acceleration, air-strafing) and a tight kill-to-advance loop. Click a link, type a name, you're playing.

**Status: Phase 0 scaffold.** The full spec lives in [`docs/SPEC.md`](docs/SPEC.md). Process ledger: [`docs/process-ledger.md`](docs/process-ledger.md).

## Architecture (decided)

- **TypeScript everywhere** — one deterministic-enough simulation package shared verbatim between client and server (prediction/reconciliation demand identical movement code on both ends)
- **three.js** (WebGPURenderer, WebGL2 fallback) client; kinematic Quake-3-style movement, no physics engine
- **Node 22 + uWebSockets.js** authoritative server, 64 Hz tick, lag-compensated hitscan
- **WebSocket-first**, WebTransport evidence-gated behind a measured Phase 2 decision table
- Target: `dev.sml.world/gg`

The pnpm workspace is split into `packages/shared`, `packages/sim`, and `packages/protocol`, plus the three.js `client`, Node `server`, and Phase 2 `tools` stub.

## Development

Node 22 or newer and pnpm are required.

```sh
pnpm install
pnpm dev
pnpm dev:server
```

The client is served at `http://localhost:5173/gg/`; the server health check is `http://localhost:8787/gg/healthz`.

Run the CI checks locally with `pnpm typecheck` and `pnpm test`.

## License

MIT.
