#!/usr/bin/env bash
# Usage: ./logs.sh              (all services)
# Usage: ./logs.sh kronos-api   (specific service)
cd "$(dirname "$0")/../docker"
COMPOSE=$(docker compose version &>/dev/null 2>&1 && echo "docker compose" || echo "docker-compose")
SERVICE=${1:-}
if [ -z "$SERVICE" ]; then
    echo "KRONOS — all services  [Ctrl+C to stop]"
    $COMPOSE logs -f --tail=50
else
    echo "KRONOS — $SERVICE  [Ctrl+C to stop]"
    $COMPOSE logs -f --tail=100 "$SERVICE"
fi
