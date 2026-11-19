#!/usr/bin/env bash
set -euo pipefail

docker compose up -d --build --wait --wait-timeout 120
curl --fail --silent --show-error http://127.0.0.1:3011/api/health
printf '\nBooking website: http://127.0.0.1:3011/\nDevOps showcase: http://127.0.0.1:3011/jury/\nKeep this terminal open to keep WSL running.\n'
docker compose ps
exec docker compose logs --follow --tail 0
