# Phase 2d — staging deploy artifacts + WAN confirm

## Progress

- 2026-07-18: Read `docs/SPEC.md` §3.4 and the dream-server live compose
  reference. Confirmed the pinned route, `web` entrypoint, router priorities,
  and external `smallworld-web` network.
- 2026-07-18: Inspected the Vite/server build layout, Node 22 uWebSockets.js
  prebuild selection, and the existing headless bot/netsim report schema.
- 2026-07-18: Added the container build/runtime stages, Traefik-only compose
  service, scoped remote deploy script, server static hosting, and WAN smoke
  runner.
- 2026-07-18: First validation pass found and fixed pnpm's literal `--`
  forwarding in the WAN CLI. The unintended pre-deploy HTTPS probe showed
  `/gg/` currently returns HTML while `/gg/healthz` also falls through to HTML;
  staging is therefore not yet deployed and no WAN metric claim is made here.
- 2026-07-18: Preserved SHA-based client/server build matching by exposing the
  compiled build hash on static responses and teaching the WAN-only WebSocket
  wrapper to apply it to the imported bot's Hello frame. The bot's movement,
  prediction, reconnect, byte counting, and metrics remain the existing
  `HeadlessBot` implementation.

## Verification log

### Passing checks

```text
$ bash -n deploy/deploy.sh
(no output; exit 0)

$ shellcheck deploy/deploy.sh
(no output; exit 0)

$ docker compose -f deploy/docker-compose.gg.yml config
services:
  gungame:
    image: gungame:staging
    restart: unless-stopped
    ...
    labels:
      traefik.http.routers.gungame.entrypoints: web
      traefik.http.routers.gungame.priority: "50"
      traefik.http.routers.gungame.rule: Host(`dev.sml.world`) && (Path(`/gg`) || PathPrefix(`/gg/`))
      traefik.http.services.gungame.loadbalancer.server.port: "8787"
networks:
  smallworld-web:
    name: smallworld-web
    external: true

$ pnpm -r typecheck
packages/shared typecheck: Done
packages/protocol typecheck: Done
packages/sim typecheck: Done
server typecheck: Done
tools typecheck: Done
client typecheck: Done

$ BUILD_HASH=phase2d-static pnpm --filter @gungame/client build
dist/index.html                      0.44 kB
dist/assets/greybox-aSMgwIrS.blob    4.88 kB
dist/assets/index-Btkxbwg3.css       0.43 kB
dist/assets/index-DXueZMkC.js      860.23 kB
✓ built in 13.07s

$ BUILD_HASH=phase2d-static pnpm --filter @gungame/server build
dist/index.js      781.1kb
dist/index.js.map    2.8mb
Done in 3248ms
```

### Expected pre-deploy failure

```text
HTTPS PASS https://dev.sml.world/gg/ (text/html)
Error: https://dev.sml.world/gg/healthz returned unexpected Content-Type 'text/html'
```

This is the current small-world frontend fallback, not a deployed gungame
health response. The Prime must run `deploy/deploy.sh` before the real WAN
confirmation.

### Container build iteration

```text
$ DOCKER_BUILDKIT=1 docker build --platform linux/amd64 ...
ERROR: BuildKit is enabled but the buildx component is missing or broken.

$ DOCKER_BUILDKIT=0 docker build --platform linux/amd64 ...
Step 17/28 : RUN ... pnpm --filter @gungame/client build ...
error during build:
Tsconfig not found /workspace/tsconfig.base.json
```

The first command records the local Buildx limitation. The legacy builder did
run the amd64 base image under emulation and caught a missing Docker build
input; `tsconfig.base.json` was added to the manifest-copy layer before the
next build.

The next image build completed, but executing that amd64 image caught a libc
compatibility failure before deployment:

```text
$ docker image inspect gungame:phase2d-local --format '{{.Os}}/{{.Architecture}}'
linux/amd64

Error: /lib/x86_64-linux-gnu/libc.so.6: version `GLIBC_2.38' not found
(required by /app/node_modules/uWebSockets.js/uws_linux_x64_127.node)
Node.js v22.23.1
```

`node:22-bookworm-slim` has glibc 2.36. Both build and runtime stages were
therefore moved to `node:22-trixie-slim`, which remains a slim Node 22 glibc
image and satisfies the prebuilt native module's libc floor.

The corrected image then passed build and runtime verification:

```text
$ DOCKER_BUILDKIT=0 docker build --platform linux/amd64 \
    --build-arg BUILD_HASH=phase2d-container \
    --file deploy/Dockerfile --tag gungame:phase2d-local .
Successfully built 98a55b745648
Successfully tagged gungame:phase2d-local

$ docker image inspect gungame:phase2d-local --format '{{.Os}}/{{.Architecture}}'
linux/amd64

$ docker exec gungame-phase2d-verify node -e '...'
{"uid":1000,"platform":"linux","arch":"x64","modules":"127",
 "uwsPrebuild":"node_modules/uWebSockets.js/uws_linux_x64_127.node",
 "present":true}

$ curl http://127.0.0.1:27872/gg/healthz
{"ok":true,"tick":41,"tickP95Ms":0.29983199999992394,"rooms":0,
 "connections":0,"overloaded":false}

$ pnpm wan-smoke -- --url ws://127.0.0.1:27872/gg/ws \
    --base-url http://127.0.0.1:27872/gg/ --bots 2 --duration 2
