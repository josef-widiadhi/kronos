import React, { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { ShieldCheck, Check, X, Clock, RefreshCw } from 'lucide-react'
import { PageHeader } from '../components/layout/Layout'
import { PageHelp } from '../components/help'
import { Card, CardHeader, Badge, Btn, Spinner, Empty } from '../components/ui'
import { getApprovals, resolveApproval } from '../api'
import { useStore } from '../hooks/useStore'
import { formatDistanceToNow } from 'date-fns'

const ACTION_LABELS = {
  ollama_pull:      { label: 'Ollama Pull',     color: 'blue' },
  ollama_delete:    { label: 'Ollama Delete',   color: 'red' },
  docker_inject_kb: { label: 'KB Injection',    color: 'amber' },
  docker_exec:      { label: 'Docker Exec',     color: 'purple' },
  agent_deploy:     { label: 'Agent Deploy',    color: 'green' },
}

function ApprovalCard({ req, onResolve }) {
  const [note, setNote] = useState('')
  const [loading, setLoading] = useState(false)
  const meta = ACTION_LABELS[req.action_type] || { label: req.action_type, color: 'default' }

  const resolve = async approved => {
    setLoading(true)
    await onResolve(req.id, approved, note)
    setLoading(false)
  }

  return (
    <div style={{
      padding: '16px 18px',
      borderBottom: '1px solid var(--border)',
      animation: 'fadeIn 0.15s ease',
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <Badge color={meta.color}>{meta.label}</Badge>
            <Badge color={req.status === 'pending' ? 'amber' : req.status === 'approved' ? 'green' : 'red'}>
              {req.status}
            </Badge>
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            {formatDistanceToNow(new Date(req.created_at), { addSuffix: true })}
          </div>
        </div>
      </div>

      {/* Payload */}
      <div style={{
        background: 'var(--bg-base)',
        borderRadius: 'var(--radius)',
        padding: '10px 12px',
        marginBottom: 12,
        border: '1px solid var(--border)',
      }}>
        {Object.entries(req.payload).map(([k, v]) => (
          <div key={k} style={{ display: 'flex', gap: 10, marginBottom: 4, fontSize: 11 }}>
            <span style={{ color: 'var(--text-muted)', minWidth: 120 }}>{k}</span>
            <span style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-mono)', wordBreak: 'break-all' }}>
              {typeof v === 'object' ? JSON.stringify(v) : String(v || '—')}
            </span>
          </div>
        ))}
      </div>

      {req.status === 'pending' && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="Optional note…"
            style={{
              flex: 1, padding: '6px 10px',
              background: 'var(--bg-raised)', border: '1px solid var(--border-mid)',
              borderRadius: 'var(--radius)', color: 'var(--text-primary)',
              fontSize: 11, fontFamily: 'var(--font-mono)',
            }}
          />
          <Btn variant="danger" size="sm" onClick={() => resolve(false)} loading={loading}>
            <X size={11} /> Reject
          </Btn>
          <Btn variant="success" size="sm" onClick={() => resolve(true)} loading={loading}>
            <Check size={11} /> Approve
          </Btn>
        </div>
      )}

      {req.status !== 'pending' && req.owner_note && (
        <div style={{ fontSize: 11, color: 'var(--text-muted)', fontStyle: 'italic' }}>
          Note: {req.owner_note}
        </div>
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
    try {
      const r = await getApprovals()
      setApprovals(r.data)
    } catch { toast.error('Failed to load approvals') }
    finally { setLoading(false) }
  }

  useEffect(() => { refresh() }, [])

  const handleResolve = async (id, approved, note) => {
    try {
      await resolveApproval(id, approved, note)
      toast.success(approved ? 'Approved' : 'Rejected')
      refresh()
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to resolve')
    }
  }

  const pending  = approvals.filter(a => a.status === 'pending')
  const resolved = approvals.filter(a => a.status !== 'pending')
  const shown    = filter === 'pending' ? pending : resolved

  return (
    <div style={{ animation: 'fadeIn 0.2s ease' }}>
      <PageHelp
        steps={[
          'Actions like model pulls and agent deploys are queued here for your review',
          'Click on a pending request to see exactly what will happen',
          'Add an optional note, then Approve or Reject',
          'Approved actions still need to be Executed (click Execute in the originating tab)',
        ]}
        tips={[
          'Rejection is permanent — you need to re-request the action to try again',
          'The approval payload shows exact parameters — always review before approving deploys',
          'Resolved tab keeps a history of all approved/rejected actions',
        ]}
      />
      <PageHeader
        title="Approvals"
        subtitle="Review and authorize queued actions"
        action={<Btn variant="ghost" size="sm" onClick={refresh}><RefreshCw size={11} /></Btn>}
      />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 20 }}>
        {[
          { label: 'Pending', value: pending.length, color: pending.length > 0 ? 'var(--accent)' : 'var(--text-primary)' },
          { label: 'Approved', value: approvals.filter(a => a.status === 'approved').length, color: 'var(--green)' },
          { label: 'Rejected', value: approvals.filter(a => a.status === 'rejected').length },
        ].map(s => (
          <div key={s.label} style={{ padding: '12px 16px', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)' }}>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 4 }}>{s.label}</div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 700, color: s.color || 'var(--text-primary)' }}>{s.value}</div>
          </div>
        ))}
      </div>

      {pending.length > 0 && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '10px 14px', marginBottom: 16,
          background: 'var(--accent-subtle)',
          border: '1px solid rgba(245,166,35,0.3)',
          borderRadius: 'var(--radius-lg)',
          fontSize: 12, color: 'var(--accent)',
        }}>
          <Clock size={13} />
          {pending.length} action{pending.length !== 1 ? 's' : ''} waiting for your approval
        </div>
      )}

      {/* Filter tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 14 }}>
        {['pending', 'resolved'].map(f => (
          <button key={f} onClick={() => setFilter(f)} style={{
            padding: '5px 14px', borderRadius: 'var(--radius)',
            fontSize: 11, fontFamily: 'var(--font-mono)',
            background: filter === f ? 'var(--accent-subtle)' : 'transparent',
            color: filter === f ? 'var(--accent)' : 'var(--text-muted)',
            border: `1px solid ${filter === f ? 'rgba(245,166,35,0.3)' : 'transparent'}`,
            cursor: 'pointer',
          }}>
            {f} {f === 'pending' ? `(${pending.length})` : `(${resolved.length})`}
          </button>
        ))}
      </div>

      <Card>
        {loading && <div style={{ display: 'flex', justifyContent: 'center', padding: 32 }}><Spinner /></div>}
        {!loading && shown.length === 0 && (
          <Empty icon="✓" title={`No ${filter} requests`} description={filter === 'pending' ? 'All caught up. No actions waiting for approval.' : 'No resolved approvals yet.'} />
        )}
        {shown.map(req => <ApprovalCard key={req.id} req={req} onResolve={handleResolve} />)}
      </Card>
    </div>
  )
}
