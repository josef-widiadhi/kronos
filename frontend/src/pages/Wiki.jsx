import React, { useState } from 'react'
import { BookOpen, ChevronDown, ChevronRight, Search } from 'lucide-react'
import { PageHeader } from '../components/layout/Layout'

const WIKI = [
  {
    section: 'Core Concepts',
    color: 'var(--accent)',
    entries: [
      {
        title: 'What is KRONOS?',
        body: `KRONOS (Knowledge Runtime Orchestration & Node Operating System) is a platform for building, training, deploying, and monitoring RAG-augmented AI workers.

The core problem it solves: when you run Ollama models in Docker, every container restart wipes the model's learned context. KRONOS solves this by "baking" knowledge directly into container images — so your agents carry their knowledge base with them, survive restarts, and can be tested before deployment.`,
      },
      {
        title: 'RAG — Retrieval Augmented Generation',
        body: `RAG is the technique of giving an LLM access to a searchable knowledge base at inference time.

How it works:
1. Your documents are split into chunks and converted to vectors (numbers that represent meaning)
2. These vectors are stored in ChromaDB (a vector database)
3. When you ask a question, KRONOS converts your question to a vector too
4. It finds the closest matching chunks from your knowledge base
5. Those chunks are injected as context into the LLM prompt
6. The LLM answers using both its training knowledge AND your documents

This means the model doesn't "memorize" your docs — it looks them up on demand. The quality of answers depends on: chunk size, embed model quality, and how well the question matches document language.`,
      },
      {
        title: 'Embed Model vs Chat Model',
        body: `These are two different models with different jobs:

EMBED MODEL (e.g. nomic-embed-text):
— Converts text into a list of numbers (a vector) that captures semantic meaning
— Small, fast, runs locally
— Used only during: document ingestion and query time
— nomic-embed-text is the recommended choice — it's already pulled

CHAT MODEL (e.g. qwen2.5-coder:7b, llama3.1:8b):
— The actual language model that generates answers
— Much larger, slower
— Used when: you ask a question or the agent processes a task
— Choose based on your use case: qwen2.5-coder for code, llama3.1 for general use

You need BOTH. The embed model finds the right context; the chat model writes the answer.`,
      },
      {
        title: 'KB Collection',
        body: `A KB (Knowledge Base) Collection is a named group of document chunks stored in ChromaDB.

Each collection has:
— A name (e.g. "pentest_docs", "company_policy")
— A chat model (what LLM will use this KB to answer)
— An embed model (used to vectorize documents — should be the same for all ingestion)
— A ChromaDB collection (internal storage, created automatically)
— A chunk count (how many text segments are stored)

Best practices:
— One KB per topic/domain (don't mix unrelated documents)
— Use the same embed model for a collection consistently
— More chunks = more storage but better coverage
— Test queries before deploying agents against a KB`,
      },
      {
        title: 'The Knowledge Baking Pipeline',
        body: `This is KRONOS's core innovation:

Traditional Docker+Ollama workflow (broken):
  Pull model → Learn/RAG → docker compose down -v → EVERYTHING LOST

KRONOS workflow (persistent):
  Ingest docs → Embed → Store in ChromaDB → COPY into Docker image → Deploy
  docker compose down → docker run same_image → KB still there ✓

The agent container carries a snapshot of its ChromaDB collection. This means:
— Agents are portable (export image, run anywhere)
— No re-learning on restart
— You can test before deploying
— Multiple agents can have different KB snapshots`,
      },
    ],
  },
  {
    section: 'Services & Infrastructure',
    color: 'var(--blue)',
    entries: [
      {
        title: 'Ollama — Binary vs API',
        body: `KRONOS connects to Ollama two ways:

BINARY CHECK:
— Checks if the "ollama" command-line tool is installed on the same machine as the API container
— Since KRONOS API runs in Docker (Python container), it will always show "not found"
— This is NORMAL and harmless — ignore it

API CHECK (what matters):
— Checks if the Ollama HTTP API at :11434 is reachable
— KRONOS points to your HOST machine's Ollama via host.docker.internal:11434
— This means ALL your locally pulled models are available immediately
— No re-downloading needed

The green dot and version number in the API box is what matters.`,
      },
      {
        title: 'ChromaDB — Vector Store',
        body: `ChromaDB is the database that stores all your document vectors.

Key facts:
— Runs as a Docker container (kronos_chroma) on port 8001
— Data is persisted in the kronos_chroma_data Docker volume
— KRONOS uses chromadb 1.x (upgraded from 0.5.x for stability)
— Collections are namespaced by tenant/database (defaults are used)

If you see "ChromaDB error: Not Found":
— Usually means client/server version mismatch (fixed in current build)
— Or the chroma container isn't healthy yet (wait 15s after startup)

ChromaDB is separate from Ollama — it stores vectors, not models.`,
      },
      {
        title: 'Approval Queue — Guardrail System',
        body: `Every destructive or deployment action in KRONOS requires owner approval before execution.

Actions that require approval:
— Ollama model pull (downloading new models)
— Ollama model delete
— Agent deployment (building + launching containers)
— Docker exec (running commands in containers)
— KB injection into existing containers

Workflow:
1. You request an action (e.g. "deploy agent")
2. KRONOS creates a pending approval request
3. You see a badge on the Approvals tab
4. Review the request details (what exactly will happen)
5. Approve or reject with an optional note
6. If approved, execute the action

This prevents accidental deployments and keeps an audit trail of all operations.`,
      },
      {
        title: 'MCP — Model Context Protocol',
        body: `MCP is a protocol that lets external tools (like Claude Desktop) call your KRONOS agents as tools.

Each agent automatically exposes:
— GET  /mcp/tools          → list what this agent can do
— POST /mcp/tools/{name}   → invoke a specific tool
— GET  /mcp/sse            → live event stream (heartbeat + tool manifest)
— POST /mcp/messages       → JSON-RPC envelope (Claude Desktop compatible)

Tool types by agent:
— url_crawler    → query_web_knowledge, chat_with_web_knowledge
— folder_watcher → query_documents, extract_from_documents
— rag_validator  → validate_rag_response, score_relevance
— All types      → get_agent_info

Orchestration lets you send one task to multiple agents and merge/rank results.`,
      },
    ],
  },
  {
    section: 'Agents & Workers',
    color: 'var(--green)',
    entries: [
      {
        title: 'Agent Types Explained',
        body: `KRONOS has 5 agent types, each with different MCP tools and default prompts:

URL CRAWLER — web knowledge specialist
Best for: competitor intel, documentation crawling, news monitoring
Tools: query_web_knowledge, chat_with_web_knowledge

DB LEARNER — structured data specialist
Best for: database exports, CSV/JSON data, analytics knowledge
Tools: query_database_knowledge, get_data_summary

FOLDER WATCHER — document specialist
Best for: internal docs, PDFs, manuals, policies, reports
Tools: query_documents, extract_from_documents

RAG VALIDATOR — quality control
Best for: validating other agents' answers, scoring confidence, catching hallucinations
Tools: validate_rag_response, score_relevance

CUSTOM — general purpose
Best for: anything that doesn't fit above, multi-purpose agents
Tools: query_knowledge, chat`,
      },
      {
        title: 'Default Workers (Seed)',
        body: `Clicking "Seed Default Workers" creates 6 pre-configured specialist agents:

doc_ingestor — watches /watch_folder for new files, auto-ingests
url_crawler — crawls URLs you provide into a KB
gdrive_reader — reads Google Drive shared public links
rag_validator — validates RAG answer quality with structured scoring
summarizer — auto-summarizes and catalogs documents into JSON
worker_monitor — monitors all workers, reports health and KB freshness

All are created as "staged" (not running). Assign a KB collection and deploy the ones you want.

To use doc_ingestor: set KRONOS_WATCH_FOLDER=D:/your/folder in docker/.env, then restart.`,
      },
      {
        title: 'Agent Lifecycle',
        body: `An agent goes through these states:

staged → deploying → running → stopped/error

STAGED: Created, not running. Can edit system prompt, model, KB.
DEPLOYING: Docker is building the image with baked KB.
RUNNING: Container is live, accepting queries via /chat and /mcp endpoints.
STOPPED: Container exists but is not running. Can restart.
ERROR: Build or startup failed. Check logs.

Important: You can only edit model/prompt while staged or stopped.
Once running, stop the agent first to make changes, then redeploy.

Deployment requires owner approval — the action goes to the Approvals queue.`,
      },
      {
        title: 'System Prompts — Best Practices',
        body: `The system prompt is the personality and instruction set for your agent. It's sent at the start of every conversation.

Good system prompt structure:
1. Role: "You are a [role] specialist"
2. Knowledge scope: "You have access to [what KB contains]"
3. Behavior rules: "Always cite sources / Be concise / Return JSON / etc."
4. Fallback: "If the answer is not in your knowledge base, say so"

Tips:
— Be specific about output format if you're consuming the agent programmatically
— For rag_validator, specify the exact JSON schema you want back
— For summarizer, specify what fields to extract
— Avoid "you can do anything" — scope the prompt to the KB domain
— Test with Chat Test before deploying`,
      },
    ],
  },
  {
    section: 'Configuration',
    color: 'var(--purple)',
    entries: [
      {
        title: 'secrets.env — What Goes Where',
        body: `KRONOS uses two config files in the docker/ directory:

secrets.env (NEVER commit to git):
— SECRET_KEY: random 64-char hex for JWT signing
— OWNER_USERNAME: your login username (default: admin)
— OWNER_PASSWORD_HASH: bcrypt hash of your password (use hash_password.bat)

.env (optional, for optional settings):
— KRONOS_WATCH_FOLDER: host path to mount for folder watching

Why separate files?
Docker Compose reads docker/.env automatically for variable substitution.
Bcrypt hashes contain $ signs which Docker Compose interprets as variables.
By keeping the hash in secrets.env (loaded via env_file:, not auto-loaded),
Docker Compose never tries to interpolate it.

Important: The hash in secrets.env must NOT have $$ escaping.
Write it exactly as output by hash_password.bat.`,
      },
      {
        title: 'Pointing to Your Local Ollama',
        body: `KRONOS connects to Ollama via host.docker.internal:11434.

This means:
— Ollama must be running on your host machine (it is if you have models)
— All models you've pulled (ollama list) are immediately available in KRONOS
— No re-downloading, no separate container
— Works on Windows, Mac, and Linux with Docker Desktop

If Ollama is not reachable (API shows offline):
1. Open a terminal and run: ollama serve
2. Or check that Ollama is running in your system tray
3. Firewall: Ollama must accept connections from 172.x.x.x (Docker subnet)

To use GPU acceleration, run Ollama normally on your host — Docker Desktop
passes GPU access through automatically on modern versions.`,
      },
    ],
  },
  {
    section: 'Pentest KB Builder',
    color: 'var(--red)',
    entries: [
      {
        title: 'RAG vs Fine-tuning for Pentesting',
        body: `RAG is NOT the same as training or fine-tuning. Here's the difference:

FINE-TUNING:
— Changes the model's internal weights
— Expensive (GPU time, hours to days)
— Knowledge becomes "baked in" but can't be updated without re-training
— Model may "hallucinate" about new CVEs it wasn't trained on

RAG (what KRONOS does):
— Model weights never change
— You feed it a searchable library of tool docs, techniques, payloads
— At question time, relevant chunks are retrieved and given as context
— Update the KB by adding documents — no retraining needed
— Model cites exactly where it got the answer from

For pentesting, RAG is actually BETTER than fine-tuning because:
— New CVEs and tool updates can be added to the KB immediately
— You can have separate KBs per engagement (network, web, wireless)
— You can verify which source the model used
— No expensive GPU required`,
      },
      {
        title: 'What gets ingested in Pentest KB',
        body: `The Pentest KB Builder ingests these knowledge sources:

TOOLS (built-in, always accurate):
— nmap: all scan types, OS detection, NSE scripts, timing, evasion
— metasploit: modules, payloads, meterpreter, post-exploitation
— sqlmap: injection techniques, tamper scripts, enumeration
— gobuster/ffuf: directory/file brute force, vhost fuzzing
— hydra: online brute force for SSH, FTP, HTTP, SMB, RDP
— john/hashcat: offline password cracking, hash formats, masks
— nikto: web server scanning, tuning options, evasion
— burpsuite: proxy, intruder, repeater, scanner, extensions
— wireshark/tshark: capture/display filters, credential extraction

EXTRAS:
— OWASP Top 10: A01-A10 with attack vectors and test cases
— Pentest Methodology: PTES 6 phases with tool commands
— Common Payloads: XSS, SQLi, SSRF, XXE, CMDi, path traversal
— Report Templates: CVSS scoring, finding format, severity matrix`,
      },
      {
        title: 'Example questions after building Pentest KB',
        body: `Once the KB is built and a pentest agent is deployed, you can ask:

TOOL USAGE:
— "What nmap flags perform a stealth SYN scan without ping?"
— "How do I run gobuster against a PHP site with extensions?"
— "What sqlmap tamper scripts bypass basic WAF filtering?"
— "How do I crack a bcrypt hash with hashcat?"

TECHNIQUE:
— "How do I exploit MS17-010 EternalBlue with Metasploit?"
— "What are common SSRF bypass techniques for 127.0.0.1?"
— "How do I enumerate SMB shares without credentials?"
— "What JWT attack works when alg is RS256?"

REPORT WRITING:
— "Generate a High severity finding report for reflected XSS"
— "Write a CVSS vector for unauthenticated RCE over network"
— "What's the remediation for SQL injection in a login form?"

METHODOLOGY:
— "What should I do after getting a low-priv shell on Linux?"
— "Walk me through a web app pentest methodology"
— "What Google dorks find exposed admin panels?"`,
      },
    ],
  },
]