HTTPS PASS http://127.0.0.1:27872/gg/ (text/html; charset=utf-8)
HTTPS PASS http://127.0.0.1:27872/gg/healthz (application/json; charset=utf-8)
WS build handshake: phase2d-container
{
  "environment": "wan",
  "predictionCorrectionP95M": 0.000002210621483569817,
  "remoteEntityStallP95Ms": 4.718499999999949,
  "reconnectCount": 0,
  "protocolErrors": 0,
  "meanSnapshotBytes": 77.05058365758755,
  "maxSnapshotBytes": 87,
  "snapshots": 257,
  "movementMirrored": true
}
```

The Buildx form for normal local/CI use is documented in `deploy/README.md`:

```sh
docker buildx build --platform linux/amd64 --build-arg BUILD_HASH=local \
  --file deploy/Dockerfile --tag gungame:local-amd64 --load .
```

### Local route + WAN-runner integration

```text
$ ALLOW_HEADLESS_BOTS=1 PORT=27871 node server/dist/index.js
$ curl ... http://127.0.0.1:27871/gg
301 http://127.0.0.1:27871/gg/

$ curl ... http://127.0.0.1:27871/gg/
HTTP/1.1 200 OK
Content-Type: text/html; charset=utf-8
X-Gungame-Build: phase2d-local
Cache-Control: no-cache

$ curl ... http://127.0.0.1:27871/gg/r/test-room
200 text/html; charset=utf-8

$ curl ... http://127.0.0.1:27871/ggfoo
404

$ pnpm wan-smoke -- --url ws://127.0.0.1:27871/gg/ws \
    --base-url http://127.0.0.1:27871/gg/ --bots 2 --duration 2
HTTPS PASS http://127.0.0.1:27871/gg/ (text/html; charset=utf-8)
HTTPS PASS http://127.0.0.1:27871/gg/healthz (application/json; charset=utf-8)
WS build handshake: phase2d-local
{
  "schemaVersion": 1,
  "transport": "ws",
  "environment": "wan",
  "bots": 2,
  "durationSeconds": 2,
  "predictionCorrectionP95M": 0.000002016406289073089,
  "remoteEntityStallP95Ms": 1.448167000000467,
  "reconnectCount": 0,
  "protocolErrors": 0,
  "meanSnapshotBytes": 77.01171875,
  "maxSnapshotBytes": 87,
  "snapshots": 256,
  "movementMirrored": true
}
```

## Conclusion

Phase 2d deploy artifacts are ready for the Prime. The single image serves the
Vite client and authoritative WebSocket server on `0.0.0.0:8787`; `/gg`
redirects to `/gg/`, deep links use the SPA fallback, `/gg/healthz` remains
JSON, and `/gg/ws` remains the existing uWebSockets.js transport. Compose is
Traefik-only on the reference deployment's `web` entrypoint and external
`smallworld-web` network, with router priority 50 and no published host ports.

The deploy script is idempotent for `/opt/gungame`, builds the requested SHA on
the target, brings up only the `gungame` service, waits for health, and checks
the public health URL from the box. The WAN script performs both HTTPS checks,
then imports the existing `HeadlessBot` for a default 12-bot/60-second movement
run and emits the netsim schema tagged `"environment": "wan"`.

## Verification evidence

```text
$ pnpm -r typecheck
packages/shared typecheck: Done
packages/protocol typecheck: Done
packages/sim typecheck: Done
server typecheck: Done
tools typecheck: Done
client typecheck: Done

$ pnpm --filter @gungame/tools exec tsc -p wan-smoke/tsconfig.json
(no output; exit 0)

$ pnpm -r test
packages/protocol: Test Files 4 passed; Tests 16 passed
packages/sim:      Test Files 6 passed; Tests 23 passed
server:            Test Files 2 passed; Tests 9 passed
client:            Test Files 1 passed; Tests 3 passed
tools: valid maps/greybox.gltf
tools: valid maps/greybox.blob
tools: {"snapshotMeanBytes":223,"snapshotMaxBytes":223,
        "aggregateTickP95Ms":0.6420829999999569,"aggregateThresholdMs":18}

$ bash -n deploy/deploy.sh
(no output; exit 0)

$ shellcheck deploy/deploy.sh
(no output; exit 0)

$ docker compose -f deploy/docker-compose.gg.yml config --quiet
(no output; exit 0)

$ DOCKER_BUILDKIT=0 docker build --platform linux/amd64 ...
Successfully built 98a55b745648
Successfully tagged gungame:phase2d-local

$ docker image inspect gungame:phase2d-local --format '{{.Os}}/{{.Architecture}}'
linux/amd64

$ docker run --platform linux/amd64 ... gungame:phase2d-local
{"uid":1000,"platform":"linux","arch":"x64","modules":"127",
 "uwsPrebuild":"node_modules/uWebSockets.js/uws_linux_x64_127.node",
 "present":true}
```

## Material caveats

- No SSH, remote Docker, or remote compose command was executed, as required.
  The real staging deployment and 12-bot/60-second WAN metrics are pending the
  Prime.
- The development machine has Docker but not the Buildx component. The
  documented Buildx command could not run locally; the engine's legacy builder
  successfully built and ran the same `linux/amd64` image under emulation.
- The pre-deploy public probe confirms `/gg/healthz` is not routed to gungame
  yet. Its HTML response is expected until deployment and is not presented as
  WAN confirmation.
- Vite reports its pre-existing >500 kB chunk warning; the built JavaScript is
  860.24 kB (240.09 kB gzip), within the 3 MB gzip budget.

## Next action

The Prime should select the intended commit and run:

```sh
pnpm deploy:staging -- <sha>
pnpm wan-smoke -- --bots 12 --duration 60 \
  --output tools/wan-smoke/reports/staging.json
```

Then record the public health payload and WAN JSON in the Phase 2 exit
evidence.
