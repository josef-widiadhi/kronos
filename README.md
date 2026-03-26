# KRONOS
**Knowledge Runtime Orchestration & Node Operating System**

A fully Dockerized platform for building, managing and deploying RAG-augmented AI agents.
Knowledge bases survive container restarts. Agents carry their KB with them.

---

## Quick Start

```bash
# Windows
scripts\start.bat

# Linux / Mac
chmod +x scripts/start.sh && ./scripts/start.sh
```

Press **Enter** when prompted to use the default `admin / admin` credentials,
or type a custom password. Then open **http://localhost**.

> First run downloads Docker images — allow 3–5 minutes. Subsequent starts take ~15s.

---

## Architecture

```
Browser → nginx :80
            ├── /api/*  → FastAPI :8000  (API container)
            └── /*      → React UI :3000 (UI container)

API connects to:
  PostgreSQL   — agents, KB metadata, approvals, settings
  ChromaDB     — vector embeddings (KB collections)
  Redis        — metrics / pub-sub
  Ollama       — LLM inference + embeddings (host machine via host.docker.internal:11434)
  docker.sock  — deploy / manage worker containers
```

**Ollama runs on your host machine** — all models you have already pulled are
immediately available. No re-downloading.

---

## Services

| Container         | Role                        | Port |
|-------------------|-----------------------------|------|
| `kronos_nginx`    | Reverse proxy, entry point  | 80   |
| `kronos_api`      | FastAPI backend             | 8000 |
| `kronos_ui`       | React frontend (nginx)      | 3000 |
| `kronos_postgres` | PostgreSQL database         | 5432 |
| `kronos_redis`    | Redis cache                 | 6379 |
| `kronos_chroma`   | ChromaDB vector store       | 8000 |

---

## Configuration Files

| File                        | Purpose                            |
|-----------------------------|------------------------------------|
| `docker/secrets.env`        | Secrets: password hash, secret key |
| `docker/.env`               | Optional settings                  |
| `docker/docker-compose.yml` | Service definitions                |

`secrets.env` is created automatically by `start.bat` / `start.sh`.

To regenerate manually:
```bash
python3 scripts/hash_password.py
# Paste the OWNER_PASSWORD_HASH output into docker/secrets.env
```

---

## RAG / KB — Collections as Center of Gravity

Each KB collection has three tabs:

**Ingest** — one-time file upload (PDF/DOCX/TXT/MD) or URL paste

**Sources** — automated sources that refresh on a schedule:

| Source       | What it does                                              |
|--------------|-----------------------------------------------------------|
| File Upload  | One-time file ingest                                      |
| Folder       | Per-collection folder path, scans .txt/.md/.csv          |
| URLs / Web   | Crawl with mode: single / recursive / sitemap            |
| Google Drive | Ingest from public Google Docs/Sheets/Drive folders      |

**Query** — test retrieval quality before deploying

**Deploy Agent** — one-click button in the collection header creates and queues
a pre-configured agent for that collection. No manual agent setup needed.

---

## Google Drive Integration

Two modes are supported. Start with **Option A** (zero setup). Use **Option B**
only if you need to ingest files that are not publicly shared.

---

### Option A — Public Share Links (no setup required)

**Best for:** documentation, shared notes, team knowledge bases that are already
set to "Anyone with the link can view".

**Steps:**

1. In Google Drive, right-click a file or folder → **Share**
2. Under "General access", change to **Anyone with the link** → set role to **Viewer**
3. Click **Copy link**
4. In KRONOS → **RAG / KB** → select a collection → **Sources** tab
5. Click **Add Google Drive** → paste the URL → choose a schedule → **Add Drive Source**
6. Click **Run** to ingest immediately

**What gets ingested:**

| Drive item      | How it's ingested                              |
|-----------------|------------------------------------------------|
| Google Doc      | Exported as plain text                         |
| Google Sheet    | Exported as CSV                                |
| Drive Folder    | All Docs and Sheets inside, recursively        |
| PDF / images    | Skipped — upload these via File Upload instead |

---

### Option B — Private Files via OAuth2

**Best for:** private documents, personal Drive, company Drive that can't be made public.

**Time required:** ~15 minutes to set up once, then automatic forever.

