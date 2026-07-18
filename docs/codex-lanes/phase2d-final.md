## Conclusion

Phase 2d artifacts are complete and documented in [PHASE2D-REPORT.md](/Volumes/SD/gungame/deploy/PHASE2D-REPORT.md).

Implemented:

- Multi-stage Node 22 linux/amd64 [Dockerfile](/Volumes/SD/gungame/deploy/Dockerfile)
- Traefik-only [docker-compose.gg.yml](/Volumes/SD/gungame/deploy/docker-compose.gg.yml)
- Idempotent, service-scoped [deploy.sh](/Volumes/SD/gungame/deploy/deploy.sh)
- Imported-bot [WAN smoke runner](/Volumes/SD/gungame/tools/wan-smoke/run.ts)
- `/gg` redirect, static MIME serving, SPA fallback, and `0.0.0.0` binding in [server/src/index.ts](/Volumes/SD/gungame/server/src/index.ts)
- Root `deploy:staging` and `wan-smoke` scripts

## Verification evidence

- `pnpm -r typecheck` — passed
- WAN smoke strict typecheck — passed
- `pnpm -r test` — 51 tests passed; map and netsim fixtures passed
- `shellcheck deploy/deploy.sh` — clean
- Compose configuration validation — passed
- Local linux/amd64 image build — succeeded
- Runtime confirmed `linux/x64`, non-root UID 1000, and `uws_linux_x64_127.node`
- Container health, static routes, deep-link fallback, WebSocket handshake, and two-bot smoke — passed with zero protocol errors

## Material caveats

- No remote SSH or Docker commands were executed.
- Local Buildx is unavailable; Docker’s legacy builder successfully built and ran the linux/amd64 image under emulation.
- Real 12-bot WAN metrics remain pending deployment by the Prime.

## Next action

```sh
pnpm deploy:staging -- <sha>
pnpm wan-smoke -- --bots 12 --duration 60 \
  --output tools/wan-smoke/reports/staging.json
```