#!/usr/bin/env bash
set -euo pipefail

REVISION="${1:-origin/main}"
DEPLOY_HOST="${GUNGAME_DEPLOY_HOST:-root@dream-runner}"

if [[ ! "$REVISION" =~ ^[A-Za-z0-9._/@:+-]+$ ]]; then
  echo "error: revision contains unsupported characters: $REVISION" >&2
  exit 2
fi

echo "==> Deploying gungame revision '$REVISION' through $DEPLOY_HOST"
ssh "$DEPLOY_HOST" bash -s -- "$REVISION" <<'REMOTE'
set -euo pipefail

revision="$1"
repo_dir="/opt/gungame"
repo_url="https://github.com/whatgoodarewords/gungame"
compose_file="deploy/docker-compose.gg.yml"

echo "==> Ensuring the deployment repository exists at $repo_dir"
mkdir -p /opt
if [[ ! -e "$repo_dir" ]]; then
  git clone "$repo_url" "$repo_dir"
elif [[ ! -d "$repo_dir/.git" ]]; then
  echo "error: $repo_dir exists but is not a git checkout" >&2
  exit 1
fi

echo "==> Fetching origin"
git -C "$repo_dir" fetch --tags --prune origin \
  '+refs/heads/*:refs/remotes/origin/*'

echo "==> Resetting the deployment checkout to $revision"
git -C "$repo_dir" reset --hard "$revision"
resolved_sha="$(git -C "$repo_dir" rev-parse HEAD)"
image="gungame:$resolved_sha"
echo "==> Resolved deployment SHA: $resolved_sha"

echo "==> Building $image for linux/amd64 on the dream server"
docker build \
  --platform linux/amd64 \
  --build-arg "BUILD_HASH=$resolved_sha" \
  --file "$repo_dir/deploy/Dockerfile" \
  --tag "$image" \
  "$repo_dir"

echo "==> Starting only the gungame compose service"
cd "$repo_dir"
GUNGAME_IMAGE="$image" \
GUNGAME_BUILD_HASH="$resolved_sha" \
docker compose --project-name gungame --file "$compose_file" \
  up --detach --no-build gungame

echo "==> Waiting for the gungame container healthcheck"
container_id="$(
  GUNGAME_IMAGE="$image" \
  GUNGAME_BUILD_HASH="$resolved_sha" \
  docker compose --project-name gungame --file "$compose_file" ps --quiet gungame
)"
if [[ -z "$container_id" ]]; then
  echo "error: compose did not return a gungame container id" >&2
  exit 1
fi

for attempt in $(seq 1 60); do
  health="$(
    docker inspect \
      --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}' \
      "$container_id"
  )"
  echo "    health attempt $attempt/60: $health"
  if [[ "$health" == "healthy" ]]; then
    break
  fi
  if [[ "$health" == "unhealthy" || "$health" == "missing" ]]; then
    docker logs --tail 100 "$container_id" >&2
    exit 1
  fi
  sleep 2
done

health="$(
  docker inspect \
    --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}' \
    "$container_id"
)"
if [[ "$health" != "healthy" ]]; then
  echo "error: gungame did not become healthy within 120 seconds" >&2
  docker logs --tail 100 "$container_id" >&2
  exit 1
fi

echo "==> Confirming the public health endpoint from the dream server"
curl --fail --show-error --silent https://dev.sml.world/gg/healthz
echo
echo "==> Dream-server deployment complete: $resolved_sha"
REMOTE

echo "==> External verification (run from a machine outside the dream server):"
echo "    curl --fail --show-error --location https://dev.sml.world/gg/"
echo "    curl --fail --show-error https://dev.sml.world/gg/healthz"
echo "    pnpm wan-smoke -- --bots 12 --duration 60"