**What you need:** a Google account and access to
[Google Cloud Console](https://console.cloud.google.com).

---

#### Step 1 — Create a Google Cloud Project

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. In the top bar, click the project dropdown (it may say "Select a project" or show an existing project name)
3. Click **New Project** in the top-right of the dialog
4. **Project name:** `kronos-drive` (or any name you like)
5. **Location:** leave as "No organization" for personal use
6. Click **Create**
7. Wait a few seconds, then click the notification bell → **Select Project** to switch to it

> You should now see `kronos-drive` in the top bar project selector.

---

#### Step 2 — Enable the Google Drive API

1. In the left sidebar, go to **APIs & Services → Library**
   *(or search "API Library" in the top search bar)*
2. In the search box, type **Google Drive API**
3. Click the result titled exactly **"Google Drive API"** (by Google Enterprise API)
4. Click the blue **Enable** button
5. Wait for it to activate — you'll be redirected to the API overview page

> If you see "Manage" instead of "Enable", the API is already enabled. That's fine.

---

#### Step 3 — Configure the OAuth Consent Screen

This tells Google what your app is and who is allowed to use it.

1. In the left sidebar, go to **APIs & Services → OAuth consent screen**
2. **User Type:**
   - Choose **External** if you use a personal Gmail account
   - Choose **Internal** if you use Google Workspace (company email) — this is simpler
3. Click **Create**
4. Fill in the required fields:
   - **App name:** `KRONOS`
   - **User support email:** select your email from the dropdown
   - **Developer contact information:** type your email address
   - Leave everything else blank
5. Click **Save and Continue**

6. On the **Scopes** page:
   - Click **Add or Remove Scopes**
   - In the filter box, paste: `.../auth/drive.readonly`
   - Check the box next to **Google Drive API — `../auth/drive.readonly`**
   - Click **Update** at the bottom
   - Click **Save and Continue**

7. On the **Test Users** page *(External apps only — Internal skips this)*:
   - Click **Add Users**
   - Type your Google account email (the one that owns the Drive files)
   - Click **Add**
   - Click **Save and Continue**

8. Review the summary → click **Back to Dashboard**

> **Why "Test Users"?** While your app is in "Testing" status, only listed users
> can authorize it. For personal use this is fine — you never need to publish the app.

---

#### Step 4 — Create OAuth2 Credentials

1. In the left sidebar, go to **APIs & Services → Credentials**
2. Click **+ Create Credentials** at the top → choose **OAuth client ID**
3. **Application type:** select **Web application**
4. **Name:** `KRONOS Local`
5. Scroll to **Authorized redirect URIs** → click **+ Add URI**
6. Enter exactly:
   ```
   http://localhost/api/auth/gdrive/callback
   ```
7. Click **Create**

8. A popup appears showing your **Client ID** and **Client Secret**
9. Click **Download JSON** (the download icon, bottom-left of the popup)
10. The file saves as something like `client_secret_1234-abcd.apps.googleusercontent.com.json`

> Keep this file safe — treat it like a password. Do not commit it to git.

---

#### Step 5 — Install the Required Python Dependency

The API container needs `google-auth-oauthlib`. Add it to `backend/requirements.txt`:

```
google-auth-oauthlib>=1.2.0
google-api-python-client>=2.130.0
```

Then rebuild the API container:

```bash
cd docker
docker compose up -d --build kronos-api
```

---

#### Step 6 — Add the Credentials File to KRONOS

**Rename the file** (the downloaded name is very long):

```bash
# Linux / Mac
mv ~/Downloads/client_secret_*.json ~/Downloads/gdrive_credentials.json

# Windows (PowerShell)
Rename-Item "$env:USERPROFILE\Downloads\client_secret_*.json" "gdrive_credentials.json"

# Windows (Command Prompt)
rename "%USERPROFILE%\Downloads\client_secret_*.json" gdrive_credentials.json
```

**Verify the file looks correct** — open it and confirm it contains these fields:

```json
{
  "web": {
    "client_id": "1234567890-abcdef.apps.googleusercontent.com",
    "client_secret": "GOCSPX-...",
    "redirect_uris": ["http://localhost/api/auth/gdrive/callback"],
    "auth_uri": "https://accounts.google.com/o/oauth2/auth",
    "token_uri": "https://oauth2.googleapis.com/token"
  }
}
```

> If the top-level key says `"installed"` instead of `"web"`, you created a
> **Desktop app** credential instead of **Web application**. Go back to Step 4
> and create a new credential — select **Web application** this time.

**Add to KRONOS permanently** — place the file in `docker/` and mount it:

1. Copy `gdrive_credentials.json` into your `kronos/docker/` folder
   (next to `docker-compose.yml`)

2. Edit `docker/docker-compose.yml` — find the `kronos-api` service and add a volume:

   ```yaml
   kronos-api:
     volumes:
       - /var/run/docker.sock:/var/run/docker.sock
       - ./gdrive_credentials.json:/app/gdrive_credentials.json:ro   # ← add this line
   ```

3. Rebuild:
   ```bash
   cd docker
   docker compose up -d --build kronos-api
   ```

---

#### Step 7 — Authorize KRONOS to Access Your Drive

This happens once. After this, KRONOS syncs automatically.

1. In KRONOS → **RAG / KB** → select any collection → **Sources** tab
2. Click **Add Google Drive**
3. Paste a private Google Drive URL (file or folder)
4. Click **Add Drive Source**

5. Click **Run** — KRONOS detects the credentials file and returns an authorization message with a URL

6. **Copy that URL** → open it in your browser
7. Sign in with the Google account that owns the Drive files
8. You may see a warning: **"Google hasn't verified this app"**
   - Click **Advanced** → click **Go to KRONOS (unsafe)**
   - This warning appears because the app is in Testing mode — it is your own app, this is safe
9. Review permissions → click **Allow**
10. You are redirected back to `http://localhost/...` — the token is saved automatically

> The saved token is stored in the API container at `/app/gdrive_token.json`.
> It auto-refreshes — you will not need to re-authorize unless you revoke access
> from your Google account security settings.

---

#### Step 8 — Test the Integration

1. RAG / KB → select your collection → Sources → Google Drive → click **Run**
2. Watch the **Chunks** counter increase in the collection header
3. Switch to the **Query** tab → ask a question about the Drive content
4. Confirm relevant results appear with `gdrive:` in the source field

---

#### Troubleshooting OAuth

| Error message | Cause | Fix |
|---|---|---|
| `redirect_uri_mismatch` | The redirect URI in your credentials doesn't match | Go to Cloud Console → Credentials → edit your OAuth client → confirm `http://localhost/api/auth/gdrive/callback` is listed exactly |
| `access_denied` | Your account is not in the Test Users list | APIs & Services → OAuth consent screen → Test users → add your email |
| `invalid_client` | Wrong credential type or corrupted JSON | Re-download the JSON. Confirm the top-level key is `"web"`, not `"installed"` |
| `"Google hasn't verified this app"` | App is in Testing mode | This is normal for personal use — click Advanced → Go to KRONOS (unsafe) |
| Token expired / `invalid_grant` | Refresh token revoked | Delete `/app/gdrive_token.json` inside the container and re-authorize: `docker exec kronos_api rm -f /app/gdrive_token.json` |
| `File not found: gdrive_credentials.json` | Credentials not mounted | Confirm the file is in `docker/` and the volume line is in `docker-compose.yml`, then rebuild |
| Folder ingests 0 chunks | Folder contains only PDFs or images | These are skipped — export them to Google Docs format, or upload via File Upload tab |

---

## PDF Parsing — LiteParse vs pypdf

KRONOS uses two PDF parsers with automatic fallback:

| Parser | Quality | Speed | Requirement |
|--------|---------|-------|-------------|
| **LiteParse** | ⭐⭐⭐ Layout-aware, preserves columns/tables, OCR for scanned pages | Fast | Node.js + `npm install -g @llamaindex/liteparse` |
| **pypdf** | ⭐⭐ Plain text extraction, poor on complex layouts | Very fast | Already in requirements.txt |

KRONOS tries LiteParse first. If the `lit` CLI is not found in `PATH`, it falls back to pypdf silently — no configuration needed.

**Why LiteParse matters for RAG:** pypdf flattens multi-column PDFs into garbled text — words from two columns interleave. LiteParse reconstructs the spatial layout, so a 2-column pentest report or a table-heavy CVE document ingests correctly. Better text → better embeddings → better retrieval.

### Install LiteParse

LiteParse is a Node.js CLI tool. Install it once on your host machine:

```bash
# Requires Node.js 18+ (check: node --version)
npm install -g @llamaindex/liteparse

# Verify
lit --version
```

On Windows, if `lit` is not found after install, add the npm global bin to PATH:
```
# Find the path
npm config get prefix
# Add <prefix>\bin to your system PATH
```

For OCR on scanned PDFs (image-only pages), install Tesseract:
```bash
# Ubuntu / Debian
sudo apt-get install tesseract-ocr

# macOS
brew install tesseract

# Windows (via Chocolatey)
choco install tesseract
```

### Verify it's working

After installing, check the Monitor page — the **LiteParse PDF** service pill in the system health row should turn green. While amber/grey it means pypdf is being used instead.

You can also check via the API:
```bash
curl http://localhost/api/monitor/system | python -m json.tool | grep -A3 liteparse
```

### LiteParse inside Docker (optional)

If you want LiteParse available inside the API container itself (for folder-watch ingestion of PDFs), add it to the `kronos-api` Dockerfile:

```dockerfile
# After the Python deps install stage, add:
RUN apt-get install -y nodejs npm && \
    npm install -g @llamaindex/liteparse
```

Or add it to `docker/docker-compose.yml` as a build arg and update `backend/Dockerfile`. The simpler approach is to install Node.js on your host — the folder-watch source runs in the API container but the `lit` binary path can be mounted in via a volume.

---

## Pentest KB Builder

Builds a comprehensive pentesting knowledge base in one click.

**Tools covered:** nmap, metasploit, sqlmap, gobuster, ffuf, hydra, john, hashcat,
nikto, burpsuite, wireshark

**Also included:** OWASP Top 10 attack vectors, Pentest Methodology (PTES 6 phases),
Common Payloads (XSS/SQLi/SSRF/XXE/CMDi/path traversal), Report Templates with CVSS scoring

**Usage:**
1. RAG/KB → New Collection → name: `pentest_tools`, model: `qwen2.5-coder:7b`
2. Pentest KB → select collection → check all tools → click **Build Pentest KB**
3. Ingestion runs in the background (~2–5 min) — watch the chunk count grow in RAG/KB
4. Click **Create Pentest Agent** → Approvals → approve → Execute
5. Chat with it: *"nmap stealth scan all ports"*, *"generate High severity IDOR finding report"*

---

## Fine-Tune Studio

### How it works

```
KB Collection
    ↓ (Dataset Builder — no GPU)
LLM reads each KB chunk and generates Q&A pairs
    ↓
JSONL training file (alpaca / chatml / sharegpt format)
    ↓ (Fine-tune Job — GPU recommended)
Unsloth LoRA training in Docker container
    ↓
LoRA adapter saved
    ↓ (GGUF Export)
Quantized GGUF file
    ↓ (Import to Ollama)
New model available in all KRONOS dropdowns
```

### Prerequisites

Pull the Unsloth Docker image once:
```bash
docker pull unsloth/unsloth-repo:latest   # ~8 GB
```

### GPU / CPU Setting

Configure in **Settings → Compute → Training Device**:

| Value  | Speed      | Requirement                   |
|--------|------------|-------------------------------|
| `cpu`  | Very slow  | Any machine (hours/epoch)     |
| `cuda` | Fast       | NVIDIA GPU + CUDA drivers     |
| `mps`  | Medium     | Apple Silicon M1/M2/M3        |
| `auto` | Automatic  | Uses best available           |

For CPU testing: start with `tinyllama:1b` — much faster than 7B models.

### GGUF Quantization Options

| Level    | File size (7B) | Quality  | Recommended for         |
|----------|---------------|----------|-------------------------|
| `q2_k`   | ~2 GB         | Low      | Tiny devices, testing   |
| `q4_k_m` | ~4 GB         | Good     | Most use cases (default)|
| `q5_k_m` | ~5 GB         | Better   | When quality matters    |
| `q8_0`   | ~8 GB         | Near-lossless | High quality work |
| `f16`    | ~14 GB        | Full     | Maximum accuracy        |

---

## Push Model + KB to External Containers

Use **Docker → Push Model + KB** to transfer a trained model and knowledge base
to another container running on your machine (e.g. `arachne`, your own app).

**5-step wizard:**
1. Select target app container (for KB injection)
2. Select target Ollama container (for model push)
3. Pick which model to push
4. Pick which KB collections to inject
5. Queue for approval → go to Approvals → Execute

The target container receives:
- **Model**: pulled by the target Ollama from your host (no internet download)
- **KB**: copied as a ChromaDB persistent directory to `/root/.chroma`

Your app reads the injected KB with:
```python
import chromadb
client = chromadb.PersistentClient(path="/root/.chroma")
collection = client.get_collection("your_collection_name")
```

---

## Approval Queue

Every destructive or irreversible action requires owner approval before execution.

| Action               | Triggered by                  |
|----------------------|-------------------------------|
| Ollama model pull    | Ollama page → Request Pull    |
| Agent deploy         | Agents → Deploy / RAG → Deploy Agent |
| KB injection         | Docker → Push Model + KB      |
| Model push           | Docker → Push Model + KB      |
| Fine-tune job launch | Fine-Tune → New Job           |
| GGUF export          | Fine-Tune → Export GGUF       |

The Approvals page shows both **Approve** and **Execute** buttons together —
no need to navigate back to the originating page.

---

## Settings

All settings are stored in PostgreSQL and survive container restarts.

Key settings:

| Category  | Key                               | Default            | Effect                           |
|-----------|-----------------------------------|--------------------|----------------------------------|
| Compute   | `compute.device`                  | `cpu`              | cpu / cuda / mps / auto          |
| Compute   | `compute.gpu_memory_gb`           | `0` (auto-detect)  | VRAM hint for batch size          |
| Compute   | `compute.unsloth_image`           | `unsloth/...`      | Docker image for training         |
| Fine-tune | `finetune.default_method`         | `lora`             | lora / qlora / full               |
| Fine-tune | `finetune.gguf_quantization`      | `q4_k_m`           | GGUF export quantization          |
| Fine-tune | `finetune.default_epochs`         | `3`                | Training epochs                   |
| RAG       | `rag.chunk_size`                  | `512`              | Words per chunk                   |
| RAG       | `rag.default_embed_model`         | `nomic-embed-text` | Default embedding model           |
| General   | `general.require_approval_for_deploy` | `true`        | Toggle deploy approval requirement|

---

## MCP (Model Context Protocol)

Every deployed agent exposes MCP-compatible endpoints:

```
GET  /mcp/tools           List available tools
POST /mcp/tools/{name}    Invoke a tool
GET  /mcp/sse             SSE stream (Claude Desktop compatible)
POST /mcp/messages        JSON-RPC envelope
```

**Connect from Claude Desktop** — add to `claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "my-kronos-agent": {
      "url": "http://localhost/api/mcp/agents/{agent_id}/sse"
    }
  }
}
```

**Orchestration strategies:**

| Strategy     | Behavior                                               |
|--------------|--------------------------------------------------------|
| `parallel`   | All agents answer simultaneously, results merged       |
| `best_of`    | All agents answer, highest-relevance result returned   |
| `sequential` | Each agent's output is passed as context to the next   |

---

## Scripts

| Script                      | Windows                       | Purpose                                |
|-----------------------------|-------------------------------|----------------------------------------|
| `scripts/start.sh`          | `scripts/start.bat`           | Interactive setup + docker compose up  |
| `scripts/stop.sh`           | `scripts/stop.bat`            | Stop services (keep data)              |
| `scripts/reset.sh`          | `scripts/reset.bat`           | Full reset — removes all volumes       |
| `scripts/pull_model.sh`     | `scripts/pull_model.bat`      | Pull Ollama model into stack           |
| `scripts/logs.sh`           | `scripts/logs.bat`            | Tail service logs                      |
| `scripts/status.sh`         | `scripts/status.bat`          | Container status + health check        |
| `scripts/hash_password.py`  | `scripts/hash_password.bat`   | Generate bcrypt hash for secrets.env   |

---

## Troubleshooting

### Login fails — "Invalid credentials"

Delete `docker/secrets.env` and re-run the start script. Press Enter for `admin/admin`.

```bash
cd docker && del secrets.env      # Windows
cd docker && rm secrets.env       # Linux/Mac
cd .. && scripts\start.bat
```

### Ollama shows "offline"

Ollama must be running on your host machine:
```bash
ollama serve
```
KRONOS connects via `host.docker.internal:11434`.

On Linux, add to `docker-compose.yml` under `kronos-api`:
```yaml
extra_hosts:
  - "host.docker.internal:host-gateway"
```

### ChromaDB error on collection create

```bash
cd docker
docker compose up -d chromadb
# Wait 15 seconds, then retry the collection creation
```

### Agents fail to load / Seed failed

Check API startup logs:
```bash
cd docker && docker compose logs kronos_api --tail=50
```
If there are import errors, rebuild:
```bash
docker compose up -d --build kronos-api
```

### Fine-tune job fails immediately

1. Pull the Unsloth image: `docker pull unsloth/unsloth-repo:latest`
2. Check Settings → Compute → Training Device matches your hardware
3. Test with `tinyllama:1b` first (much faster on CPU)

### Full reset

```bash
scripts\reset.bat     # Windows — type RESET when prompted
scripts/reset.sh      # Linux/Mac
```

> This deletes all agents, KB collections, embeddings and approvals.
> Your Ollama models are **not** affected.

---

## Security Notes

- KRONOS is designed for **local or trusted-network** use
- Never commit `docker/secrets.env` or `docker/gdrive_credentials.json` to git
- Add them to `.gitignore`
- For production: use HTTPS, change the default secret key, use a strong password

---

## Project Structure

```
kronos/
├── backend/
│   ├── main.py                     FastAPI entry, router registration, scheduler
│   ├── core/
│   │   ├── config.py               pydantic-settings (env vars)
│   │   └── database.py             SQLAlchemy models + init
│   ├── routers/
│   │   ├── auth.py                 JWT + approval queue
│   │   ├── ollama.py               Model management
│   │   ├── rag.py                  Collections, sources, ingest, query, deploy-agent
│   │   ├── docker.py               Container list, push model, inject KB
│   │   ├── agents.py               Agent CRUD + Docker deploy pipeline
│   │   ├── monitor.py              System health + agent stats
│   │   ├── chat.py                 RAG chat test
│   │   ├── mcp.py                  MCP tool server + orchestration
│   │   ├── workers.py              Default worker seeds
│   │   ├── pentest.py              Pentest KB builder
│   │   ├── finetune.py             Dataset builder + LoRA jobs + GGUF export
│   │   ├── urlwatcher.py           Standalone URL watcher (advanced)
│   │   └── settings_router.py      Persistent system settings
│   └── workers/
│       ├── worker.py               Worker process (runs inside agent containers)
│       └── mcp_worker.py           MCP-enabled worker variant
├── frontend/src/
│   ├── App.jsx                     Router + auth guard
│   ├── api/index.js                Axios client + all API exports
│   ├── hooks/useStore.js           Zustand global state
│   ├── components/
│   │   ├── ui.jsx                  Design system
│   │   ├── help.jsx                Contextual help components
│   │   └── layout/Layout.jsx       Sidebar + background polling
│   └── pages/
│       ├── Monitor.jsx             System health + agent graphs
│       ├── Ollama.jsx              Model management
│       ├── RAG.jsx                 Collections + sources + deploy agent
│       ├── Docker.jsx              Container management + push wizard
│       ├── Agents.jsx              Agent registry + seed workers
│       ├── MCP.jsx                 Tool invocation + orchestration
│       ├── Pentest.jsx             Pentest KB builder
│       ├── FineTune.jsx            Dataset builder + training + arena
│       ├── Chat.jsx                RAG chat test
│       ├── Approvals.jsx           Approve + execute queued actions
│       ├── URLWatcher.jsx          Advanced scheduled crawl management
│       ├── SettingsPage.jsx        System settings
│       ├── Wiki.jsx                Reference documentation
│       └── HowTo.jsx               Step-by-step checklists
├── docker/
│   ├── docker-compose.yml          6-service stack
│   ├── secrets.env.example         Template (copy to secrets.env)
│   └── nginx/nginx.conf            Reverse proxy config
└── scripts/
    ├── start.sh / start.bat        One-command setup + launch
    ├── stop.sh / stop.bat
    ├── reset.sh / reset.bat
    ├── pull_model.sh / .bat
    ├── logs.sh / .bat
    ├── status.sh / .bat
    └── hash_password.py / .bat
```

---

## License

MIT
