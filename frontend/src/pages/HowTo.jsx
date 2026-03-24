import React, { useState } from 'react'
import { CheckSquare, Square, ChevronDown, ChevronRight, Terminal, Search } from 'lucide-react'
import { PageHeader } from '../components/layout/Layout'
import { Badge } from '../components/ui'

const HOWTOS = [
  {
    category: 'Getting Started',
    difficulty: 'beginner',
    guides: [
      {
        title: 'First-time setup checklist',
        time: '5 min',
        steps: [
          { done: false, text: 'Run scripts/start.bat (or start.sh on Mac/Linux)' },
          { done: false, text: 'When prompted, press Enter to use default admin/admin — or type your own password' },
          { done: false, text: 'Wait for "KRONOS is running!" message' },
          { done: false, text: 'Open http://localhost in your browser' },
          { done: false, text: 'Log in with admin / (your password)' },
          { done: false, text: 'Go to Ollama tab — verify your local models appear' },
          { done: false, text: 'Go to Agents tab → click "Seed Default Workers" to create the 6 specialist agents' },
        ],
        notes: 'The first startup downloads Docker images and builds containers — may take 3-5 minutes. Subsequent starts use cache and take ~15 seconds.',
      },
      {
        title: 'Create your first KB and test RAG',
        time: '10 min',
        steps: [
          { done: false, text: 'Go to RAG / KB → click "New Collection"' },
          { done: false, text: 'Enter a name (e.g. "my_docs"), select your preferred model from the dropdown, leave embed model as nomic-embed-text' },
          { done: false, text: 'Click Create' },
          { done: false, text: 'Select your new collection from the left sidebar' },
          { done: false, text: 'Click "Ingest" → drop a PDF or TXT file, or paste some URLs' },
          { done: false, text: 'Wait for ingestion to complete (shows chunk count)' },
          { done: false, text: 'Click "Test Query" → type a question about your document content' },
          { done: false, text: 'Review results — relevance % shows how well each chunk matches' },
          { done: false, text: 'Go to Chat Test tab → select model + your KB collection → ask a question' },
        ],
        notes: 'Good relevance scores are above 70%. If scores are low, try rephrasing your query to match the language in your documents.',
      },
    ],
  },
  {
    category: 'Working with Documents',
    difficulty: 'beginner',
    guides: [
      {
        title: 'Ingest a folder of documents from your PC',
        time: '5 min',
        steps: [
          { done: false, text: 'Create a folder on your PC, e.g. D:\\kronos-docs' },
          { done: false, text: 'Create or edit docker/.env (next to secrets.env)' },
          { done: false, text: 'Add line: KRONOS_WATCH_FOLDER=D:/kronos-docs' },
          { done: false, text: 'Restart the API: cd docker && docker compose up -d --build kronos-api' },
          { done: false, text: 'Create or select a KB collection in RAG / KB' },
          { done: false, text: 'Click "Scan Folder" button on the selected collection' },
          { done: false, text: 'View scan results — chunks ingested per file' },
          { done: false, text: 'Drop new files in the folder any time, then click Scan Folder again' },
        ],
        notes: 'Supported formats for folder scan: .txt, .md, .csv. For PDF and DOCX, use the file Upload button instead.',
      },
      {
        title: 'Crawl a website into a KB',
        time: '5 min',
        steps: [
          { done: false, text: 'Create a KB collection (RAG / KB → New Collection)' },
          { done: false, text: 'Select the collection' },
          { done: false, text: 'Click "Ingest"' },
          { done: false, text: 'In the URLs section, paste the URLs you want to crawl (one per line)' },
          { done: false, text: 'Click "Ingest URLs"' },
          { done: false, text: 'Wait — KRONOS fetches each URL, strips HTML, chunks and embeds the text' },
          { done: false, text: 'Test with a query to verify content was captured' },
        ],
        notes: 'For large sites, start with specific documentation pages rather than the homepage. Dynamic JavaScript-heavy pages may not extract well — prefer static HTML docs.',
      },
    ],
  },
  {
    category: 'Agents & Deployment',
    difficulty: 'intermediate',
    guides: [
      {
        title: 'Deploy an agent with a KB',
        time: '10 min',
        steps: [
          { done: false, text: 'Ensure you have a KB collection with ingested content (RAG / KB)' },
          { done: false, text: 'Go to Agents → click "New Agent"' },
          { done: false, text: 'Fill in name, select agent type, pick a model from dropdown' },
          { done: false, text: 'Select your KB collection from the dropdown' },
          { done: false, text: 'Review/edit the system prompt to match your use case' },
          { done: false, text: 'Click Create — agent appears as "staged"' },
          { done: false, text: 'Click the deploy (▶) button on the agent row' },
          { done: false, text: 'Go to Approvals tab — review the deploy request details' },
          { done: false, text: 'Click Approve' },
          { done: false, text: 'Back in Agents, click "Execute" for the approved deploy (or refresh — it auto-executes)' },
          { done: false, text: 'Agent status changes to "running" — check Monitor tab for live stats' },
        ],
        notes: 'First deployment builds a Docker image with your KB baked in — takes 1-2 minutes. Subsequent deploys of the same agent are faster.',
      },
      {
        title: 'Test an agent before deploying',
        time: '3 min',
        steps: [
          { done: false, text: 'Go to Chat Test tab' },
          { done: false, text: 'Select the model your agent will use' },
          { done: false, text: 'Select the KB collection the agent will use' },
          { done: false, text: 'Ask questions that represent real agent usage' },
          { done: false, text: 'Check that sources show (RAG is working) and answers are accurate' },
          { done: false, text: 'If quality is poor: check KB has enough content, try a stronger model, or refine the system prompt' },
          { done: false, text: 'Once satisfied, deploy from the Agents tab' },
        ],
        notes: 'Chat Test is the same RAG pipeline the deployed agent uses — what works here will work in the deployed container.',
      },
      {
        title: 'Use the Seed Default Workers shortcut',
        time: '2 min',
        steps: [
          { done: false, text: 'Go to Agents tab' },
          { done: false, text: 'Click "Seed Default Workers"' },
          { done: false, text: 'KRONOS creates 6 specialist agents using your first available model' },
          { done: false, text: 'Review each agent\'s system prompt (click Edit)' },
          { done: false, text: 'Assign KB collections to each agent (click Edit → KB Collection)' },
          { done: false, text: 'Deploy the agents you want active' },
          { done: false, text: 'Leave others as "staged" until you need them' },
        ],
        notes: 'The seed uses your first model alphabetically. Edit each agent and change to the best model for its job — e.g. qwen2.5-coder for code analysis, llama3.1 for documents.',
      },
    ],
  },
  {
    category: 'MCP & Orchestration',
    difficulty: 'advanced',
    guides: [
      {
        title: 'Call an agent as an MCP tool from Claude Desktop',
        time: '10 min',
        steps: [
          { done: false, text: 'Deploy at least one agent (see Deploy an agent guide)' },
          { done: false, text: 'Go to MCP tab — expand the agent to see its endpoint' },
          { done: false, text: 'Note the endpoint: POST /api/mcp/agents/{id}/call' },
          { done: false, text: 'In Claude Desktop, add a custom MCP server pointing to http://localhost/api/mcp/agents/{id}' },
          { done: false, text: 'Claude Desktop will discover tools via GET /api/mcp/agents/{id}/tools' },
          { done: false, text: 'Now you can call your KRONOS agent directly from Claude conversations' },
        ],
        notes: 'Each agent exposes tools based on its type (url_crawler gets query_web_knowledge, folder_watcher gets query_documents, etc.). All agents get get_agent_info.',
      },
      {
        title: 'Run multi-agent orchestration',
        time: '5 min',
        steps: [
          { done: false, text: 'Deploy 2+ agents with different KB collections' },
          { done: false, text: 'Go to MCP tab → click "Orchestrate"' },
          { done: false, text: 'Type your task (e.g. "Summarize our Q3 performance")' },
          { done: false, text: 'Choose strategy: parallel (all answer), sequential (chain), or best_of (highest relevance wins)' },
          { done: false, text: 'Select which agents to query (or leave empty for all running agents)' },
          { done: false, text: 'Click Orchestrate — see each agent\'s response' },
        ],
        notes: 'parallel: best when you want comprehensive coverage from multiple knowledge bases. best_of: best when agents overlap and you want the most relevant answer. sequential: best when later agents need earlier agents\' context.',
      },
    ],
  },
  {
    category: 'Troubleshooting',
    difficulty: 'beginner',
    guides: [
      {
        title: 'Fix "Invalid credentials" on login',
        time: '2 min',
        steps: [
          { done: false, text: 'Delete docker/secrets.env' },
          { done: false, text: 'Run scripts/start.bat again' },
          { done: false, text: 'When prompted, press Enter (uses admin/admin default) or type a new password' },
          { done: false, text: 'Run: cd docker && docker compose up -d --build kronos-api' },
          { done: false, text: 'Wait 15 seconds, try logging in again' },
        ],
        notes: 'The most common cause is a bcrypt hash with $ signs that got mangled. The start script handles escaping correctly when regenerating.',
      },
      {
        title: 'Fix "ChromaDB error: Not Found"',
        time: '2 min',
        steps: [
          { done: false, text: 'Check that kronos_chroma container is running (Docker Desktop)' },
          { done: false, text: 'If not healthy: cd docker && docker compose up -d chromadb' },
          { done: false, text: 'Wait 15 seconds for ChromaDB to fully start' },
          { done: false, text: 'Try creating the collection again' },
          { done: false, text: 'If still failing: cd docker && docker compose up -d --build kronos-api (rebuilds with chromadb 1.x)' },
        ],
        notes: 'This error was caused by chromadb client/server version mismatch (0.5.x vs 1.x). The current build uses chromadb>=1.0.0 for both.',
      },
      {
        title: 'Ollama API shows offline',
        time: '3 min',
        steps: [
          { done: false, text: 'Open a terminal and run: ollama serve' },
          { done: false, text: 'Or check Ollama is running in your system tray / taskbar' },
          { done: false, text: 'Verify: open http://localhost:11434/api/version in browser — should return JSON' },
          { done: false, text: 'If blocked by firewall: allow Ollama (or ollama.exe) through Windows Firewall' },
          { done: false, text: 'In KRONOS Ollama tab, click refresh' },
        ],
        notes: 'KRONOS connects to your host Ollama via host.docker.internal:11434. Ollama must be running on your PC (not inside Docker) for this to work.',
      },
      {
        title: 'Full reset (start fresh)',
        time: '2 min',
        steps: [
          { done: false, text: 'Run scripts/reset.bat (or reset.sh)' },
          { done: false, text: 'Type RESET when prompted' },
          { done: false, text: 'Wait for all volumes to be removed' },
          { done: false, text: 'Run scripts/start.bat to start fresh' },
        ],
        notes: 'This deletes ALL data: agents, KB collections, embeddings, approval history. Your Ollama models are NOT affected (they live outside KRONOS volumes).',
      },
    ],
  },
]

