import React, { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { ShieldCheck, Check, X, Clock, RefreshCw, Play, Zap } from 'lucide-react'
import { PageHeader } from '../components/layout/Layout'
import { PageHelp } from '../components/help'
import { Card, Badge, Btn, Spinner, Empty } from '../components/ui'
import { getApprovals, resolveApproval } from '../api'
import { useStore } from '../hooks/useStore'
import api from '../api'

const ACTION_META = {
  ollama_pull:          { label: 'Ollama Pull',     color: 'blue',   exec: 'Pull Model' },
  ollama_delete:        { label: 'Ollama Delete',   color: 'red',    exec: null },
  docker_inject_kb:     { label: 'KB Injection',    color: 'amber',  exec: 'Inject KB' },
  docker_push_model:    { label: 'Push Model',      color: 'blue',   exec: 'Push Model' },
  docker_exec:          { label: 'Docker Exec',     color: 'purple', exec: null },
  agent_deploy:         { label: 'Agent Deploy',    color: 'green',  exec: 'Deploy Agent' },
  finetune_job:         { label: 'Fine-tune Job',   color: 'purple', exec: 'Launch Training' },
  finetune_export_gguf: { label: 'GGUF Export',     color: 'amber',  exec: 'Export GGUF' },
}

const EXECUTORS = {
  ollama_pull:          id => api.post(`/ollama/models/pull/execute/${id}`),
  docker_push_model:    id => api.post(`/docker/push-model/execute/${id}`),
  docker_inject_kb:     id => api.post(`/docker/inject-kb/execute/${id}`),
  agent_deploy:         id => api.post(`/agents/deploy/execute/${id}`),
}

function PayloadView({ payload }) {
  const skip = new Set(['config', 'system_prompt', 'dockerfile'])
  return (
    <div style={{ background: 'var(--bg-base)', borderRadius: 'var(--radius)', padding: '10px 12px', border: '1px solid var(--border)', marginBottom: 10 }}>
      {Object.entries(payload).filter(([k]) => !skip.has(k)).map(([k, v]) => (
        <div key={k} style={{ display: 'flex', gap: 10, marginBottom: 3, fontSize: 11 }}>
          <span style={{ color: 'var(--text-muted)', minWidth: 140, flexShrink: 0 }}>{k}</span>
          <span style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-mono)', wordBreak: 'break-all' }}>
            {typeof v === 'object' ? JSON.stringify(v).slice(0, 120) : String(v ?? '—')}
          </span>
        </div>
      ))}
    </div>
  )
}

function ApprovalCard({ req, onResolve, onRefresh }) {
  const [note, setNote] = useState('')
  const [resolving, setResolving] = useState(false)
  const [executing, setExecuting] = useState(false)
  const meta = ACTION_META[req.action_type] || { label: req.action_type, color: 'default', exec: null }

  const doResolve = async (approved) => {
    setResolving(true)
    await onResolve(req.id, approved, note)
    setResolving(false)
  }

  const doExecute = async () => {
    const fn = EXECUTORS[req.action_type]
    if (!fn) return toast.error('No executor for: ' + req.action_type)
    setExecuting(true)
    try {
      await fn(req.id)
      toast.success(meta.exec + ' started')
      onRefresh()
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Execute failed')
    } finally { setExecuting(false) }
  }

  return (
    <div style={{ padding: '16px 18px', borderBottom: '1px solid var(--border)', animation: 'fadeIn 0.15s ease' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
        <Badge color={meta.color}>{meta.label}</Badge>
        <Badge color={req.status === 'pending' ? 'amber' : req.status === 'approved' ? 'green' : 'red'}>{req.status}</Badge>
        {req.payload?.model_name && <code style={{ fontSize: 11, color: 'var(--accent)' }}>{req.payload.model_name}</code>}
        {req.payload?.agent_name && <code style={{ fontSize: 11, color: 'var(--accent)' }}>{req.payload.agent_name}</code>}
        {req.payload?.kb_name && <code style={{ fontSize: 11, color: 'var(--text-muted)' }}>→ {req.payload.kb_name}</code>}
        <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--text-muted)' }}>{new Date(req.created_at).toLocaleString()}</span>
      </div>

      <PayloadView payload={req.payload} />

      {req.status === 'pending' && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input value={note} onChange={e => setNote(e.target.value)} placeholder="Optional note…"
            style={{ flex: 1, padding: '6px 10px', background: 'var(--bg-raised)', border: '1px solid var(--border-mid)', borderRadius: 'var(--radius)', color: 'var(--text-primary)', fontSize: 11, fontFamily: 'var(--font-mono)' }} />
          <Btn variant="ghost" size="sm" onClick={() => doResolve(false)} loading={resolving}><X size={11} /> Reject</Btn>
          <Btn variant="accent" size="sm" onClick={() => doResolve(true)} loading={resolving}><Check size={11} /> Approve</Btn>
        </div>
      )}

      {req.status === 'approved' && EXECUTORS[req.action_type] && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ flex: 1, padding: '6px 10px', background: 'rgba(61,214,140,0.08)', border: '1px solid rgba(61,214,140,0.2)', borderRadius: 'var(--radius)', fontSize: 11, color: 'var(--green)' }}>
            ✓ Approved — ready to execute
          </div>
          <Btn variant="success" size="sm" onClick={doExecute} loading={executing}><Play size={11} /> {meta.exec}</Btn>
        </div>
      )}

      {req.status === 'approved' && !EXECUTORS[req.action_type] && (
        <div style={{ fontSize: 11, color: 'var(--green)' }}>✓ Approved — execute from originating page</div>
      )}

      {req.owner_note && (
        <div style={{ marginTop: 6, fontSize: 11, color: 'var(--text-muted)', fontStyle: 'italic' }}>Note: {req.owner_note}</div>
      )}
    </div>
  )
}

