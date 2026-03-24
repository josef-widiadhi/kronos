import React, { useEffect, useState, useCallback } from 'react'
import { useDropzone } from 'react-dropzone'
import toast from 'react-hot-toast'
import { Database, Plus, Upload, Link, Search, Trash2, Globe, FolderSearch } from 'lucide-react'
import { PageHeader } from '../components/layout/Layout'
import { PageHelp, FieldLabel, Hint } from '../components/help'
import { Card, CardHeader, Btn, Badge, Input, Textarea, Modal, Spinner, Empty, SectionLabel } from '../components/ui'
import { getCollections, createCollection, deleteCollection, ingestFile, ingestURLs, queryKB } from '../api'
import { useStore } from '../hooks/useStore'
import api from '../api'

function CollectionCard({ col, onDelete, onSelect, selected }) {
  return (
    <div
      onClick={() => onSelect(col)}
      style={{
        padding: '14px 16px',
        background: selected ? 'var(--accent-subtle)' : 'var(--bg-raised)',
        border: `1px solid ${selected ? 'rgba(245,166,35,0.4)' : 'var(--border)'}`,
        borderRadius: 'var(--radius-lg)',
        cursor: 'pointer',
        transition: 'all 0.12s',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 13 }}>{col.name}</span>
        <button onClick={e => { e.stopPropagation(); onDelete(col.id) }}
          style={{ color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer', padding: 2 }}
          onMouseEnter={e => e.currentTarget.style.color = 'var(--red)'}
          onMouseLeave={e => e.currentTarget.style.color = 'var(--text-muted)'}
        >
          <Trash2 size={12} />
        </button>
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8 }}>{col.description || 'No description'}</div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <Badge color="amber">{col.model}</Badge>
        <Badge color="blue">{col.doc_count} chunks</Badge>
        <Badge color="default">{col.embed_model}</Badge>
      </div>
    </div>
  )
}

function DropZone({ onFile }) {
  const onDrop = useCallback(acceptedFiles => {
    if (acceptedFiles.length) onFile(acceptedFiles[0])
  }, [onFile])
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'application/pdf': [], 'text/plain': [], 'text/markdown': [],
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': [] },
    multiple: false,
  })
  return (
    <div {...getRootProps()} style={{
      border: `2px dashed ${isDragActive ? 'var(--accent)' : 'var(--border-mid)'}`,
      borderRadius: 'var(--radius-lg)', padding: '32px 24px', textAlign: 'center',
      cursor: 'pointer', background: isDragActive ? 'var(--accent-subtle)' : 'var(--bg-raised)',
      transition: 'all 0.15s',
    }}>
      <input {...getInputProps()} />
      <Upload size={20} style={{ color: isDragActive ? 'var(--accent)' : 'var(--text-muted)', margin: '0 auto 10px' }} />
      <div style={{ fontSize: 12, color: isDragActive ? 'var(--accent)' : 'var(--text-secondary)' }}>
        {isDragActive ? 'Drop to ingest' : 'Drop file or click to browse'}
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>PDF · TXT · MD · DOCX</div>
    </div>
  )
}

