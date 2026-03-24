#!/usr/bin/env bash
# Stop all KRONOS services
cd "$(dirname "$0")/../docker"
COMPOSE=$(docker compose version &>/dev/null 2>&1 && echo "docker compose" || echo "docker-compose")

echo "Stopping KRONOS..."
$COMPOSE down
echo "Done. Data volumes preserved. Run start.sh to restart."
