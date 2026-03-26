import React, { useEffect, useState, useCallback } from 'react'
import { useDropzone } from 'react-dropzone'
import toast from 'react-hot-toast'
import { Database, Plus, Upload, Globe, Search, Trash2, FolderOpen,
         Play, RefreshCw, ChevronRight, Bot, Clock, Check, X, Zap, ExternalLink } from 'lucide-react'
import { PageHeader } from '../components/layout/Layout'
import { PageHelp, Hint, FieldLabel } from '../components/help'
import { Card, CardHeader, Btn, Badge, Modal, Spinner, Empty, SectionLabel } from '../components/ui'
import { getCollections, createCollection, deleteCollection, ingestFile, ingestURLs, queryKB } from '../api'
import { useStore } from '../hooks/useStore'
import api from '../api'

const SOURCE_META = {
  file_upload: { icon: '📄', label: 'File Upload',   color: 'default' },
  folder:      { icon: '📁', label: 'Folder Watch',  color: 'amber'   },
  urls:        { icon: '🌐', label: 'URL Crawl',     color: 'blue'    },
  gdrive:      { icon: '📊', label: 'Google Drive',  color: 'green'   },
}

const SCHED_LABELS = { manual: '⚡ Manual', hourly: '⏰ Hourly', daily: '📅 Daily', weekly: '🗓️ Weekly' }

// ── Collection card in left sidebar ──────────────────────────────────────────
function CollectionCard({ col, onDelete, onSelect, selected }) {
  return (
    <div onClick={() => onSelect(col)} style={{
      padding: '12px 14px',
      background: selected ? 'var(--accent-subtle)' : 'var(--bg-raised)',
      border: `1px solid ${selected ? 'rgba(245,166,35,0.4)' : 'var(--border)'}`,
      borderRadius: 'var(--radius-lg)', cursor: 'pointer', transition: 'all 0.12s',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 13 }}>{col.name}</span>
        <button onClick={e => { e.stopPropagation(); onDelete(col.id) }}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 2 }}
          onMouseEnter={e => e.currentTarget.style.color = 'var(--red)'}
          onMouseLeave={e => e.currentTarget.style.color = 'var(--text-muted)'}>
          <Trash2 size={11} />
        </button>
      </div>
      <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 6 }}>{col.description}</div>
      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
        <Badge color="amber">{col.model?.split(':')[0]}</Badge>
        <Badge color="blue">{col.doc_count} chunks</Badge>
        {col.agent_status && <Badge color={col.agent_status === 'running' ? 'green' : 'default'}>🤖 {col.agent_status}</Badge>}
        {(col.sources || []).map(s => (
          <Badge key={s.type} color={SOURCE_META[s.type]?.color || 'default'}>{SOURCE_META[s.type]?.icon}</Badge>
        ))}
      </div>
    </div>
  )
}

