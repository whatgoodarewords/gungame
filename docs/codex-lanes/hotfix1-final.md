Implemented all five findings with regressions. Full details are in [HOTFIX1-REPORT.md](/Volumes/SD/gungame/client/HOTFIX1-REPORT.md).

Conclusion:

- Unified server clock propagation and connection-scoped FSM quarantine.
- Added crouch-jump-turn matrix coverage and input inspector.
- Hardened detached-canvas pointer lock.
- Fixed grounded geometry and added coplanar-overlap CI validation.
- Surfaced WebSocket close codes/reasons.
- Added the scripted 90-second, 12-bot + 2-browser localhost runner.
- Did not modify `docs/` or `deploy/`; no git operations performed.

Verification:

- `pnpm -r typecheck && pnpm -r test` → exit `0`
- Protocol: 23/23
- Simulation: 39/39
- Server: 28/28
- Client: 39/39
- Tools/maps/assets: passed
- Separate 90-second 12-bot soak: 0 reconnects, 0 protocol errors, 69,136 snapshots, one server listen.

Material caveat: the two-browser soak could not complete on this managed host. Native Chromium was sandbox-denied; Docker Chromium missed the five-second handshake window during software-WebGL startup, and Docker Firefox could not create WebGL. No production timeout was weakened to force a pass.

Next action: run `pnpm --filter @gungame/tools test:e2e:hotfix1` on a host with usable Chromium graphics. Set `HOTFIX1_DOCKER_CONTAINER=<server-container>` to include Docker restart-log verification.