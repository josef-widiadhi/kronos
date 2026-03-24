#!/usr/bin/env bash
# Full reset — removes all containers AND data volumes
# WARNING: This deletes all KB collections, agents, and Ollama models
cd "$(dirname "$0")/../docker"
COMPOSE=$(docker compose version &>/dev/null 2>&1 && echo "docker compose" || echo "docker-compose")

echo "WARNING: This will delete ALL KRONOS data including:"
echo "  - PostgreSQL database (agents, KB collections)"
echo "  - ChromaDB vector store (all embeddings)"
echo "  - Ollama models (will need to re-pull)"
echo ""
read -p "Type RESET to confirm: " confirm
[ "$confirm" = "RESET" ] || { echo "Cancelled."; exit 0; }

echo "Resetting KRONOS..."
$COMPOSE down -v
docker volume rm kronos_postgres_data kronos_chroma_data kronos_ollama_data kronos_redis_data 2>/dev/null || true
echo "Done. Run start.sh to start fresh."
