# KRONOS
**Knowledge Runtime Orchestration & Node Operating System**

Fully Dockerized platform for building, baking, deploying, and monitoring
RAG-augmented AI agents — with persistent knowledge bases that survive
container restarts.

---

## Quick Start (3 commands)

```bash
git clone <repo> kronos && cd kronos

# Option A: interactive setup (recommended)
chmod +x scripts/start.sh && ./scripts/start.sh

# Option B: manual
python3 scripts/hash_password.py    # generates OWNER_PASSWORD_HASH
cp docker/.env.example docker/.env  # fill in SECRET_KEY + hash
cd docker && docker compose up -d
```

**Then open: http://localhost**

---

## Service Map

| Container        | Role                        | Internal Port |
|------------------|-----------------------------|---------------|
| `kronos_nginx`   | Reverse proxy / entry point | 80 (public)   |
| `kronos_api`     | FastAPI backend             | 8000          |
| `kronos_ui`      | React frontend (nginx)      | 3000          |
| `kronos_postgres`| Database                    | 5432          |
| `kronos_redis`   | Cache / pub-sub             | 6379          |
| `kronos_chroma`  | ChromaDB vector store       | 8000          |
| `kronos_ollama`  | Ollama LLM runtime          | 11434         |
| `kronos_ollama_init` | Pulls embed model (once) | —             |

**Nginx routing:**
```
http://localhost/          → React UI
http://localhost/api/*     → FastAPI (prefix stripped before forwarding)
http://localhost/docs      → Swagger UI
```

---

## The Core Innovation

```
❌ Old way (state lost on restart):
   docker run ollama → fresh model → RAG learn → docker down -v → GONE

✅ KRONOS way (state baked in):
   Ingest docs → embed → ChromaDB → COPY into image → deploy
   docker down → docker run same_image → KB still there
```

---

## Architecture

```
Browser
  │
  ▼
nginx :80
  ├─ /api/* ──────────────────────► FastAPI :8000
  │                                    ├── /auth      (JWT + approval queue)
  │                                    ├── /ollama    (model management)
  │                                    ├── /rag       (KB collections)
  │                                    ├── /docker    (container control)
  │                                    ├── /agents    (CRUD + deploy)
  │                                    ├── /monitor   (live stats)
  │                                    ├── /chat      (RAG test)
  │                                    └── /mcp       (tool servers)
  │
  └─ /* ──────────────────────────► React UI :3000
                                       8 pages:
                                       Monitor · Ollama · RAG/KB
                                       Docker · Agents · MCP
                                       Chat Test · Approvals

FastAPI connects to:
  postgres   (agents, KB metadata, approval queue)
  redis      (metrics stream)
  chromadb   (vector embeddings)
  ollama     (LLM inference + embedding)
  docker.sock (deploy/manage worker containers)

Deployed Workers (kronos_workers network):
  Each agent = Docker container running mcp_worker.py
  Exposes: /chat · /health · /activity · /mcp/tools · /mcp/sse
```

---

## Workflow

```bash
# 1. Pull a model (inside running stack)
./scripts/pull_model.sh llama3.2

# 2. Create a KB collection (via UI or API)
POST /api/rag/collections
{"name": "product_docs", "model": "llama3.2", "embed_model": "nomic-embed-text"}

# 3. Ingest documents
POST /api/rag/ingest/file   ← upload PDF/DOCX/TXT
POST /api/rag/ingest/url    ← crawl URLs

# 4. Test RAG quality
POST /api/chat/
{"model": "llama3.2", "message": "What is our return policy?", "kb_collection_id": "..."}

# 5. Create an agent
POST /api/agents
{"name": "support_bot", "agent_type": "custom", "model": "llama3.2",
 "kb_collection_id": "...", "system_prompt": "You are customer support..."}

# 6. Deploy (queued for approval)
POST /api/agents/deploy  {"agent_id": "..."}

# 7. Approve in dashboard (Approvals tab) → Execute

# 8. Use via MCP
POST /api/mcp/agents/{id}/call
{"tool_name": "chat", "arguments": {"message": "Hello"}}

# 9. Orchestrate multiple agents
POST /api/mcp/orchestrate
{"task": "Summarize our policy", "strategy": "parallel"}
```

---

## MCP Protocol

Every agent exposes MCP-compatible endpoints on its container:

```
GET  /mcp/tools          ← tool discovery
POST /mcp/tools/{name}   ← invoke tool
GET  /mcp/sse            ← SSE stream (tool manifest + heartbeats)
POST /mcp/messages       ← JSON-RPC envelope (Claude Desktop / MCP clients)
```

