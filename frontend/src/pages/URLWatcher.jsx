import React, { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { Globe, Plus, Play, RefreshCw, Trash2, Edit3, Clock, Search, ExternalLink, AlertCircle, CheckCircle, Loader } from 'lucide-react'
import { PageHeader } from '../components/layout/Layout'
import { Card, CardHeader, Btn, Badge, Modal, Spinner, Empty, SectionLabel } from '../components/ui'
import { PageHelp, Hint, FieldLabel } from '../components/help'
import { useStore } from '../hooks/useStore'
import api from '../api'

const STATUS_COLOR = { idle: 'default', running: 'blue', error: 'red', paused: 'amber' }
const STATUS_ICON  = {
  idle:    <CheckCircle size={12} style={{ color: 'var(--text-muted)' }} />,
  running: <Loader size={12} style={{ color: 'var(--blue)', animation: 'spin 1s linear infinite' }} />,
  error:   <AlertCircle size={12} style={{ color: 'var(--red)' }} />,
  paused:  <Clock size={12} style={{ color: 'var(--amber)' }} />,
}

const MODE_INFO = {
  single:    { label: 'Single page',  color: 'default', desc: 'Fetch exactly the URLs you provide. Fast, predictable.' },
  recursive: { label: 'Recursive',    color: 'amber',   desc: 'Follow links within the same domain up to N levels deep.' },
  sitemap:   { label: 'Sitemap',      color: 'blue',    desc: 'Parse sitemap.xml automatically and crawl all listed pages.' },
}

const SCHEDULE_LABELS = {
  manual:  '⚡ Manual only',
  hourly:  '⏰ Every hour',
  daily:   '📅 Every day',
  weekly:  '🗓️ Every week',
}

// ── Watcher card ──────────────────────────────────────────────────────────────
function WatcherCard({ watcher, onRun, onEdit, onDelete, onResetHashes, running }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div style={{
      background: 'var(--bg-surface)',
      border: `1px solid ${watcher.status === 'error' ? 'rgba(242,107,107,0.3)' : 'var(--border)'}`,
      borderRadius: 'var(--radius-lg)',
      overflow: 'hidden',
      transition: 'border-color 0.15s',
    }}>
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px' }}>
        <div style={{ flexShrink: 0 }}>{STATUS_ICON[watcher.status] || STATUS_ICON.idle}</div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 13 }}>{watcher.name}</span>
            <Badge color={MODE_INFO[watcher.mode]?.color || 'default'}>{MODE_INFO[watcher.mode]?.label || watcher.mode}</Badge>
            <Badge color={STATUS_COLOR[watcher.status] || 'default'}>{watcher.status}</Badge>
            <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{SCHEDULE_LABELS[watcher.schedule] || watcher.schedule}</span>
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
            KB: <span style={{ color: 'var(--accent)' }}>{watcher.kb_name}</span>
            {' · '}{watcher.urls?.length} URL{watcher.urls?.length !== 1 ? 's' : ''}
            {watcher.last_run_at && ` · last run: ${new Date(watcher.last_run_at).toLocaleString()}`}
            {watcher.last_run_pages > 0 && ` · ${watcher.last_run_pages} pages / ${watcher.last_run_chunks} chunks`}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
          <Btn size="sm" variant="ghost" onClick={() => setExpanded(e => !e)}>
            {expanded ? '▲' : '▼'}
          </Btn>
          <Btn size="sm" variant="ghost" onClick={() => onEdit(watcher)}><Edit3 size={11} /></Btn>
          <Btn size="sm" variant="success" onClick={() => onRun(watcher.id)} loading={running === watcher.id} disabled={watcher.status === 'running'}>
            <Play size={11} /> Run
          </Btn>
          <Btn size="sm" variant="ghost" onClick={() => onDelete(watcher.id)}>
            <Trash2 size={11} style={{ color: 'var(--red)' }} />
          </Btn>
        </div>
      </div>

      {/* Expanded details */}
      {expanded && (
        <div style={{ borderTop: '1px solid var(--border)', padding: '12px 16px', background: 'var(--bg-raised)', animation: 'fadeIn 0.15s ease' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 12 }}>
            {[
              { label: 'Total pages crawled', value: watcher.total_pages_crawled },
              { label: 'Max pages / run',     value: watcher.max_pages },
              { label: 'Max depth',            value: watcher.mode === 'recursive' ? watcher.max_depth : 'N/A' },
            ].map(s => (
              <div key={s.label}>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 2 }}>{s.label}</div>
                <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 18 }}>{s.value}</div>
              </div>
            ))}
          </div>

          <SectionLabel>Seed URLs</SectionLabel>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 12 }}>
            {watcher.urls?.map(url => (
              <div key={url} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>
                <Globe size={10} style={{ color: 'var(--accent)', flexShrink: 0 }} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{url}</span>
                <a href={url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--text-muted)', flexShrink: 0 }}>
                  <ExternalLink size={9} />
                </a>
              </div>
            ))}
          </div>

          {(watcher.include_pattern || watcher.exclude_pattern) && (
            <div style={{ marginBottom: 12, fontSize: 11, fontFamily: 'var(--font-mono)' }}>
              {watcher.include_pattern && <div style={{ color: 'var(--green)' }}>include: {watcher.include_pattern}</div>}
              {watcher.exclude_pattern && <div style={{ color: 'var(--red)' }}>exclude: {watcher.exclude_pattern}</div>}
            </div>
          )}

          {watcher.last_error && (
            <div style={{ padding: '6px 10px', background: 'var(--red-dim)', border: '1px solid rgba(242,107,107,0.3)', borderRadius: 'var(--radius)', fontSize: 11, color: 'var(--red)' }}>
              Last error: {watcher.last_error}
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <Btn size="sm" variant="ghost" onClick={() => onResetHashes(watcher.id)}>
              <RefreshCw size={10} /> Reset change detection
            </Btn>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Create / Edit modal ───────────────────────────────────────────────────────
function WatcherModal({ open, onClose, onSave, initial, collections }) {
  const empty = { name: '', kb_collection_id: '', urls: '', mode: 'single', max_depth: 1, max_pages: 20, include_pattern: '', exclude_pattern: '', schedule: 'manual' }
  const [form, setForm] = useState(empty)
  const [saving, setSaving] = useState(false)
  const [sitemapPreview, setSitemapPreview] = useState(null)
  const [previewing, setPreviewing] = useState(false)

  useEffect(() => {
    if (open) {
      setForm(initial
        ? { ...initial, urls: (initial.urls || []).join('\n') }
        : empty
      )
      setSitemapPreview(null)
    }
  }, [open, initial])

  const handleSave = async () => {
    const urlList = form.urls.split('\n').map(u => u.trim()).filter(Boolean)
    if (!form.name || !form.kb_collection_id || urlList.length === 0) {
      return toast.error('Name, KB collection, and at least one URL are required')
    }
    setSaving(true)
    try {
      await onSave({ ...form, urls: urlList, max_depth: parseInt(form.max_depth), max_pages: parseInt(form.max_pages) })
      onClose()
    } finally { setSaving(false) }
  }

  const inp = {
    padding: '7px 10px', borderRadius: 'var(--radius)', border: '1px solid var(--border-mid)',
    background: 'var(--bg-raised)', color: 'var(--text-primary)', fontSize: 12, fontFamily: 'var(--font-mono)', width: '100%',
  }

  return (
    <Modal open={open} onClose={onClose} title={initial ? `Edit: ${initial.name}` : 'New URL Watcher'} width={540}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div>
            <FieldLabel label="Watcher Name" help="A descriptive name — e.g. 'nmap docs' or 'company blog'" />
            <input value={form.name} onChange={e => setForm(p => ({...p, name: e.target.value}))}
              placeholder="e.g. owasp_docs" style={inp} />
          </div>
          <div>
            <FieldLabel label="Target KB Collection" help="Where crawled content will be stored and embedded" />
            <select value={form.kb_collection_id} onChange={e => setForm(p => ({...p, kb_collection_id: e.target.value}))} style={inp}>
              <option value="">Select collection…</option>
              {collections.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        </div>

        <div>
          <FieldLabel label="Seed URLs (one per line)" help="Starting URLs. Recursive mode follows links from here. Sitemap mode looks for sitemap.xml on these domains." />
          <textarea value={form.urls} onChange={e => setForm(p => ({...p, urls: e.target.value}))}
            placeholder={"https://nmap.org/book/man.html\nhttps://owasp.org/Top10/"}
            rows={3}
            style={{ ...inp, resize: 'vertical', lineHeight: 1.6 }}
          />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div>
            <FieldLabel label="Crawl Mode" help="single: only the given URLs. recursive: follow links. sitemap: parse sitemap.xml" />
            <select value={form.mode} onChange={e => setForm(p => ({...p, mode: e.target.value}))} style={inp}>
              <option value="single">Single page</option>
              <option value="recursive">Recursive (follow links)</option>
              <option value="sitemap">Sitemap discovery</option>
            </select>
            {form.mode !== 'single' && (
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 3 }}>{MODE_INFO[form.mode]?.desc}</div>
            )}
          </div>
          <div>
            <FieldLabel label="Schedule" help="How often to automatically re-crawl. Manual = only when you click Run." />
            <select value={form.schedule} onChange={e => setForm(p => ({...p, schedule: e.target.value}))} style={inp}>
              <option value="manual">Manual only</option>
              <option value="hourly">Hourly</option>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
            </select>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div>
            <FieldLabel label="Max Pages per Run" help="Upper limit on pages crawled per run. Prevents runaway crawls. Max: 100" />
            <input type="number" min="1" max="100" value={form.max_pages}
              onChange={e => setForm(p => ({...p, max_pages: e.target.value}))} style={{ ...inp, width: 80 }} />
          </div>
          {form.mode === 'recursive' && (
            <div>
              <FieldLabel label="Max Recursion Depth" help="0 = only seed URLs. 1 = seed + direct links. 2 = seed + links + their links." />
              <input type="number" min="0" max="5" value={form.max_depth}
                onChange={e => setForm(p => ({...p, max_depth: e.target.value}))} style={{ ...inp, width: 60 }} />
            </div>
          )}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div>
            <FieldLabel label="Include pattern (regex)" help="Only crawl URLs matching this regex. Leave empty to include all." />
            <input value={form.include_pattern} onChange={e => setForm(p => ({...p, include_pattern: e.target.value}))}
              placeholder="e.g. /docs/" style={inp} />
          </div>
          <div>
            <FieldLabel label="Exclude pattern (regex)" help="Skip URLs matching this regex. Useful to skip /login, /admin, etc." />
            <input value={form.exclude_pattern} onChange={e => setForm(p => ({...p, exclude_pattern: e.target.value}))}
              placeholder="e.g. /(login|signup|admin)" style={inp} />
          </div>
        </div>

        {form.mode === 'sitemap' && form.urls && (
          <div>
            <Btn size="sm" variant="ghost" loading={previewing} onClick={async () => {
              // Can only preview if watcher already exists
              if (initial?.id) {
                setPreviewing(true)
                try {
                  const r = await api.get(`/watchers/${initial.id}/preview-sitemap`)
                  setSitemapPreview(r.data)
                } catch { toast.error('Preview failed') }
                finally { setPreviewing(false) }
              } else {
                toast('Save first, then preview sitemap')
              }
            }}>
              <Search size={11} /> Preview sitemap URLs
            </Btn>
            {sitemapPreview && (
              <div style={{ marginTop: 8, padding: '8px 10px', background: 'var(--bg-raised)', borderRadius: 'var(--radius)', border: '1px solid var(--border)', fontSize: 11 }}>
                <div>Found <strong style={{ color: 'var(--accent)' }}>{sitemapPreview.after_filter}</strong> URLs (of {sitemapPreview.total_found} total)</div>
                <div style={{ color: 'var(--text-muted)', marginTop: 2 }}>Will crawl: {sitemapPreview.will_crawl}</div>
                {sitemapPreview.sample?.slice(0, 5).map((u, i) => (
                  <div key={i} style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-secondary)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u}</div>
                ))}
              </div>
            )}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
          <Btn variant="ghost" onClick={onClose}>cancel</Btn>
          <Btn variant="accent" onClick={handleSave} loading={saving}>
            {initial ? 'Save changes' : 'Create watcher'}
          </Btn>
        </div>
      </div>
    </Modal>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function URLWatcherPage() {
  const { collections } = useStore()
  const [watchers, setWatchers] = useState([])
  const [loading, setLoading] = useState(true)
  const [createModal, setCreateModal] = useState(false)
  const [editModal, setEditModal] = useState(null)
  const [runningId, setRunningId] = useState(null)

  const refresh = async () => {
    try {
      const r = await api.get('/watchers/')
      setWatchers(r.data || [])
    } catch { toast.error('Failed to load watchers') }
    finally { setLoading(false) }
  }

  useEffect(() => {
    refresh()
    // Poll every 8s to update running status
    const t = setInterval(refresh, 8000)
    return () => clearInterval(t)
  }, [])

  const handleCreate = async (form) => {
    try {
      await api.post('/watchers/', form)
      toast.success(`Watcher "${form.name}" created`)
      refresh()
    } catch (e) { toast.error(e.response?.data?.detail || 'Create failed'); throw e }
  }

  const handleEdit = async (form) => {
    try {
      const { urls, ...rest } = form
      await api.patch(`/watchers/${editModal.id}`, { ...rest, urls })
      toast.success('Watcher updated')
      setEditModal(null)
      refresh()
    } catch (e) { toast.error(e.response?.data?.detail || 'Update failed'); throw e }
  }

  const handleRun = async (id) => {
    setRunningId(id)
    try {
      const r = await api.post(`/watchers/${id}/run`)
      toast.success(`Crawl started: ${r.data.mode} mode, up to ${r.data.max_pages} pages`)
      setTimeout(refresh, 1000)
    } catch (e) { toast.error(e.response?.data?.detail || 'Run failed') }
    finally { setRunningId(null) }
  }

  const handleDelete = async (id) => {
    if (!confirm('Delete this watcher? Existing KB content is not removed.')) return
    await api.delete(`/watchers/${id}`)
    toast.success('Deleted')
    refresh()
  }

  const handleResetHashes = async (id) => {
    await api.post(`/watchers/${id}/reset-hashes`)
    toast.success('Change detection reset — next run will re-ingest all pages')
  }

  const scheduled = watchers.filter(w => w.schedule !== 'manual').length
  const running   = watchers.filter(w => w.status === 'running').length

  return (
    <div style={{ animation: 'fadeIn 0.2s ease' }}>
      <PageHelp
        steps={[
          'Create a watcher: give it seed URLs and pick a KB collection to store content',
          'Choose mode: Single (exact URLs), Recursive (follow links), or Sitemap (auto-discover)',
          'Set a schedule (manual / hourly / daily / weekly) for automatic re-crawls',
          'Click Run to trigger immediately — watch status change to "running"',
          'Content appears in your KB collection — query it in Chat Test or via agents',
        ]}
        tips={[
          'Sitemap mode is best for documentation sites — it finds all pages automatically',
          'Recursive depth 1 = seed URL + its direct links. Good for wiki-style sites',
          'Use include/exclude patterns to stay on-topic (e.g. only /docs/ paths)',
          'Change detection skips pages with identical content — very efficient for daily runs',
          '"Reset change detection" forces a full re-ingest on the next run',
        ]}
      />

      <PageHeader
        title="URL Watchers"
        subtitle="Scheduled web crawling — keeps KB collections fresh automatically"
        action={
          <div style={{ display: 'flex', gap: 8 }}>
            <Btn variant="ghost" onClick={refresh} loading={loading}><RefreshCw size={12} /></Btn>
            <Btn variant="accent" onClick={() => setCreateModal(true)}>
              <Plus size={12} /> New Watcher
            </Btn>
          </div>
        }
      />

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 20 }}>
        {[
          { label: 'Watchers',  value: watchers.length },
          { label: 'Running',   value: running,   color: 'var(--blue)' },
          { label: 'Scheduled', value: scheduled, color: 'var(--green)' },
          { label: 'Total pages crawled', value: watchers.reduce((s, w) => s + (w.total_pages_crawled || 0), 0) },
        ].map(s => (
          <div key={s.label} style={{ padding: '12px 16px', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)' }}>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 4 }}>{s.label}</div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 700, color: s.color || 'var(--text-primary)' }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Explanation */}
      <Hint type="info" dismissible>
        <strong>How it works:</strong> Each watcher fetches URLs, strips HTML to clean text, splits into chunks, embeds them via Ollama, and stores in your KB collection.
        Scheduled watchers run automatically in the background. Change detection skips pages whose content hasn't changed since the last crawl.
      </Hint>

      <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {loading && <Spinner />}
        {!loading && watchers.length === 0 && (
          <Empty icon="🌐" title="No URL watchers" description="Create one to start automatically pulling web content into your KB collections." />
        )}
        {watchers.map(w => (
          <WatcherCard
            key={w.id}
            watcher={w}
            onRun={handleRun}
            onEdit={w => setEditModal(w)}
            onDelete={handleDelete}
            onResetHashes={handleResetHashes}
            running={runningId}
          />
        ))}
      </div>

      <WatcherModal
        open={createModal}
        onClose={() => setCreateModal(false)}
        onSave={handleCreate}
        initial={null}
        collections={collections}
      />

      <WatcherModal
        open={!!editModal}
        onClose={() => setEditModal(null)}
        onSave={handleEdit}
        initial={editModal}
        collections={collections}
      />
    </div>
  )
}