// ── Sources tab ───────────────────────────────────────────────────────────────
function SourcesTab({ col, onRefresh }) {
  const [addModal, setAddModal] = useState(null)  // null | 'folder' | 'urls' | 'gdrive'
  const [form, setForm] = useState({})
  const [saving, setSaving] = useState(false)
  const [running, setRunning] = useState(null)

  const handleAddSource = async () => {
    setSaving(true)
    try {
      if (addModal === 'folder') {
        await api.post(`/rag/collections/${col.id}/sources/folder`, form)
        toast.success('Folder source added')
      } else if (addModal === 'urls') {
        const urls = (form.urls || '').split('\n').map(u => u.trim()).filter(Boolean)
        await api.post(`/rag/collections/${col.id}/sources/urls`, { ...form, urls })
        toast.success(`URL source added: ${urls.length} seed URLs`)
      } else if (addModal === 'gdrive') {
        await api.post(`/rag/collections/${col.id}/sources/gdrive`, form)
        toast.success('Google Drive source added')
      }
      setAddModal(null)
      setForm({})
      onRefresh()
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed')
    } finally { setSaving(false) }
  }

  const handleRun = async (sourceType) => {
    setRunning(sourceType)
    try {
      await api.post(`/rag/collections/${col.id}/sources/${sourceType}/run`)
      toast.success(`${sourceType} ingestion started`)
      setTimeout(onRefresh, 2000)
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Run failed')
    } finally { setRunning(null) }
  }

  const handleRemove = async (sourceType) => {
    if (!confirm(`Remove ${sourceType} source?`)) return
    await api.delete(`/rag/collections/${col.id}/sources/${sourceType}`)
    onRefresh()
  }

  const inp = { padding: '7px 10px', borderRadius: 'var(--radius)', border: '1px solid var(--border-mid)', background: 'var(--bg-raised)', color: 'var(--text-primary)', fontSize: 12, fontFamily: 'var(--font-mono)', width: '100%' }
  const scheduleSelect = (
    <select value={form.schedule || 'manual'} onChange={e => setForm(f => ({ ...f, schedule: e.target.value }))} style={inp}>
      {Object.entries(SCHED_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  )

  return (
    <div>
      {/* Existing sources */}
      {(col.sources || []).length === 0 && (
        <div style={{ padding: '20px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
          No sources configured. Add a source below to keep this KB collection fresh automatically.
        </div>
      )}

      {(col.sources || []).map(src => {
        const meta = SOURCE_META[src.type] || { icon: '📌', label: src.type, color: 'default' }
        return (
          <div key={src.type} style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '12px 0', borderBottom: '1px solid var(--border)' }}>
            <span style={{ fontSize: 18, flexShrink: 0 }}>{meta.icon}</span>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <Badge color={meta.color}>{meta.label}</Badge>
                <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{SCHED_LABELS[src.schedule] || src.schedule}</span>
                {src.last_run && <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>last: {new Date(src.last_run).toLocaleString()}</span>}
                {src.last_chunks > 0 && <span style={{ fontSize: 10, color: 'var(--green)' }}>{src.last_chunks} chunks</span>}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
                {src.folder_path || src.gdrive_id || (src.urls || []).slice(0, 2).join(', ')}
                {(src.urls || []).length > 2 && ` +${src.urls.length - 2} more`}
              </div>
              {src.last_error && <div style={{ fontSize: 10, color: 'var(--red)', marginTop: 2 }}>{src.last_error}</div>}
            </div>
            <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
              <Btn size="sm" variant="success" onClick={() => handleRun(src.type)} loading={running === src.type}><Play size={10} /> Run</Btn>
              <Btn size="sm" variant="ghost" onClick={() => handleRemove(src.type)}><X size={10} style={{ color: 'var(--red)' }} /></Btn>
            </div>
          </div>
        )
      })}

      {/* Add source buttons */}
      <div style={{ marginTop: 14 }}>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8 }}>Add source:</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {[
            { type: 'folder', icon: '📁', label: 'Folder' },
            { type: 'urls',   icon: '🌐', label: 'URLs / Web' },
            { type: 'gdrive', icon: '📊', label: 'Google Drive' },
          ].map(s => (
            <Btn key={s.type} size="sm" variant="ghost" onClick={() => { setAddModal(s.type); setForm({ schedule: 'manual' }) }}>
              {s.icon} {s.label}
            </Btn>
          ))}
        </div>
      </div>

      {/* Add folder modal */}
      <Modal open={addModal === 'folder'} onClose={() => setAddModal(null)} title="Add Folder Source" width={480}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Hint type="tip">Enter the absolute path to a folder on your host machine. KRONOS will scan it for .txt, .md, .csv files. PDF/DOCX use file upload.</Hint>
          <div>
            <FieldLabel label="Folder Path" help="Absolute path on your Windows host, e.g. D:/my-docs or C:/Users/you/notes" />
            <input value={form.folder_path || ''} onChange={e => setForm(f => ({ ...f, folder_path: e.target.value }))}
              placeholder="D:/my-documents/pentest-notes" style={inp} />
          </div>
          <div><FieldLabel label="Auto-refresh schedule" />{scheduleSelect}</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            The path will be mounted into the container. Click Run to ingest files immediately.
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Btn variant="ghost" onClick={() => setAddModal(null)}>cancel</Btn>
            <Btn variant="accent" onClick={handleAddSource} loading={saving}>Add Folder Source</Btn>
          </div>
        </div>
      </Modal>

      {/* Add URLs modal */}
      <Modal open={addModal === 'urls'} onClose={() => setAddModal(null)} title="Add URL / Web Source" width={520}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <FieldLabel label="Seed URLs (one per line)" help="Starting URLs for crawling" />
            <textarea value={form.urls || ''} onChange={e => setForm(f => ({ ...f, urls: e.target.value }))}
              placeholder={"https://nmap.org/book/man.html\nhttps://owasp.org/www-project-top-ten/"}
              rows={4} style={{ ...inp, resize: 'vertical', lineHeight: 1.6 }} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <FieldLabel label="Mode" help="single: exact URLs only. recursive: follow links. sitemap: auto-discover via sitemap.xml" />
              <select value={form.mode || 'single'} onChange={e => setForm(f => ({ ...f, mode: e.target.value }))} style={inp}>
                <option value="single">Single pages</option>
                <option value="recursive">Recursive (follow links)</option>
                <option value="sitemap">Sitemap discovery</option>
              </select>
            </div>
            <div>
              <FieldLabel label="Max pages per run" />
              <input type="number" min={1} max={100} value={form.max_pages || 20}
                onChange={e => setForm(f => ({ ...f, max_pages: parseInt(e.target.value) }))}
                style={{ ...inp, width: 80 }} />
            </div>
          </div>
          {form.mode === 'recursive' && (
            <div>
              <FieldLabel label="Max depth" help="0 = seed only, 1 = seed + direct links, 2 = two levels deep" />
              <input type="number" min={0} max={5} value={form.max_depth || 1}
                onChange={e => setForm(f => ({ ...f, max_depth: parseInt(e.target.value) }))}
                style={{ ...inp, width: 60 }} />
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <FieldLabel label="Include pattern (regex)" help="Only crawl matching URLs" />
              <input value={form.include_pattern || ''} onChange={e => setForm(f => ({ ...f, include_pattern: e.target.value }))}
                placeholder="e.g. /docs/" style={inp} />
            </div>
            <div>
              <FieldLabel label="Exclude pattern (regex)" />
              <input value={form.exclude_pattern || ''} onChange={e => setForm(f => ({ ...f, exclude_pattern: e.target.value }))}
                placeholder="e.g. /(login|admin)" style={inp} />
            </div>
          </div>
          <div><FieldLabel label="Auto-refresh schedule" />{scheduleSelect}</div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Btn variant="ghost" onClick={() => setAddModal(null)}>cancel</Btn>
            <Btn variant="accent" onClick={handleAddSource} loading={saving}>Add URL Source</Btn>
          </div>
        </div>
      </Modal>

      {/* Add Google Drive modal */}
      <Modal open={addModal === 'gdrive'} onClose={() => setAddModal(null)} title="Add Google Drive Source" width={500}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Hint type="tip">
            Share your Google Doc/Sheet/Drive folder publicly ("Anyone with the link can view") then paste the share URL here.
            KRONOS will export and ingest the content automatically.
          </Hint>
          <div>
            <FieldLabel label="Google Drive Share URL" help="The 'share link' from Drive → Share → Copy link" />
            <input value={form.share_url || ''} onChange={e => setForm(f => ({ ...f, share_url: e.target.value }))}
              placeholder="https://docs.google.com/document/d/1abc.../edit?usp=sharing" style={inp} />
          </div>
          <div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>Supported types:</div>
            <div style={{ display: 'flex', gap: 8 }}>
              {['Google Docs → .txt', 'Google Sheets → .csv', 'Drive Folder → all docs inside'].map(t => (
                <div key={t} style={{ fontSize: 10, padding: '3px 8px', background: 'var(--bg-raised)', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text-muted)' }}>{t}</div>
              ))}
            </div>
          </div>
          <div><FieldLabel label="Auto-refresh schedule" />{scheduleSelect}</div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Btn variant="ghost" onClick={() => setAddModal(null)}>cancel</Btn>
            <Btn variant="accent" onClick={handleAddSource} loading={saving}>Add Drive Source</Btn>
          </div>
        </div>
      </Modal>
    </div>
  )
}

// ── Main RAG page ─────────────────────────────────────────────────────────────
export default function RAGPage() {
  const { collections, setCollections, models } = useStore()
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState(null)
  const [tab, setTab] = useState('ingest')   // ingest | sources | query | agent
  const [createModal, setCreateModal] = useState(false)
  const [ingesting, setIngesting] = useState(false)
  const [querying, setQuerying] = useState(false)
  const [deployingAgent, setDeployingAgent] = useState(false)
  const [urlInput, setUrlInput] = useState('')
  const [queryInput, setQueryInput] = useState('')
  const [queryResults, setQueryResults] = useState(null)
  const [form, setForm] = useState({ name: '', description: '', model: '', embed_model: 'nomic-embed-text' })

  const refresh = async () => {
    setLoading(true)
    try {
      const r = await getCollections()
      setCollections(r.data)
      if (selected) {
        const updated = (r.data || []).find(c => c.id === selected.id)
        if (updated) setSelected(updated)
      }
    } catch { toast.error('Failed to load collections') }
    finally { setLoading(false) }
  }

  useEffect(() => { refresh() }, [])

  const handleCreate = async () => {
    if (!form.name || !form.model) return toast.error('Name and model are required')
    try {
      await createCollection(form)
      toast.success('Collection created')
      setCreateModal(false)
      setForm({ name: '', description: '', model: '', embed_model: 'nomic-embed-text' })
      refresh()
    } catch (e) { toast.error(e.response?.data?.detail || 'Create failed') }
  }

  const handleDelete = async id => {
    if (!confirm('Delete this collection? This cannot be undone.')) return
    try {
      await deleteCollection(id)
      if (selected?.id === id) setSelected(null)
      refresh()
    } catch { toast.error('Delete failed') }
  }

  const onDrop = useCallback(async acceptedFiles => {
    if (!selected || !acceptedFiles[0]) return
    setIngesting(true)
    try {
      const r = await ingestFile(selected.id, acceptedFiles[0])
      toast.success(`Ingested ${r.data.ingested_chunks} chunks from ${acceptedFiles[0].name}`)
      refresh()
    } catch (e) { toast.error(e.response?.data?.detail || 'Ingest failed') }
    finally { setIngesting(false) }
  }, [selected])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'application/pdf': [], 'text/plain': [], 'text/markdown': [],
              'application/vnd.openxmlformats-officedocument.wordprocessingml.document': [] },
    multiple: false,
    disabled: !selected,
  })

  const handleURLIngest = async () => {
    if (!selected) return
    const urls = urlInput.split('\n').map(u => u.trim()).filter(Boolean)
    if (!urls.length) return
    setIngesting(true)
    try {
      const r = await ingestURLs(selected.id, urls)
      toast.success(`Ingested ${r.data.ingested_chunks} chunks from ${r.data.urls_processed} URLs`)
      setUrlInput('')
      refresh()
    } catch (e) { toast.error(e.response?.data?.detail || 'Failed') }
    finally { setIngesting(false) }
  }

  const handleQuery = async () => {
    if (!selected || !queryInput.trim()) return
    setQuerying(true)
    try {
      const r = await queryKB(selected.id, queryInput)
      setQueryResults(r.data)
    } catch { toast.error('Query failed') }
    finally { setQuerying(false) }
  }

  const handleDeployAgent = async () => {
    if (!selected) return
    setDeployingAgent(true)
    try {
      const r = await api.post(`/rag/collections/${selected.id}/deploy-agent`, {
        model: selected.model,
      })
      toast.success(`Agent queued! Go to Approvals → approve "${r.data.agent_name}" → Execute`)
      refresh()
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Deploy failed')
    } finally { setDeployingAgent(false) }
  }

  const chatModels = models.filter(m => !m.name.toLowerCase().includes('embed'))
  const embedModels = models.filter(m => m.name.toLowerCase().includes('embed') || m.name.toLowerCase().includes('nomic') || m.name.toLowerCase().includes('bge'))
  const embedOptions = embedModels.length > 0 ? embedModels : models

  const inp = { padding: '7px 10px', borderRadius: 'var(--radius)', border: '1px solid var(--border-mid)', background: 'var(--bg-raised)', color: 'var(--text-primary)', fontSize: 12, fontFamily: 'var(--font-mono)', width: '100%' }

  return (
    <div style={{ animation: 'fadeIn 0.2s ease' }}>
      <PageHelp
        steps={[
          'Create a collection — name it, pick chat model and embed model',
          'Use the Ingest tab to add files (PDF/DOCX) or URLs one-time',
          'Use the Sources tab to set up automatic folder watching, URL crawling, or Google Drive sync',
          'Test quality in the Query tab, then click Deploy Agent to create a specialist agent',
        ]}
        tips={[
          'Sources (folder/URLs/Drive) can be set to auto-refresh hourly/daily/weekly',
          'Deploy Agent creates an agent pre-configured for this collection — no manual setup needed',
          'One collection can have multiple sources (e.g. folder + URLs + Drive all feeding the same KB)',
          'Embed model must stay consistent for a collection — changing it requires re-ingesting everything',
        ]}
      />

      <PageHeader
        title="RAG / Knowledge Base"
        subtitle="Collections with automated sources — deploy agents directly"
        action={<Btn variant="accent" onClick={() => setCreateModal(true)}><Plus size={12} /> New Collection</Btn>}
      />

      <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr', gap: 16 }}>
        {/* Left: collection list */}
        <div>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 8 }}>
            Collections ({collections.length})
          </div>
          {loading && <Spinner />}
          {!loading && collections.length === 0 && (
            <Empty icon="🗄️" title="No collections" description="Create your first KB collection." />
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {collections.map(c => (
              <CollectionCard key={c.id} col={c} onDelete={handleDelete}
                onSelect={c => { setSelected(c); setTab('ingest'); setQueryResults(null) }}
                selected={selected?.id === c.id} />
            ))}
          </div>
        </div>

        {/* Right: detail panel */}
        <div>
          {!selected ? (
            <Empty icon="←" title="Select a collection" description="Pick a collection to ingest documents, configure sources, and deploy agents." />
          ) : (
            <div>
              {/* Header with stats */}
              <div style={{ padding: '14px 18px', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', marginBottom: 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                  <div>
                    <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 16 }}>{selected.name}</div>
                    {selected.description && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{selected.description}</div>}
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    {selected.agent_id ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 10px', background: 'rgba(61,214,140,0.08)', border: '1px solid rgba(61,214,140,0.25)', borderRadius: 'var(--radius)', fontSize: 11, color: 'var(--green)' }}>
                        🤖 Agent: {selected.agent_name || 'linked'} ({selected.agent_status})
                      </div>
                    ) : (
                      <Btn variant="accent" size="sm" onClick={handleDeployAgent} loading={deployingAgent}>
                        <Bot size={11} /> Deploy Agent
                      </Btn>
                    )}
                    <Btn variant="ghost" size="sm" onClick={refresh}><RefreshCw size={11} /></Btn>
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
                  {[
                    { label: 'Chunks', value: selected.doc_count, color: 'var(--accent)' },
                    { label: 'Chat Model', value: selected.model?.split(':')[0] },
                    { label: 'Embed', value: selected.embed_model?.split(':')[0] },
                    { label: 'Sources', value: (selected.sources || []).length },
                  ].map(s => (
                    <div key={s.label} style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 2 }}>{s.label}</div>
                      <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 16, color: s.color || 'var(--text-primary)' }}>{s.value}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Tabs */}
              <div style={{ display: 'flex', gap: 2, marginBottom: 14, background: 'var(--bg-raised)', borderRadius: 'var(--radius-lg)', padding: 3, width: 'fit-content', border: '1px solid var(--border)' }}>
                {[
                  { id: 'ingest',  label: '📥 Ingest' },
                  { id: 'sources', label: '🔄 Sources', badge: (selected.sources || []).length },
                  { id: 'query',   label: '🔍 Test Query' },
                ].map(t => (
                  <button key={t.id} onClick={() => setTab(t.id)} style={{
                    padding: '5px 14px', borderRadius: 'var(--radius)', fontSize: 11,
                    fontFamily: 'var(--font-mono)', cursor: 'pointer', border: 'none',
                    background: tab === t.id ? 'var(--bg-overlay)' : 'transparent',
                    color: tab === t.id ? 'var(--accent)' : 'var(--text-muted)',
                    transition: 'all 0.12s',
                  }}>
                    {t.label}{t.badge ? ` (${t.badge})` : ''}
                  </button>
                ))}
              </div>

              {/* Ingest tab */}
              {tab === 'ingest' && (
                <Card>
                  <CardHeader>File Upload (PDF · DOCX · TXT · MD)</CardHeader>
                  <div style={{ padding: '14px 16px' }}>
                    {ingesting ? (
                      <div style={{ textAlign: 'center', padding: 24 }}><Spinner /></div>
                    ) : (
                      <div {...getRootProps()} style={{
                        border: `2px dashed ${isDragActive ? 'var(--accent)' : 'var(--border-mid)'}`,
                        borderRadius: 'var(--radius-lg)', padding: '28px 20px', textAlign: 'center',
                        cursor: 'pointer', background: isDragActive ? 'var(--accent-subtle)' : 'var(--bg-raised)',
                        transition: 'all 0.15s',
                      }}>
                        <input {...getInputProps()} />
                        <Upload size={20} style={{ color: isDragActive ? 'var(--accent)' : 'var(--text-muted)', margin: '0 auto 8px' }} />
                        <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                          {isDragActive ? 'Drop to ingest' : 'Drop a file or click to browse'}
                        </div>
                        <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>PDF · DOCX · TXT · MD</div>
                      </div>
                    )}

                    <div style={{ marginTop: 16 }}>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>Or paste URLs (one per line):</div>
                      <textarea value={urlInput} onChange={e => setUrlInput(e.target.value)}
                        placeholder={"https://nmap.org/book/man.html\nhttps://owasp.org/"}
                        rows={3}
                        style={{ width: '100%', padding: '8px 10px', borderRadius: 'var(--radius)', border: '1px solid var(--border-mid)', background: 'var(--bg-raised)', color: 'var(--text-primary)', fontSize: 12, fontFamily: 'var(--font-mono)', resize: 'vertical', lineHeight: 1.5 }}
                      />
                      <Btn variant="accent" size="sm" onClick={handleURLIngest} loading={ingesting} style={{ marginTop: 6 }}>
                        <Globe size={11} /> Ingest URLs
                      </Btn>
                    </div>
                  </div>
                </Card>
              )}

              {/* Sources tab */}
              {tab === 'sources' && (
                <Card>
                  <CardHeader>
                    Automated Sources
                    <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2, fontWeight: 400 }}>
                      Sources feed this collection automatically on a schedule
                    </div>
                  </CardHeader>
                  <div style={{ padding: '14px 16px' }}>
                    <SourcesTab col={selected} onRefresh={refresh} />
                  </div>
                </Card>
              )}

              {/* Query tab */}
              {tab === 'query' && (
                <Card>
                  <CardHeader>Test Query</CardHeader>
                  <div style={{ padding: '14px 16px' }}>
                    <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                      <input value={queryInput} onChange={e => setQueryInput(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && handleQuery()}
                        placeholder="Ask a question about this collection…"
                        style={{ flex: 1, padding: '8px 12px', borderRadius: 'var(--radius)', border: '1px solid var(--border-mid)', background: 'var(--bg-raised)', color: 'var(--text-primary)', fontSize: 12, fontFamily: 'var(--font-mono)' }} />
                      <Btn variant="accent" onClick={handleQuery} loading={querying}><Search size={12} /></Btn>
                    </div>

                    {queryResults && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {queryResults.results.map((r, i) => (
                          <div key={i} style={{ background: 'var(--bg-raised)', borderRadius: 'var(--radius)', padding: '10px 12px', border: '1px solid var(--border)' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                              <span style={{ fontSize: 10, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '70%' }}>{r.source}</span>
                              <Badge color={r.relevance > 0.7 ? 'green' : r.relevance > 0.4 ? 'amber' : 'default'}>
                                {(r.relevance * 100).toFixed(0)}%
                              </Badge>
                            </div>
                            <div style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                              {r.text.slice(0, 280)}{r.text.length > 280 ? '…' : ''}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </Card>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Create collection modal */}
      <Modal open={createModal} onClose={() => setCreateModal(false)} title="New KB Collection" width={500}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {[
            { label: 'Name', key: 'name', placeholder: 'e.g. pentest_tools' },
            { label: 'Description', key: 'description', placeholder: 'What is this KB for?' },
          ].map(f => (
            <div key={f.key}>
              <FieldLabel label={f.label} />
              <input value={form[f.key] || ''} onChange={e => setForm(p => ({ ...p, [f.key]: e.target.value }))}
                placeholder={f.placeholder} style={inp} />
            </div>
          ))}

          <div>
            <FieldLabel label="Chat Model" help="LLM used when this KB is attached to an agent or chat. nomic-embed-text is an embed model — don't use it here." />
            {chatModels.length > 0 ? (
              <select value={form.model || ''} onChange={e => setForm(p => ({ ...p, model: e.target.value }))} style={inp}>
                <option value="">Select model…</option>
                {chatModels.map(m => <option key={m.name} value={m.name}>{m.name} ({m.size_gb} GB)</option>)}
              </select>
            ) : (
              <input value={form.model || ''} onChange={e => setForm(p => ({ ...p, model: e.target.value }))}
                placeholder="Visit Ollama tab to load models" style={inp} />
            )}
          </div>

          <div>
            <FieldLabel label="Embed Model" help="Converts text to vectors. nomic-embed-text is recommended and already pulled." />
            {embedOptions.length > 0 ? (
              <select value={form.embed_model || 'nomic-embed-text'} onChange={e => setForm(p => ({ ...p, embed_model: e.target.value }))} style={inp}>
                {embedOptions.map(m => <option key={m.name} value={m.name}>{m.name}</option>)}
                {chatModels.length > 0 && <option disabled>── chat models (not recommended) ──</option>}
                {chatModels.map(m => <option key={m.name} value={m.name}>{m.name}</option>)}
              </select>
            ) : (
              <input value={form.embed_model || 'nomic-embed-text'} onChange={e => setForm(p => ({ ...p, embed_model: e.target.value }))} style={inp} />
            )}
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
            <Btn variant="ghost" onClick={() => setCreateModal(false)}>cancel</Btn>
            <Btn variant="accent" onClick={handleCreate}>Create Collection</Btn>
          </div>
        </div>
      </Modal>
    </div>
  )
}
