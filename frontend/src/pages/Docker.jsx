import React, { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { Box, RefreshCw, Cpu, HardDrive, Zap } from 'lucide-react'
import { PageHeader } from '../components/layout/Layout'
import { Card, CardHeader, Badge, Btn, Select, Modal, Spinner, Empty, StatusDot } from '../components/ui'
import { getContainers, containerStats, requestInjectKB } from '../api'
import { useStore } from '../hooks/useStore'

const STATUS_COLOR = {
  running: 'green', exited: 'default', stopped: 'default',
  paused: 'amber', restarting: 'amber', dead: 'red',
}

function ContainerRow({ container, onInject, onStats }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '11px 16px',
      borderBottom: '1px solid var(--border)',
      transition: 'background 0.1s',
    }}
    onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-hover)'}
    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
    >
      <StatusDot status={container.status === 'running' ? 'online' : 'offline'} />

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{container.name}</div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{container.image}</div>
      </div>

      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <Badge color={STATUS_COLOR[container.status] || 'default'}>{container.status}</Badge>
        <Badge color="default">{container.id}</Badge>
      </div>

      <div style={{ display: 'flex', gap: 6 }}>
        <Btn size="sm" variant="ghost" onClick={() => onStats(container)}>
          <Cpu size={11} /> stats
        </Btn>
        {container.status === 'running' && (
          <Btn size="sm" onClick={() => onInject(container)}>
            <Zap size={11} /> inject KB
          </Btn>
        )}
      </div>
    </div>
  )
}

export default function DockerPage() {
  const { collections } = useStore()
  const [containers, setContainers] = useState([])
  const [loading, setLoading] = useState(true)
  const [statsModal, setStatsModal] = useState({ open: false, container: null, data: null, loading: false })
  const [injectModal, setInjectModal] = useState({ open: false, container: null, kbId: '', targetPath: '/root/.chroma' })
  const [injecting, setInjecting] = useState(false)

  const refresh = async () => {
    setLoading(true)
    try {
      const r = await getContainers()
      setContainers(r.data.containers || [])
    } catch { toast.error('Cannot connect to Docker daemon') }
    finally { setLoading(false) }
  }

  useEffect(() => { refresh() }, [])

  const handleStats = async container => {
    setStatsModal({ open: true, container, data: null, loading: true })
    try {
      const r = await containerStats(container.id)
      setStatsModal(s => ({ ...s, data: r.data, loading: false }))
    } catch {
      setStatsModal(s => ({ ...s, loading: false }))
      toast.error('Stats unavailable')
    }
  }

  const handleInjectSubmit = async () => {
    if (!injectModal.kbId) return toast.error('Select a KB collection')
    setInjecting(true)
    try {
      const r = await requestInjectKB(injectModal.container.id, injectModal.kbId, injectModal.targetPath)
      toast.success(`KB injection queued. Approval ID: ${r.data.approval_request_id.slice(0, 8)}…`)
      setInjectModal({ open: false, container: null, kbId: '', targetPath: '/root/.chroma' })
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Injection request failed')
    } finally { setInjecting(false) }
  }

  return (
    <div style={{ animation: 'fadeIn 0.2s ease' }}>
      <PageHeader
        title="Docker"
        subtitle="Container management and KB injection"
        action={<Btn variant="ghost" onClick={refresh} loading={loading}><RefreshCw size={12} /> refresh</Btn>}
      />

      {/* Stats bar */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 20 }}>
        {[
          { label: 'Total', value: containers.length },
          { label: 'Running', value: containers.filter(c => c.status === 'running').length, color: 'var(--green)' },
          { label: 'Stopped', value: containers.filter(c => c.status !== 'running').length },
        ].map(s => (
          <div key={s.label} style={{ padding: '12px 16px', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)' }}>
            <div style={{ fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 4 }}>{s.label}</div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 700, color: s.color || 'var(--text-primary)' }}>{s.value}</div>
          </div>
        ))}
      </div>

      <Card>
        <CardHeader>Containers</CardHeader>
        {loading && <div style={{ display: 'flex', justifyContent: 'center', padding: 32 }}><Spinner /></div>}
        {!loading && containers.length === 0 && <Empty icon="🐳" title="No containers" description="No Docker containers found." />}
        {!loading && containers.map(c => (
          <ContainerRow key={c.id} container={c}
            onInject={container => setInjectModal({ open: true, container, kbId: '', targetPath: '/root/.chroma' })}
            onStats={handleStats}
          />
        ))}
      </Card>

      {/* Stats modal */}
      <Modal open={statsModal.open} onClose={() => setStatsModal({ open: false })} title={`Stats: ${statsModal.container?.name}`}>
        {statsModal.loading && <div style={{ textAlign: 'center', padding: 24 }}><Spinner /></div>}
        {statsModal.data && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            {[
              { label: 'CPU', value: `${statsModal.data.cpu_percent}%` },
              { label: 'Memory', value: `${statsModal.data.memory_usage_mb} MB` },
              { label: 'Mem Limit', value: `${statsModal.data.memory_limit_mb} MB` },
              { label: 'Mem %', value: `${statsModal.data.memory_percent}%` },
            ].map(s => (
              <div key={s.label} style={{ background: 'var(--bg-raised)', borderRadius: 'var(--radius)', padding: '10px 14px', border: '1px solid var(--border)' }}>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 4 }}>{s.label}</div>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 700 }}>{s.value}</div>
              </div>
            ))}
          </div>
        )}
      </Modal>

      {/* Inject KB modal */}
      <Modal open={injectModal.open} onClose={() => setInjectModal({ open: false })} title={`Inject KB → ${injectModal.container?.name}`}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ padding: '8px 12px', background: 'var(--accent-subtle)', border: '1px solid rgba(245,166,35,0.2)', borderRadius: 'var(--radius)', fontSize: 11, color: 'var(--accent)' }}>
            This copies the ChromaDB collection directly into the container — no re-learning required.
          </div>
          <Select
            label="KB Collection"
            value={injectModal.kbId}
            onChange={e => setInjectModal(s => ({ ...s, kbId: e.target.value }))}
          >
            <option value="">Select a collection…</option>
            {collections.map(c => <option key={c.id} value={c.id}>{c.name} ({c.doc_count} chunks)</option>)}
          </Select>
          <div>
            <label style={{ fontSize: 11, color: 'var(--text-muted)', letterSpacing: '0.04em', textTransform: 'uppercase', display: 'block', marginBottom: 5 }}>Target path in container</label>
            <input
              value={injectModal.targetPath}
              onChange={e => setInjectModal(s => ({ ...s, targetPath: e.target.value }))}
              style={{ padding: '7px 10px', width: '100%', borderRadius: 'var(--radius)', border: '1px solid var(--border-mid)', background: 'var(--bg-raised)', color: 'var(--text-primary)', fontSize: 12, fontFamily: 'var(--font-mono)' }}
            />
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
            <Btn variant="ghost" onClick={() => setInjectModal({ open: false })}>cancel</Btn>
            <Btn variant="accent" onClick={handleInjectSubmit} loading={injecting}>
              <Zap size={12} /> Queue Injection
            </Btn>
          </div>
        </div>
      </Modal>
    </div>
  )
}
