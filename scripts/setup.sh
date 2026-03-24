#!/usr/bin/env bash
# KRONOS — Quick start setup script
set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${CYAN}"
echo "  ██╗  ██╗██████╗  ██████╗ ███╗   ██╗ ██████╗ ███████╗"
echo "  ██║ ██╔╝██╔══██╗██╔═══██╗████╗  ██║██╔═══██╗██╔════╝"
echo "  █████╔╝ ██████╔╝██║   ██║██╔██╗ ██║██║   ██║███████╗"
echo "  ██╔═██╗ ██╔══██╗██║   ██║██║╚██╗██║██║   ██║╚════██║"
echo "  ██║  ██╗██║  ██║╚██████╔╝██║ ╚████║╚██████╔╝███████║"
echo "  ╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═══╝ ╚═════╝ ╚══════╝"
echo -e "${NC}"
echo "  Knowledge Runtime Orchestration & Node Operating System"
echo ""

# 1. Check dependencies
echo -e "${YELLOW}[1/5] Checking dependencies...${NC}"
for cmd in python3 docker docker-compose ollama; do
  if command -v $cmd &>/dev/null; then
    echo -e "  ${GREEN}✓${NC} $cmd found"
  else
    echo -e "  ✗ $cmd NOT found (required)"
  fi
done

# 2. Generate password hash
echo ""
echo -e "${YELLOW}[2/5] Setting up owner credentials...${NC}"
read -s -p "  Enter owner password: " OWNER_PASS
echo ""
HASH=$(python3 -c "from passlib.context import CryptContext; print(CryptContext(schemes=['bcrypt']).hash('${OWNER_PASS}'))")

# 3. Generate .env
echo ""
echo -e "${YELLOW}[3/5] Writing .env...${NC}"
SECRET=$(python3 -c "import secrets; print(secrets.token_hex(32))")
cat > backend/.env << EOF
SECRET_KEY=${SECRET}
OWNER_USERNAME=admin
OWNER_PASSWORD_HASH=${HASH}
DATABASE_URL=postgresql+asyncpg://kronos:kronos@localhost:5432/kronos
REDIS_URL=redis://localhost:6379
OLLAMA_BASE_URL=http://localhost:11434
CHROMA_HOST=localhost
CHROMA_PORT=8001
CHROMA_PERSIST_DIR=./chroma_data
DOCKER_SOCKET=unix:///var/run/docker.sock
KRONOS_WORKER_NETWORK=kronos_net
EMBED_MODEL=nomic-embed-text
EOF
echo -e "  ${GREEN}✓${NC} .env written"

# 4. Pull embed model
echo ""
echo -e "${YELLOW}[4/5] Pulling embed model (nomic-embed-text)...${NC}"
if ollama list | grep -q "nomic-embed-text"; then
  echo -e "  ${GREEN}✓${NC} nomic-embed-text already available"
else
  ollama pull nomic-embed-text
fi

# 5. Start stack
echo ""
echo -e "${YELLOW}[5/5] Starting KRONOS stack...${NC}"
cd docker && docker-compose up -d postgres redis chromadb
cd ..
sleep 3
echo -e "  ${GREEN}✓${NC} Infrastructure containers started"
echo ""
echo -e "${GREEN}╔══════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║  KRONOS is ready!                        ║${NC}"
echo -e "${GREEN}║                                          ║${NC}"
echo -e "${GREEN}║  API:     http://localhost:8000          ║${NC}"
echo -e "${GREEN}║  Docs:    http://localhost:8000/docs     ║${NC}"
echo -e "${GREEN}║  ChromaDB: http://localhost:8001         ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════╝${NC}"
echo ""
echo "  Start the API server:"
echo "  cd backend && uvicorn main:app --reload"
echo ""
