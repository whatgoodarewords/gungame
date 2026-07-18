# Dream-server staging deploy

The Prime runs the deployment from a development machine:

```sh
pnpm deploy:staging -- <git-sha-or-ref>
```

The revision defaults to `origin/main`. The script updates only
`/opt/gungame`, builds the selected revision on `root@dream-runner`, starts only
the `gungame` compose service, waits for its container healthcheck, and checks
the public health URL from the server.

The compose service joins the external Traefik network `smallworld-web`.
Override its name only when the target Traefik installation uses another
network:

```sh
TRAEFIK_NETWORK=smallworld-web pnpm deploy:staging -- origin/main
```

## Local linux/amd64 build

On a development machine with Docker Buildx:

```sh
docker buildx build \
  --platform linux/amd64 \
  --build-arg BUILD_HASH=local \
  --file deploy/Dockerfile \
  --tag gungame:local-amd64 \
  --load \
  .
```

The build fails if it is not executing as linux/x64 or if the Node 22
uWebSockets.js x64 prebuild is absent. `node:22-trixie-slim` is intentional:
the current native prebuild requires glibc 2.38 or newer.

After the Prime deploys, run the external confirmation:

```sh
pnpm wan-smoke
```
