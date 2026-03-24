#!/usr/bin/env bash
# Pull an Ollama model into the running KRONOS stack
# Usage: ./pull_model.sh llama3.2
# Usage: ./pull_model.sh codellama:13b
MODEL=${1:-llama3.2}
echo "Pulling ${MODEL} into kronos_ollama..."
docker exec -it kronos_ollama ollama pull "$MODEL"
echo "Done. Model '${MODEL}' is now available in KRONOS."
