#!/usr/bin/env bash
cd "$(dirname "$0")/../docker"
COMPOSE=$(docker compose version &>/dev/null 2>&1 && echo "docker compose" || echo "docker-compose")

echo ""
echo "KRONOS — Service Status"
echo "──────────────────────────────────────────────"
$COMPOSE ps
echo ""
echo "API health:"
curl -sf http://localhost/api/health && echo "  [OK] healthy" || echo "  [--] not reachable"
echo ""
echo "Dashboard:  http://localhost"
echo "API Docs:   http://localhost/docs"
echo ""