export default function ApprovalsPage() {
  const { approvals, setApprovals } = useStore()
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('pending')

  const refresh = async () => {
    setLoading(true)
    try { const r = await getApprovals(); setApprovals(r.data) }
    catch { toast.error('Failed to load approvals') }
    finally { setLoading(false) }
  }

  useEffect(() => { refresh() }, [])

  const handleResolve = async (id, approved, note) => {
    try { await resolveApproval(id, approved, note); toast.success(approved ? 'Approved' : 'Rejected'); refresh() }
    catch (e) { toast.error(e.response?.data?.detail || 'Failed') }
  }

  const pending  = approvals.filter(a => a.status === 'pending')
  const approved = approvals.filter(a => a.status === 'approved')
  const shown = filter === 'pending' ? pending : filter === 'approved' ? approved : approvals

  return (
    <div style={{ animation: 'fadeIn 0.2s ease' }}>
      <PageHelp
        steps={[
          'Actions like model pull, agent deploy, KB inject are queued here first',
          'Review the payload — it shows exactly what will happen',
          'Click Approve — then an Execute button appears right below',
          'Click Execute to actually run it — no need to go back to the originating page',
        ]}
        tips={[
          'Approved tab shows actions ready to execute — check it after approving',
          'Use the note field to document why you approved/rejected for audit trail',
          'Rejected actions must be re-requested from the originating page',
        ]}
      />
      <PageHeader title="Approvals" subtitle="Review and authorize queued actions"
        action={<Btn variant="ghost" size="sm" onClick={refresh}><RefreshCw size={11} /></Btn>} />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 16 }}>
        {[
          { label: 'Pending',  val: pending.length,  col: pending.length > 0 ? 'var(--accent)' : undefined },
          { label: 'Approved', val: approved.length, col: approved.length > 0 ? 'var(--green)' : undefined },
          { label: 'Rejected', val: approvals.filter(a => a.status === 'rejected').length },
          { label: 'Total',    val: approvals.length },
        ].map(s => (
          <div key={s.label} style={{ padding: '12px 16px', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)' }}>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 4 }}>{s.label}</div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 700, color: s.col || 'var(--text-primary)' }}>{s.val}</div>
          </div>
        ))}
      </div>

      {pending.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', marginBottom: 10, background: 'var(--accent-subtle)', border: '1px solid rgba(245,166,35,0.3)', borderRadius: 'var(--radius-lg)', fontSize: 12, color: 'var(--accent)' }}>
          <Clock size={13} /> {pending.length} action{pending.length !== 1 ? 's' : ''} waiting for approval
        </div>
      )}
      {approved.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', marginBottom: 10, background: 'rgba(61,214,140,0.06)', border: '1px solid rgba(61,214,140,0.25)', borderRadius: 'var(--radius-lg)', fontSize: 12, color: 'var(--green)' }}>
          <Zap size={13} /> {approved.length} action{approved.length !== 1 ? 's' : ''} approved — click Execute below to run
        </div>
      )}

      <div style={{ display: 'flex', gap: 4, marginBottom: 14 }}>
        {[
          { k: 'pending',  l: `Pending (${pending.length})` },
          { k: 'approved', l: `Ready to Execute (${approved.length})` },
          { k: 'all',      l: `All (${approvals.length})` },
        ].map(f => (
          <button key={f.k} onClick={() => setFilter(f.k)} style={{
            padding: '5px 14px', borderRadius: 'var(--radius)', fontSize: 11, fontFamily: 'var(--font-mono)', cursor: 'pointer',
            background: filter === f.k ? 'var(--accent-subtle)' : 'transparent',
            color: filter === f.k ? 'var(--accent)' : 'var(--text-muted)',
            border: `1px solid ${filter === f.k ? 'rgba(245,166,35,0.3)' : 'transparent'}`,
          }}>{f.l}</button>
        ))}
      </div>

      <Card>
        {loading && <div style={{ display: 'flex', justifyContent: 'center', padding: 32 }}><Spinner /></div>}
        {!loading && shown.length === 0 && <Empty icon="✓" title={`No ${filter} requests`} description="Nothing here." />}
        {shown.map(req => <ApprovalCard key={req.id} req={req} onResolve={handleResolve} onRefresh={refresh} />)}
      </Card>
    </div>
  )
}