// Model selector dropdown with grouped display
function ModelSelect({ value, onChange, models, label }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      {label && <label style={{ fontSize: 11, color: 'var(--text-muted)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>{label}</label>}
      <select
        value={value}
        onChange={onChange}
        style={{
          padding: '7px 10px', width: '100%',
          borderRadius: 'var(--radius)', border: '1px solid var(--border-mid)',
          background: 'var(--bg-raised)', color: 'var(--text-primary)',
          fontSize: 12, fontFamily: 'var(--font-mono)',
        }}
      >
        <option value="">Select model…</option>
        {models.map(m => (
          <option key={m.name} value={m.name}>
            {m.name} ({m.size_gb}GB)
          </option>
        ))}
        <option disabled>─────────────</option>
        <option value="__manual__">Enter manually…</option>
      </select>
      {value === '__manual__' && (
        <input
          placeholder="e.g. qwen2.5:7b-instruct"
          onChange={e => onChange({ target: { value: e.target.value } })}
          style={{
            padding: '7px 10px', borderRadius: 'var(--radius)',
            border: '1px solid var(--accent)', background: 'var(--bg-raised)',
            color: 'var(--accent)', fontSize: 12, fontFamily: 'var(--font-mono)', marginTop: 4,
          }}
        />
      )}
    </div>
  )
}

export default function RAGPage() {
  const { collections, setCollections, models } = useStore()
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState(null)
  const [createModal, setCreateModal] = useState(false)
  const [ingestModal, setIngestModal] = useState(false)
  const [queryModal, setQueryModal] = useState(false)
  const [scanModal, setScanModal] = useState(false)
  const [ingesting, setIngesting] = useState(false)
  const [querying, setQuerying] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [urlInput, setUrlInput] = useState('')
  const [queryInput, setQueryInput] = useState('')
  const [queryResults, setQueryResults] = useState(null)
  const [scanResult, setScanResult] = useState(null)
  const [form, setForm] = useState({ name: '', description: '', model: '', embed_model: 'nomic-embed-text' })

  const refresh = async () => {
    setLoading(true)
    try {
      const r = await getCollections()
      setCollections(r.data)
    } catch { toast.error('Failed to load collections') }
    setLoading(false)
  }

  useEffect(() => { refresh() }, [])

  const handleCreate = async () => {
    if (!form.name || !form.model || form.model === '__manual__') return toast.error('Name and model are required')
    try {
      await createCollection(form)
      toast.success('Collection created')
      setCreateModal(false)
      setForm({ name: '', description: '', model: '', embed_model: 'nomic-embed-text' })
      refresh()
    } catch (e) { toast.error(e.response?.data?.detail || 'Create failed') }
  }

  const handleDelete = async id => {
    if (!confirm('Delete this KB collection?')) return
    try {
      await deleteCollection(id)
      toast.success('Deleted')
      if (selected?.id === id) setSelected(null)
      refresh()
    } catch { toast.error('Delete failed') }
  }

  const handleFileIngest = async file => {
    if (!selected) return toast.error('Select a collection first')
    setIngesting(true)
    try {
      const r = await ingestFile(selected.id, file)
      toast.success(`Ingested ${r.data.ingested_chunks} chunks from ${file.name}`)
      setIngestModal(false)
      refresh()
    } catch (e) { toast.error(e.response?.data?.detail || 'Ingest failed') }
    finally { setIngesting(false) }
  }

  const handleURLIngest = async () => {
    if (!selected) return toast.error('Select a collection first')
    const urls = urlInput.split('\n').map(u => u.trim()).filter(Boolean)
    if (!urls.length) return
    setIngesting(true)
    try {
      const r = await ingestURLs(selected.id, urls)
      toast.success(`Ingested ${r.data.ingested_chunks} chunks from ${r.data.urls_processed} URLs`)
      if (r.data.errors?.length) toast.error(`${r.data.errors.length} URLs failed`)
      setUrlInput('')
      setIngestModal(false)
      refresh()
    } catch (e) { toast.error(e.response?.data?.detail || 'URL ingest failed') }
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

  const handleFolderScan = async () => {
    if (!selected) return toast.error('Select a collection first')
    setScanning(true)
    setScanResult(null)
    try {
      const r = await api.post(`/workers/folder-scan?kb_collection_id=${selected.id}`)
      setScanResult(r.data)
      toast.success(`Scanned: ${r.data.chunks_ingested} chunks from ${r.data.files_processed} files`)
      refresh()
    } catch (e) { toast.error(e.response?.data?.detail || 'Scan failed') }
    finally { setScanning(false) }
  }

  return (
    <div style={{ animation: 'fadeIn 0.2s ease' }}>
      <PageHelp
        steps={[
          'Create a collection — give it a name, pick a chat model and embed model',
          'Ingest documents — upload files (PDF/DOCX/TXT) or paste URLs',
          'Test your KB with "Test Query" to verify relevance before using',
          'Assign the collection to an agent in the Agents tab',
        ]}
        tips={[
          'Embed model (nomic-embed-text) converts text to vectors — keep it consistent per collection',
          'Chat model is what the agent uses to answer — pick based on task',
          'More ingested chunks = better coverage, but watch for noise',
          'Relevance scores above 70% mean good chunk matching',
        ]}
      />
      <PageHeader
        title="RAG / Knowledge Base"
        subtitle="Build and manage vector knowledge stores"
        action={
          <Btn variant="accent" onClick={() => setCreateModal(true)}>
            <Plus size={12} /> New Collection
          </Btn>
        }
      />

      <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: 16 }}>
        {/* Collections list */}
        <div>
          <SectionLabel>Collections ({collections.length})</SectionLabel>
          {loading && <Spinner />}
          {!loading && collections.length === 0 && (
            <Empty icon="🗄️" title="No collections" description="Create your first KB collection." />
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {collections.map(c => (
              <CollectionCard key={c.id} col={c} onDelete={handleDelete}
                onSelect={setSelected} selected={selected?.id === c.id} />
            ))}
          </div>
        </div>

        {/* Right panel */}
        <div>
          {!selected ? (
            <Empty icon="←" title="Select a collection" description="Choose a collection on the left to ingest documents or run queries." />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <Card>
                <CardHeader action={
                  <div style={{ display: 'flex', gap: 8 }}>
                    <Btn size="sm" onClick={() => setIngestModal(true)}>
                      <Upload size={11} /> Ingest
                    </Btn>
                    <Btn size="sm" variant="ghost" onClick={() => setScanModal(true)}>
                      <FolderSearch size={11} /> Scan Folder
                    </Btn>
                    <Btn size="sm" variant="ghost" onClick={() => setQueryModal(true)}>
                      <Search size={11} /> Test Query
                    </Btn>
                  </div>
                }>{selected.name}</CardHeader>
                <div style={{ padding: '14px 18px', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
                  <div>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)', letterSpacing: '0.06em', marginBottom: 4 }}>MODEL</div>
                    <div style={{ fontSize: 12, color: 'var(--accent)', fontFamily: 'var(--font-mono)' }}>{selected.model}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)', letterSpacing: '0.06em', marginBottom: 4 }}>EMBED MODEL</div>
                    <div style={{ fontSize: 12, fontFamily: 'var(--font-mono)' }}>{selected.embed_model}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)', letterSpacing: '0.06em', marginBottom: 4 }}>CHUNKS</div>
                    <div style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 700 }}>{selected.doc_count}</div>
                  </div>
                </div>
              </Card>

              <Card>
                <CardHeader>ChromaDB Collection</CardHeader>
                <div style={{ padding: '14px 18px', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-secondary)' }}>
                  <div>collection_name: <span style={{ color: 'var(--accent)' }}>{selected.chroma_collection}</span></div>
                  <div style={{ marginTop: 6 }}>created: <span style={{ color: 'var(--text-primary)' }}>{new Date(selected.created_at).toLocaleString()}</span></div>
                </div>
              </Card>
            </div>
          )}
        </div>
      </div>

      {/* Create modal — model as dropdown */}
      <Modal open={createModal} onClose={() => setCreateModal(false)} title="New KB Collection">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <label style={{ fontSize: 11, color: 'var(--text-muted)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>Name</label>
            <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
              placeholder="e.g. product_docs"
              style={{ padding: '7px 10px', borderRadius: 'var(--radius)', border: '1px solid var(--border-mid)', background: 'var(--bg-raised)', color: 'var(--text-primary)', fontSize: 12, fontFamily: 'var(--font-mono)' }} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <label style={{ fontSize: 11, color: 'var(--text-muted)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>Description</label>
            <input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })}
              placeholder="What is this KB for?"
              style={{ padding: '7px 10px', borderRadius: 'var(--radius)', border: '1px solid var(--border-mid)', background: 'var(--bg-raised)', color: 'var(--text-primary)', fontSize: 12, fontFamily: 'var(--font-mono)' }} />
          </div>

          {/* Model dropdown from pulled models */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <label style={{ fontSize: 11, color: 'var(--text-muted)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>Ollama Model</label>
            {models.length > 0 ? (
              <select
                value={form.model}
                onChange={e => setForm({ ...form, model: e.target.value })}
                style={{ padding: '7px 10px', borderRadius: 'var(--radius)', border: '1px solid var(--border-mid)', background: 'var(--bg-raised)', color: 'var(--text-primary)', fontSize: 12, fontFamily: 'var(--font-mono)' }}
              >
                <option value="">Select a pulled model…</option>
                {models.map(m => (
                  <option key={m.name} value={m.name}>{m.name} ({m.size_gb} GB)</option>
                ))}
              </select>
            ) : (
              <input value={form.model} onChange={e => setForm({ ...form, model: e.target.value })}
                placeholder="e.g. llama3.2 (load models first in Ollama tab)"
                style={{ padding: '7px 10px', borderRadius: 'var(--radius)', border: '1px solid var(--border-mid)', background: 'var(--bg-raised)', color: 'var(--text-primary)', fontSize: 12, fontFamily: 'var(--font-mono)' }} />
            )}
            {models.length === 0 && (
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Go to Ollama tab to see available models</div>
            )}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <label style={{ fontSize: 11, color: 'var(--text-muted)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>Embed Model</label>
            {models.length > 0 ? (
              <select value={form.embed_model} onChange={e => setForm({ ...form, embed_model: e.target.value })}
                style={{ padding: '7px 10px', borderRadius: 'var(--radius)', border: '1px solid var(--border-mid)', background: 'var(--bg-raised)', color: 'var(--text-primary)', fontSize: 12, fontFamily: 'var(--font-mono)' }}>
                {models.filter(m => m.name.toLowerCase().includes('embed') || m.name.toLowerCase().includes('nomic') || m.name.toLowerCase().includes('bge')).map(m => (
                  <option key={m.name} value={m.name}>{m.name}</option>
                ))}
                {models.filter(m => !m.name.toLowerCase().includes('embed') && !m.name.toLowerCase().includes('nomic') && !m.name.toLowerCase().includes('bge')).map(m => (
                  <option key={m.name} value={m.name}>{m.name} (chat model)</option>
                ))}
              </select>
            ) : (
              <input value={form.embed_model} onChange={e => setForm({ ...form, embed_model: e.target.value })}
                style={{ padding: '7px 10px', borderRadius: 'var(--radius)', border: '1px solid var(--border-mid)', background: 'var(--bg-raised)', color: 'var(--text-primary)', fontSize: 12, fontFamily: 'var(--font-mono)' }} />
            )}
            <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
              Converts text to vectors. Use nomic-embed-text (already pulled). Embed models appear first.
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
            <Btn variant="ghost" onClick={() => setCreateModal(false)}>cancel</Btn>
            <Btn variant="accent" onClick={handleCreate}>Create</Btn>
          </div>
        </div>
      </Modal>

      {/* Ingest modal */}
      <Modal open={ingestModal} onClose={() => setIngestModal(false)} title={`Ingest → ${selected?.name}`} width={520}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <SectionLabel>File Upload (PDF · TXT · MD · DOCX)</SectionLabel>
            {ingesting ? <div style={{ textAlign: 'center', padding: 24 }}><Spinner /></div> : <DropZone onFile={handleFileIngest} />}
          </div>
          <div>
            <SectionLabel>URLs (one per line)</SectionLabel>
            <textarea value={urlInput} onChange={e => setUrlInput(e.target.value)}
              placeholder={"https://docs.example.com/page1\nhttps://docs.example.com/page2"}
              style={{ padding: '8px 10px', width: '100%', minHeight: 80, borderRadius: 'var(--radius)', border: '1px solid var(--border-mid)', background: 'var(--bg-raised)', color: 'var(--text-primary)', fontSize: 12, fontFamily: 'var(--font-mono)', resize: 'vertical', lineHeight: 1.6 }}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
              <Btn variant="accent" onClick={handleURLIngest} loading={ingesting}>
                <Globe size={11} /> Ingest URLs
              </Btn>
            </div>
          </div>
        </div>
      </Modal>

      {/* Folder scan modal */}
      <Modal open={scanModal} onClose={() => setScanModal(false)} title={`Scan Watch Folder → ${selected?.name}`} width={480}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ padding: '8px 12px', background: 'var(--accent-subtle)', border: '1px solid rgba(245,166,35,0.2)', borderRadius: 'var(--radius)', fontSize: 11, color: 'var(--accent)' }}>
            Scans the /watch_folder directory mounted from your host. Set KRONOS_WATCH_FOLDER in docker/.env to point to your local folder.
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
            Supported: .txt · .md · .csv (PDF/DOCX use file upload above)
          </div>
          {scanResult && (
            <div style={{ background: 'var(--bg-raised)', borderRadius: 'var(--radius)', padding: '10px 12px', border: '1px solid var(--border)', fontSize: 11, fontFamily: 'var(--font-mono)' }}>
              <div>Files found: <span style={{ color: 'var(--text-primary)' }}>{scanResult.files_found}</span></div>
              <div>Files processed: <span style={{ color: 'var(--green)' }}>{scanResult.files_processed}</span></div>
              <div>Chunks ingested: <span style={{ color: 'var(--accent)' }}>{scanResult.chunks_ingested}</span></div>
              {scanResult.errors?.length > 0 && <div style={{ color: 'var(--red)', marginTop: 4 }}>Errors: {scanResult.errors.length}</div>}
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Btn variant="ghost" onClick={() => setScanModal(false)}>close</Btn>
            <Btn variant="accent" onClick={handleFolderScan} loading={scanning}>
              <FolderSearch size={11} /> Scan Now
            </Btn>
          </div>
        </div>
      </Modal>

      {/* Query modal */}
      <Modal open={queryModal} onClose={() => setQueryModal(false)} title={`Test Query → ${selected?.name}`} width={600}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <input value={queryInput} onChange={e => setQueryInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleQuery()}
              placeholder="Enter a test query…"
              style={{ flex: 1, padding: '8px 12px', borderRadius: 'var(--radius)', border: '1px solid var(--border-mid)', background: 'var(--bg-raised)', color: 'var(--text-primary)', fontSize: 12, fontFamily: 'var(--font-mono)' }}
            />
            <Btn variant="accent" onClick={handleQuery} loading={querying}><Search size={12} /></Btn>
          </div>
          {queryResults && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 360, overflow: 'auto' }}>
              {queryResults.results.map((r, i) => (
                <div key={i} style={{ background: 'var(--bg-raised)', borderRadius: 'var(--radius)', padding: '10px 12px', border: '1px solid var(--border)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                    <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{r.source}</span>
                    <Badge color={r.relevance > 0.7 ? 'green' : r.relevance > 0.4 ? 'amber' : 'default'}>
                      {(r.relevance * 100).toFixed(0)}%
                    </Badge>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.6 }}>{r.text.slice(0, 300)}{r.text.length > 300 ? '…' : ''}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </Modal>
    </div>
  )
}