Tools are type-specific:
- `url_crawler`    → `query_web_knowledge`, `chat_with_web_knowledge`
- `db_learner`     → `query_database_knowledge`, `get_data_summary`
- `folder_watcher` → `query_documents`, `extract_from_documents`
- `rag_validator`  → `validate_rag_response`, `score_relevance`
- All types        → `get_agent_info`

Orchestration strategies: `parallel` · `sequential` · `best_of`

---

## GPU Support

Uncomment in `docker/docker-compose.yml`:

```yaml
ollama:
  deploy:
    resources:
      reservations:
        devices:
          - driver: nvidia
            count: all
            capabilities: [gpu]
```

---

## Scripts

Both `.sh` (Linux/Mac) and `.bat` (Windows) versions provided for every script.

| Script                    | Windows                   | Purpose                                  |
|---------------------------|---------------------------|------------------------------------------|
| `scripts/start.sh`        | `scripts/start.bat`       | Interactive setup + `docker compose up`  |
| `scripts/stop.sh`         | `scripts/stop.bat`        | Stop all services (keep data)            |
| `scripts/reset.sh`        | `scripts/reset.bat`       | Full reset — removes all volumes         |
| `scripts/pull_model.sh`   | `scripts/pull_model.bat`  | Pull Ollama model into running stack     |
| `scripts/logs.sh`         | `scripts/logs.bat`        | Tail service logs (all or specific)      |
| `scripts/status.sh`       | `scripts/status.bat`      | Show container status + health check     |
| `scripts/hash_password.py`| `scripts/hash_password.bat` | Generate bcrypt hash for .env          |

---

## Environment Variables (`docker/.env`)

| Variable              | Default                     | Description                    |
|-----------------------|-----------------------------|--------------------------------|
| `SECRET_KEY`          | *(required)*                | JWT signing key (32+ chars)    |
| `OWNER_USERNAME`      | `admin`                     | Dashboard login username       |
| `OWNER_PASSWORD_HASH` | *(required)*                | bcrypt hash from hash_password.py |

All other config (DB, Redis, Ollama, Chroma URLs) is pre-wired for Docker
via `docker-compose.yml` environment section.

---

## Project Structure

```
kronos/
├── backend/
│   ├── main.py                 FastAPI entry point
│   ├── Dockerfile              Multi-stage production build
│   ├── requirements.txt
│   ├── core/
│   │   ├── config.py           Settings (pydantic-settings)
│   │   └── database.py         SQLAlchemy models + init
│   ├── routers/
│   │   ├── auth.py             JWT + owner approval guardrail
│   │   ├── ollama.py           Ollama management
│   │   ├── rag.py              RAG builder (ingest + query)
│   │   ├── docker.py           Docker control + KB injection
│   │   ├── agents.py           Agent CRUD + deploy pipeline
│   │   ├── monitor.py          Live monitoring
│   │   ├── chat.py             RAG chat testing
│   │   └── mcp.py              MCP tool server layer
│   └── workers/
│       ├── worker.py           Base worker (runs in agent containers)
│       └── mcp_worker.py       MCP-enabled worker
├── frontend/
│   ├── Dockerfile              Multi-stage: Node build → nginx serve
│   ├── src/
│   │   ├── App.jsx             Router + auth guard
│   │   ├── api/index.js        Axios client
│   │   ├── hooks/useStore.js   Zustand global state
│   │   ├── components/
│   │   │   ├── ui.jsx          Design system components
│   │   │   └── layout/Layout.jsx  Sidebar + page layout
│   │   └── pages/
│   │       ├── Monitor.jsx     Live agent graphs
│   │       ├── Ollama.jsx      Model management
│   │       ├── RAG.jsx         KB collections
│   │       ├── Docker.jsx      Container management
│   │       ├── Agents.jsx      Agent CRUD + deploy
│   │       ├── MCP.jsx         Tool invocation + orchestration
│   │       ├── Chat.jsx        RAG chat tester
│   │       ├── Approvals.jsx   Owner approval queue
│   │       └── Login.jsx       Auth
├── docker/
│   ├── docker-compose.yml      Full 7-service stack
│   ├── .env.example            Environment template
│   └── nginx/
│       └── nginx.conf          Reverse proxy config
└── scripts/
    ├── start.sh                One-command startup
    ├── stop.sh                 Stop services
    ├── reset.sh                Full reset
    ├── pull_model.sh           Pull Ollama model
    └── hash_password.py        Generate password hash
```