const DIFFICULTY_COLOR = { beginner: 'green', intermediate: 'amber', advanced: 'purple' }

function ChecklistStep({ step, onToggle }) {
  return (
    <div
      onClick={onToggle}
      style={{
        display: 'flex', alignItems: 'flex-start', gap: 10,
        padding: '6px 0', cursor: 'pointer',
        opacity: step.done ? 0.5 : 1,
        transition: 'opacity 0.15s',
      }}
    >
      {step.done
        ? <CheckSquare size={14} style={{ color: 'var(--green)', flexShrink: 0, marginTop: 2 }} />
        : <Square size={14} style={{ color: 'var(--text-muted)', flexShrink: 0, marginTop: 2 }} />}
      <span style={{
        fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5,
        textDecoration: step.done ? 'line-through' : 'none',
      }}>{step.text}</span>
    </div>
  )
}

function GuideCard({ guide }) {
  const [open, setOpen] = useState(false)
  const [steps, setSteps] = useState(guide.steps.map(s => ({ ...s })))
  const doneCount = steps.filter(s => s.done).length

  const toggleStep = i => {
    setSteps(prev => prev.map((s, idx) => idx === i ? { ...s, done: !s.done } : s))
  }

  return (
    <div style={{
      background: 'var(--bg-raised)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius-lg)',
      overflow: 'hidden',
    }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '12px 16px', background: 'none', border: 'none', cursor: 'pointer',
          textAlign: 'left', gap: 10,
        }}
        onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-hover)'}
        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
      >
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 13, marginBottom: 4 }}>{guide.title}</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>⏱ {guide.time}</span>
            <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{doneCount}/{steps.length} steps</span>
            {doneCount > 0 && (
              <div style={{ flex: 1, maxWidth: 80, height: 3, background: 'var(--border)', borderRadius: 2 }}>
                <div style={{ width: `${(doneCount / steps.length) * 100}%`, height: '100%', background: 'var(--green)', borderRadius: 2, transition: 'width 0.2s' }} />
              </div>
            )}
          </div>
        </div>
        {open ? <ChevronDown size={13} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
               : <ChevronRight size={13} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />}
      </button>

      {open && (
        <div style={{ padding: '0 16px 16px', animation: 'fadeIn 0.15s ease' }}>
          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }}>
            {steps.map((step, i) => (
              <ChecklistStep key={i} step={step} onToggle={() => toggleStep(i)} />
            ))}
          </div>
          {guide.notes && (
            <div style={{
              marginTop: 12, padding: '8px 12px',
              background: 'var(--accent-subtle)',
              border: '1px solid rgba(245,166,35,0.2)',
              borderRadius: 'var(--radius)',
              fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.6,
            }}>
              <span style={{ color: 'var(--accent)', fontWeight: 500 }}>Note: </span>
              {guide.notes}
            </div>
          )}
          <div style={{ marginTop: 10, display: 'flex', justifyContent: 'flex-end' }}>
            <button
              onClick={() => setSteps(guide.steps.map(s => ({ ...s, done: false })))}
              style={{ fontSize: 10, color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer' }}
            >
              reset checklist
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default function HowToPage() {
  const [search, setSearch] = useState('')

  const filtered = HOWTOS.map(cat => ({
    ...cat,
    guides: cat.guides.filter(g =>
      !search || g.title.toLowerCase().includes(search.toLowerCase()) ||
      g.steps.some(s => s.text.toLowerCase().includes(search.toLowerCase()))
    ),
  })).filter(c => c.guides.length > 0)

  return (
    <div style={{ animation: 'fadeIn 0.2s ease', maxWidth: 800 }}>
      <PageHeader
        title="How-To Guides"
        subtitle="Step-by-step checklists for every task"
      />

      <div style={{ position: 'relative', marginBottom: 20 }}>
        <Search size={13} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search guides…"
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

      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        {filtered.map(cat => (
          <div key={cat.category}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 14 }}>{cat.category}</span>
              <Badge color={DIFFICULTY_COLOR[cat.difficulty] || 'default'}>{cat.difficulty}</Badge>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {cat.guides.map(guide => <GuideCard key={guide.title} guide={guide} />)}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
