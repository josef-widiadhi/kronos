import React, { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { Cpu, Plus, Play, Square, Trash2, Edit3, FileText, RefreshCw, ChevronDown, Zap } from 'lucide-react'
import { PageHeader } from '../components/layout/Layout'
import { PageHelp } from '../components/help'
import { Card, CardHeader, Badge, Btn, Input, Select, Textarea, Modal, Spinner, Empty, StatusDot, SectionLabel } from '../components/ui'
import { getAgents, createAgent, updateAgent, deleteAgent, deployAgent, stopAgent, agentLogs } from '../api'
import api from '../api'
import { useStore } from '../hooks/useStore'

const AGENT_TYPES = ['url_crawler', 'db_learner', 'folder_watcher', 'rag_validator', 'custom']
const STATUS_COLOR = { running: 'green', staged: 'default', deploying: 'amber', stopped: 'default', error: 'red' }
const TYPE_COLOR   = { url_crawler: 'blue', db_learner: 'purple', folder_watcher: 'amber', rag_validator: 'green', custom: 'default' }

const DEFAULT_PROMPTS = {
  url_crawler:    'You are a web knowledge specialist. Answer using your knowledge base. Cite source URLs.',
  db_learner:     'You are a database knowledge specialist. Be precise with data and facts.',
  folder_watcher: 'You are a document specialist. Quote relevant sections when helpful.',
  rag_validator:  'You are a RAG quality validator. Evaluate accuracy, identify gaps, score confidence.',
  custom:         'You are a helpful AI assistant with access to a specialized knowledge base.',
}

function AgentRow({ agent, onEdit, onDelete, onDeploy, onStop, onLogs }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '12px 16px',
      borderBottom: '1px solid var(--border)',
      transition: 'background 0.1s',
    }}
    onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-hover)'}
    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
    >
      <StatusDot status={agent.status} />

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 13 }}>{agent.name}</span>
          <Badge color={TYPE_COLOR[agent.agent_type] || 'default'}>{agent.agent_type.replace('_', ' ')}</Badge>
          <Badge color={STATUS_COLOR[agent.status] || 'default'}>{agent.status}</Badge>
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2, fontFamily: 'var(--font-mono)' }}>
          {agent.model} {agent.container_name && `· ${agent.container_name}`}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 6 }}>
        <Btn size="sm" variant="ghost" onClick={() => onLogs(agent)}><FileText size={11} /> logs</Btn>
        <Btn size="sm" variant="ghost" onClick={() => onEdit(agent)}><Edit3 size={11} /> edit</Btn>
        {agent.status === 'staged' && (
          <Btn size="sm" variant="success" onClick={() => onDeploy(agent)}><Play size={11} /> deploy</Btn>
        )}
        {agent.status === 'running' && (
          <Btn size="sm" variant="danger" onClick={() => onStop(agent)}><Square size={11} /> stop</Btn>
        )}
        {!['running', 'deploying'].includes(agent.status) && (
          <Btn size="sm" variant="ghost" onClick={() => onDelete(agent.id)}>
            <Trash2 size={11} style={{ color: 'var(--red)' }} />
          </Btn>
        )}
      </div>
    </div>
  )
}