function WikiEntry({ entry }) {
  const [open, setOpen] = useState(false)
  return (
    <div style={{
      borderBottom: '1px solid var(--border)',
    }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '12px 18px', background: 'none', border: 'none',
          cursor: 'pointer', textAlign: 'left',
          transition: 'background 0.1s',
        }}
        onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-hover)'}
        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
      >
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-primary)' }}>{entry.title}</span>
        {open ? <ChevronDown size={13} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
               : <ChevronRight size={13} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />}
      </button>
      {open && (
        <div style={{
          padding: '0 18px 16px 18px',
          animation: 'fadeIn 0.15s ease',
        }}>
          {entry.body.split('\n').map((line, i) => {
            if (line.trim() === '') return <div key={i} style={{ height: 8 }} />
            // Lines ending with : become section headers
            if (line.match(/^[A-Z][A-Z0-9\s]+:$/) || line.match(/^[A-Z][A-Z0-9\s—]+:$/)) {
              return <div key={i} style={{ fontSize: 10, color: 'var(--accent)', letterSpacing: '0.08em', marginTop: 10, marginBottom: 4 }}>{line}</div>
            }
            // Lines starting with — are bullet points
            if (line.trimStart().startsWith('—')) {
              return (
                <div key={i} style={{ display: 'flex', gap: 8, fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6, paddingLeft: 8 }}>
                  <span style={{ color: 'var(--accent)', flexShrink: 0 }}>—</span>
                  <span>{line.trimStart().slice(1).trim()}</span>
                </div>
              )
            }
            return <div key={i} style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6 }}>{line}</div>
          })}
        </div>
      )}
    </div>
  )
}

