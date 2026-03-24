#!/usr/bin/env bash
# ╔══════════════════════════════════════════════════════════════╗
# ║  KRONOS — One-command startup                                ║
# ║  Usage: ./start.sh                                           ║
# ╚══════════════════════════════════════════════════════════════╝
set -e
cd "$(dirname "$0")/../docker"

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; RED='\033[0;31m'; NC='\033[0m'

echo -e "${CYAN}"
cat << 'BANNER'
  ██╗  ██╗██████╗  ██████╗ ███╗   ██╗ ██████╗ ███████╗
  ██║ ██╔╝██╔══██╗██╔═══██╗████╗  ██║██╔═══██╗██╔════╝
  █████╔╝ ██████╔╝██║   ██║██╔██╗ ██║██║   ██║███████╗
  ██╔═██╗ ██╔══██╗██║   ██║██║╚██╗██║██║   ██║╚════██║
  ██║  ██╗██║  ██║╚██████╔╝██║ ╚████║╚██████╔╝███████║
  ╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═══╝ ╚═════╝ ╚══════╝
BANNER
echo -e "${NC}  Knowledge Runtime Orchestration & Node Operating System"
echo ""

# ── Check dependencies ────────────────────────────────────────────
echo -e "${YELLOW}[1/4] Checking dependencies...${NC}"
for cmd in docker python3; do
    if command -v $cmd &>/dev/null; then
        echo -e "  ${GREEN}✓${NC} $cmd"
    else
        echo -e "  ${RED}✗${NC} $cmd not found — required"
        exit 1
    fi
done
# Docker Compose V2
if docker compose version &>/dev/null 2>&1; then
    echo -e "  ${GREEN}✓${NC} docker compose (v2)"
    COMPOSE="docker compose"
elif command -v docker-compose &>/dev/null; then
    echo -e "  ${GREEN}✓${NC} docker-compose (v1)"
    COMPOSE="docker-compose"
else
    echo -e "  ${RED}✗${NC} docker compose not found"
    exit 1
fi

# ── Check .env ────────────────────────────────────────────────────
echo ""
echo -e "${YELLOW}[2/4] Checking configuration...${NC}"
if [ ! -f .env ]; then
    echo -e "  ${YELLOW}⚠${NC}  .env not found — generating now"
    echo ""

    # Generate secret key
    SECRET=$(python3 -c "import secrets; print(secrets.token_hex(32))")

    # Get password
    echo -e "  Set your owner password (used to log into KRONOS dashboard):"
    while true; do
        read -s -p "  Password: " PASS; echo
        read -s -p "  Confirm:  " PASS2; echo
        [ "$PASS" = "$PASS2" ] && break
        echo -e "  ${RED}Passwords don't match, try again.${NC}"
    done

    HASH=$(python3 -c "
from passlib.context import CryptContext
import sys
try:
    ctx = CryptContext(schemes=['bcrypt'], deprecated='auto')
    print(ctx.hash('$PASS'))
except Exception as e:
    print('ERROR: ' + str(e), file=sys.stderr)
    sys.exit(1)
" 2>/dev/null) || {
        echo -e "  ${RED}Could not generate hash. Installing passlib...${NC}"
        pip install passlib[bcrypt] -q
        HASH=$(python3 -c "from passlib.context import CryptContext; print(CryptContext(schemes=['bcrypt']).hash('$PASS'))")
    }

    cat > .env << ENVEOF
SECRET_KEY=${SECRET}
OWNER_USERNAME=admin
OWNER_PASSWORD_HASH=${HASH}
ENVEOF
    echo -e "  ${GREEN}✓${NC} .env created"
else
    echo -e "  ${GREEN}✓${NC} .env found"
    # Validate required keys
    for key in SECRET_KEY OWNER_PASSWORD_HASH; do
        if ! grep -q "^${key}=" .env; then
            echo -e "  ${RED}✗${NC} Missing ${key} in .env"
            exit 1
        fi
    done
fi

# ── Build and start ───────────────────────────────────────────────
echo ""
echo -e "${YELLOW}[3/4] Building and starting services...${NC}"
echo -e "  (first build may take 3-5 minutes)"
echo ""

$COMPOSE up -d --build

# ── Wait for health ───────────────────────────────────────────────
echo ""
echo -e "${YELLOW}[4/4] Waiting for services to be healthy...${NC}"

wait_healthy() {
    local name=$1; local url=$2; local max=60; local n=0
    printf "  %-20s " "$name"
    while [ $n -lt $max ]; do
        if curl -sf "$url" &>/dev/null; then
            echo -e "${GREEN}✓${NC}"
            return 0
        fi
        printf "."
        sleep 2; n=$((n+2))
    done
    echo -e " ${RED}timeout${NC}"
    return 1
}

wait_healthy "postgres"  "http://localhost/health" || true
wait_healthy "api"       "http://localhost/api/health"
wait_healthy "ollama"    "http://localhost:11434/api/version" 2>/dev/null || \
    echo -e "  ${YELLOW}ollama: checking internally...${NC}"
wait_healthy "chromadb"  "http://localhost/health" || true
wait_healthy "ui"        "http://localhost/"

echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║                                                      ║${NC}"
echo -e "${GREEN}║   KRONOS is running!                                 ║${NC}"
echo -e "${GREEN}║                                                      ║${NC}"
echo -e "${GREEN}║   Dashboard:  http://localhost                       ║${NC}"
echo -e "${GREEN}║   API Docs:   http://localhost/docs                  ║${NC}"
echo -e "${GREEN}║   Login:      admin / (your password)                ║${NC}"
echo -e "${GREEN}║                                                      ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════════════╝${NC}"
echo ""
echo "  Tip: pull a model to get started:"
echo "  docker exec -it kronos_ollama ollama pull llama3.2"
echo ""
echo "  View logs:  docker compose logs -f"
echo "  Stop:       docker compose down"
echo "  Full reset: docker compose down -v"
echo ""
