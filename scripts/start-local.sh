#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required. Install Docker Desktop or Docker Engine with Compose v2." >&2
  exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "Docker Compose v2 is required." >&2
  exit 1
fi

if [[ ! -f .env ]]; then
  cp docker-compose.env.template .env
  echo "Created .env from docker-compose.env.template."
fi

if command -v openssl >/dev/null 2>&1; then
  ensure_secret() {
    local name="$1"
    if ! grep -q "^${name}=" .env || grep -q "^${name}=replace-" .env; then
      printf '%s=%s\n' "$name" "$(openssl rand -hex 32)" >> .env
    fi
  }
  ensure_secret INTERNAL_SERVICE_KEY
  ensure_secret JWT_ACCESS_SECRET
  ensure_secret JWT_REFRESH_SECRET
fi

docker compose up --build -d
docker compose ps

if command -v curl >/dev/null 2>&1; then
  for _ in {1..60}; do
    if curl --silent --fail http://localhost:3000/ >/dev/null; then
      echo "ShopEase is ready at http://localhost:3000"
      exit 0
    fi
    sleep 2
  done
  echo "Containers started, but the frontend did not become ready within 120 seconds." >&2
  docker compose ps
  exit 1
fi

echo "ShopEase is starting at http://localhost:3000"
