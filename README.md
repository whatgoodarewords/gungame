# gungame

A browser-native multiplayer FPS built on the two things that made CS scoutzknivez and gun game great: floaty high-skill movement (low gravity, air-acceleration, air-strafing) and a tight kill-to-advance loop. Click a link, type a name, you're playing.

**Status: spec phase.** The full spec lives in the pinned `[SPEC]` issue and is going through an adversarial dual audit loop (Codex GPT-5.6 xhigh + cold Claude Fable passes, loop-until-clean) before a line of production code is written. Process ledger: [`docs/process-ledger.md`](docs/process-ledger.md).

## Architecture (decided)

- **TypeScript everywhere** — one deterministic-enough simulation package shared verbatim between client and server (prediction/reconciliation demand identical movement code on both ends)
- **three.js** (WebGPURenderer, WebGL2 fallback) client; kinematic Quake-3-style movement, no physics engine
- **Node 22 + uWebSockets.js** authoritative server, 64 Hz tick, lag-compensated hitscan
- **WebSocket-first**, WebTransport evidence-gated behind a measured Phase 2 decision table
- Target: `dev.sml.world/gg`

## License

MIT.