export default function WikiPage() {
  const [search, setSearch] = useState('')

  const filtered = WIKI.map(section => ({
    ...section,
    entries: section.entries.filter(e =>
      !search || e.title.toLowerCase().includes(search.toLowerCase()) ||
      e.body.toLowerCase().includes(search.toLowerCase())
    ),
  })).filter(s => s.entries.length > 0)

  return (
    <div style={{ animation: 'fadeIn 0.2s ease', maxWidth: 800 }}>
      <PageHeader
        title="KRONOS Wiki"
        subtitle="Reference documentation for every feature"
      />

      {/* Search */}
      <div style={{ position: 'relative', marginBottom: 20 }}>
        <Search size={13} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search wiki…"
          style={{
            width: '100%', padding: '9px 12px 9px 34px',
            borderRadius: 'var(--radius-lg)',
            border: '1px solid var(--border-mid)',
            background: 'var(--bg-surface)',
            color: 'var(--text-primary)',
            fontSize: 12, fontFamily: 'var(--font-mono)',
          }}
        />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {filtered.map(section => (
          <div key={section.section} style={{
            background: 'var(--bg-surface)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-lg)',
            overflow: 'hidden',
          }}>
            <div style={{
              padding: '10px 18px',
              borderBottom: '1px solid var(--border)',
              display: 'flex', alignItems: 'center', gap: 8,
            }}>
              <div style={{ width: 3, height: 14, background: section.color, borderRadius: 2 }} />
              <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 13 }}>{section.section}</span>
              <span style={{ fontSize: 10, color: 'var(--text-muted)', marginLeft: 'auto' }}>{section.entries.length} articles</span>
            </div>
            {section.entries.map(entry => (
              <WikiEntry key={entry.title} entry={entry} />
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
