#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

container_started=0

cleanup() {
  if [ "$container_started" -eq 1 ]; then
    docker compose --file ./.config/compose.yaml down --volumes --remove-orphans || true
  fi
}

# DATABASE_URL が指定されている場合は、そのサーバーを使ってテストします。
if [ -z "${DATABASE_URL:-}" ]; then
  export DATABASE_URL="postgres://postgres:postgres@localhost:5432/postgres"
  container_started=1
  trap cleanup EXIT
  docker compose --file ./.config/compose.yaml up --detach --wait
fi

mise run test:server
mise run test:check