export default function AgentsPage() {
  const { agents, setAgents, collections, models } = useStore()
  const [loading, setLoading] = useState(true)
  const [createModal, setCreateModal] = useState(false)
  const [editModal, setEditModal] = useState({ open: false, agent: null })
  const [logsModal, setLogsModal] = useState({ open: false, agent: null, logs: '' })
  const [form, setForm] = useState({ name: '', description: '', agent_type: 'custom', model: '', kb_collection_id: '', system_prompt: '' })
  const [saving, setSaving] = useState(false)
  const [seeding, setSeeding] = useState(false)

  const refresh = async () => {
    setLoading(true)
    try {
      const r = await getAgents()
      setAgents(r.data.agents || [])
    } catch { toast.error('Failed to load agents') }
    finally { setLoading(false) }
  }

  useEffect(() => { refresh() }, [])

  const handleTypeChange = type => {
    setForm(f => ({ ...f, agent_type: type, system_prompt: DEFAULT_PROMPTS[type] || '' }))
  }

  const handleSeedWorkers = async () => {
    setSeeding(true)
    try {
      // Find first available model to use as default
      const defaultModel = models.length > 0 ? models[0].name : 'llama3.1:8b'
      const r = await api.post(`/workers/seed?model=${encodeURIComponent(defaultModel)}`)
      if (r.data.created === 0) {
        toast.success('All default workers already exist')
      } else {
        toast.success(`Created ${r.data.created} default workers: ${r.data.workers?.join(', ')}`)
      }
      refresh()
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Seed failed')
    } finally { setSeeding(false) }
  }

  const handleCreate = async () => {
    if (!form.name || !form.model) return toast.error('Name and model are required')
    setSaving(true)
    try {
      await createAgent({ ...form, kb_collection_id: form.kb_collection_id || undefined })
      toast.success('Agent created')
      setCreateModal(false)
      setForm({ name: '', description: '', agent_type: 'custom', model: '', kb_collection_id: '', system_prompt: '' })
      refresh()
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Create failed')
    } finally { setSaving(false) }
  }

  const handleEditSave = async () => {
    setSaving(true)
    try {
      await updateAgent(editModal.agent.id, {
        description: editModal.agent.description,
        system_prompt: editModal.agent.system_prompt,
      })
      toast.success('Agent updated')
      setEditModal({ open: false, agent: null })
      refresh()
    } catch { toast.error('Update failed') }
    finally { setSaving(false) }
  }

  const handleDelete = async id => {
    if (!confirm('Delete this agent?')) return
    try {
      await deleteAgent(id)
      toast.success('Agent deleted')
      refresh()
    } catch (e) { toast.error(e.response?.data?.detail || 'Delete failed') }
  }

  const handleDeploy = async agent => {
    try {
      const r = await deployAgent(agent.id)
      toast.success(`Deploy queued. Approval ID: ${r.data.approval_request_id.slice(0, 8)}…`)
    } catch (e) { toast.error(e.response?.data?.detail || 'Deploy failed') }
  }

  const handleStop = async agent => {
    try {
      await stopAgent(agent.id)
      toast.success(`${agent.name} stopped`)
      refresh()
    } catch (e) { toast.error(e.response?.data?.detail || 'Stop failed') }
  }

  const handleLogs = async agent => {
    setLogsModal({ open: true, agent, logs: '' })
    try {
      const r = await agentLogs(agent.id)
      setLogsModal(s => ({ ...s, logs: r.data.docker_logs || '(no logs)' }))
    } catch { setLogsModal(s => ({ ...s, logs: '(failed to fetch logs)' })) }
  }

  const running  = agents.filter(a => a.status === 'running').length
  const staged   = agents.filter(a => a.status === 'staged').length

  return (
    <div style={{ animation: 'fadeIn 0.2s ease' }}>
      <PageHelp
        steps={[
          'Click "Seed Default Workers" to create 6 pre-built specialist agents',
          'Edit each agent to assign a KB collection and review the system prompt',
          'Test the model + KB in Chat Test before deploying',
          'Click Deploy (▶) — approve in Approvals tab — agent goes live',
        ]}
        tips={[
          'Each agent type has specialized MCP tools (visible in MCP tab)',
          'Use the strongest model for rag_validator and summarizer — they need reasoning',
          'worker_monitor works best without a KB — it queries the KRONOS API directly',
          'Stop an agent before editing its model or KB collection',
        ]}
      />
      <PageHeader
        title="Agents"
        subtitle="Create and deploy AI workers"
        action={
          <div style={{ display: 'flex', gap: 8 }}>
            <Btn variant="ghost" onClick={handleSeedWorkers} loading={seeding}>
              <Zap size={12} /> Seed Default Workers
            </Btn>
            <Btn variant="accent" onClick={() => setCreateModal(true)}>
              <Plus size={12} /> New Agent
            </Btn>
          </div>
        }
      />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 20 }}>
        {[
          { label: 'Total', value: agents.length },
          { label: 'Running', value: running, color: 'var(--green)' },
          { label: 'Staged', value: staged },
          { label: 'Types', value: new Set(agents.map(a => a.agent_type)).size },
        ].map(s => (
          <div key={s.label} style={{ padding: '12px 16px', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)' }}>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 4 }}>{s.label}</div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 700, color: s.color || 'var(--text-primary)' }}>{s.value}</div>
          </div>
        ))}
      </div>

      <Card>
        <CardHeader action={<Btn size="sm" variant="ghost" onClick={refresh}><RefreshCw size={11} /></Btn>}>
          Agent Registry
        </CardHeader>
        {loading && <div style={{ display: 'flex', justifyContent: 'center', padding: 32 }}><Spinner /></div>}
        {!loading && agents.length === 0 && (
          <Empty icon="🤖" title="No agents yet" description="Create your first AI worker. Assign it a model and a KB to make it a specialist." />
        )}
        {agents.map(agent => (
          <AgentRow key={agent.id} agent={agent}
            onEdit={a => setEditModal({ open: true, agent: { ...a } })}
            onDelete={handleDelete} onDeploy={handleDeploy} onStop={handleStop} onLogs={handleLogs}
          />
        ))}
      </Card>

      {/* Create modal */}
      <Modal open={createModal} onClose={() => setCreateModal(false)} title="New Agent" width={520}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Input label="Name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="e.g. support_bot" />
          <Input label="Description" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} />
          <Select label="Agent Type" value={form.agent_type} onChange={e => handleTypeChange(e.target.value)}>
            {AGENT_TYPES.map(t => <option key={t} value={t}>{t.replace('_', ' ')}</option>)}
          </Select>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <label style={{ fontSize: 11, color: 'var(--text-muted)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>LLM Model</label>
            {models.length > 0 ? (
              <select value={form.model} onChange={e => setForm({ ...form, model: e.target.value })}
                style={{ padding: '7px 10px', borderRadius: 'var(--radius)', border: '1px solid var(--border-mid)', background: 'var(--bg-raised)', color: 'var(--text-primary)', fontSize: 12, fontFamily: 'var(--font-mono)' }}>
                <option value="">Select model…</option>
                {models.filter(m => !m.name.includes('embed')).map(m => (
                  <option key={m.name} value={m.name}>{m.name} ({m.size_gb} GB)</option>
                ))}
              </select>
            ) : (
              <input value={form.model} onChange={e => setForm({ ...form, model: e.target.value })}
                placeholder="e.g. llama3.1:8b (visit Ollama tab first)"
                style={{ padding: '7px 10px', borderRadius: 'var(--radius)', border: '1px solid var(--border-mid)', background: 'var(--bg-raised)', color: 'var(--text-primary)', fontSize: 12, fontFamily: 'var(--font-mono)' }} />
            )}
            <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>Chat/reasoning model. Embedding models are filtered out.</div>
          </div>
          <Select label="KB Collection (optional)" value={form.kb_collection_id} onChange={e => setForm({ ...form, kb_collection_id: e.target.value })}>
            <option value="">None — no RAG</option>
            {collections.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
          <Textarea label="System Prompt" value={form.system_prompt} onChange={e => setForm({ ...form, system_prompt: e.target.value })} style={{ minHeight: 100 }} />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Btn variant="ghost" onClick={() => setCreateModal(false)}>cancel</Btn>
            <Btn variant="accent" onClick={handleCreate} loading={saving}>Create Agent</Btn>
          </div>
        </div>
      </Modal>

      {/* Edit modal */}
      <Modal open={editModal.open} onClose={() => setEditModal({ open: false })} title={`Edit: ${editModal.agent?.name}`} width={520}>
        {editModal.agent && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Input label="Description" value={editModal.agent.description || ''}
              onChange={e => setEditModal(s => ({ ...s, agent: { ...s.agent, description: e.target.value } }))} />
            <Textarea label="System Prompt" value={editModal.agent.system_prompt || ''}
              onChange={e => setEditModal(s => ({ ...s, agent: { ...s.agent, system_prompt: e.target.value } }))}
              style={{ minHeight: 140 }} />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <Btn variant="ghost" onClick={() => setEditModal({ open: false })}>cancel</Btn>
              <Btn variant="accent" onClick={handleEditSave} loading={saving}>Save</Btn>
            </div>
          </div>
        )}
      </Modal>

      {/* Logs modal */}
      <Modal open={logsModal.open} onClose={() => setLogsModal({ open: false })} title={`Logs: ${logsModal.agent?.name}`} width={640}>
        <pre style={{
          fontSize: 11, fontFamily: 'var(--font-mono)',
          background: 'var(--bg-base)', borderRadius: 'var(--radius)',
          padding: 14, maxHeight: 420, overflow: 'auto',
          color: 'var(--text-secondary)', lineHeight: 1.6,
          border: '1px solid var(--border)',
          whiteSpace: 'pre-wrap', wordBreak: 'break-all',
        }}>
          {logsModal.logs || 'Loading…'}
        </pre>
      </Modal>
    </div>
  )
}
