#!/usr/bin/env bash
# Runs on digi (the self-hosted runner, from .github/workflows/ci.yml): deploy-server.sh <app dir under $HOME> <image tag>
# Starts the new image; if it isn't healthy within 90 seconds, puts the previous image and compose file back.
set -euo pipefail
cd "$HOME/$1"
tag=$2
image=$(docker compose config --images app | sed 's/:[^:/]*$//')

# What's running now, kept under a local tag so a rollback never depends on the registry.
if prev=$(docker inspect -f '{{.Image}}' intra-reimagined-app 2>/dev/null); then
  docker tag "$prev" "$image:rollback"
fi
cp docker-compose.yml docker-compose.yml.prev
mv docker-compose.yml.new docker-compose.yml
restore_compose() { mv docker-compose.yml.prev docker-compose.yml; }

set_tag() { # SERVER_TAG lives in .env, so a plain `docker compose up -d` keeps the deployed image
  if grep -q '^SERVER_TAG=' .env; then sed -i "s/^SERVER_TAG=.*/SERVER_TAG=$1/" .env; else echo "SERVER_TAG=$1" >> .env; fi
}
healthy() {
  for _ in $(seq 45); do # the image's healthcheck first runs ~30s after start
    [ "$(docker inspect -f '{{.State.Health.Status}}' intra-reimagined-app 2>/dev/null)" = healthy ] && return 0
    [ "$(docker inspect -f '{{.State.Running}}' intra-reimagined-app 2>/dev/null)" = true ] || return 1
    sleep 2
  done
  return 1
}

# The tag is only written to .env once the new image is up and healthy.
if ! SERVER_TAG=$tag docker compose pull app; then
  restore_compose
  echo "::error::couldn't pull $image:$tag; nothing changed"
  exit 1
fi
SERVER_TAG=$tag docker compose up -d app
if healthy; then
  set_tag "$tag"
  rm -f docker-compose.yml.prev
  echo "deployed $image:$tag"
  docker image prune -f >/dev/null
  exit 0
fi

echo "::error::$image:$tag isn't healthy, rolling back"
docker logs --tail 50 intra-reimagined-app || true
restore_compose
if docker image inspect "$image:rollback" >/dev/null 2>&1; then
  set_tag rollback
  docker compose up -d app
  healthy && echo "rolled back" || echo "::error::rollback isn't healthy either"
fi
exit 1
