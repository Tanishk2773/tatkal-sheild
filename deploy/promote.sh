#!/usr/bin/env bash
set -euo pipefail

candidate=${1:?Supply a full GHCR commit SHA tag}
[[ $candidate =~ ^ghcr\.io/[a-z0-9._/-]+:[a-f0-9]{40}$ ]]
: "${BOOKING_DEPLOY_DIR:?Set BOOKING_DEPLOY_DIR to the installed Compose project directory}"
cd "$BOOKING_DEPLOY_DIR"

export BOOKING_PORT=${BOOKING_PORT:-3011}
previous_id=$(docker compose ps -q app)
previous=
if [[ -n $previous_id ]]; then
  previous=$(docker inspect --format '{{.Config.Image}}' "$previous_id")
fi

export BOOKING_IMAGE=$candidate
docker compose pull app
if docker compose up -d --no-build --wait --wait-timeout 120 &&
  curl --retry 4 --retry-all-errors -fsS "http://127.0.0.1:$BOOKING_PORT/api/health" |
    jq -e --arg sha "${candidate##*:}" '.storage=="postgres" and .release==$sha'; then
  printf 'Deployed %s\n' "$candidate"
  exit 0
fi

if [[ -n $previous ]]; then
  BOOKING_IMAGE=$previous docker compose up -d --no-build --wait --wait-timeout 120
  printf 'Restored %s\n' "$previous" >&2
else
  docker compose stop app
fi
exit 1
