import React, { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { Terminal, CheckCircle, XCircle, RefreshCw, Download, Trash2, Info } from 'lucide-react'
import { PageHeader } from '../components/layout/Layout'
import { PageHelp, Hint } from '../components/help'
import { Card, CardHeader, Badge, Btn, Input, Modal, Spinner, Empty, StatBox, StatusDot } from '../components/ui'
import { ollamaStatus, ollamaModels, ollamaModelInfo, requestPull } from '../api'
import { useStore } from '../hooks/useStore'

function bytesToGB(b) { return (b / 1e9).toFixed(2) }

function ModelRow({ model, onInfo }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '10px 16px',
      borderBottom: '1px solid var(--border)',
      transition: 'background 0.1s',
    }}
    onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-hover)'}
    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-primary)' }}>{model.name}</div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
          {model.details?.family || 'unknown'} · {model.details?.parameter_size || '?'} · {model.size_gb} GB
        </div>
      </div>
      <Badge color="default">{model.digest}</Badge>
      <Btn size="sm" variant="ghost" onClick={() => onInfo(model.name)}>
        <Info size={11} /> info
      </Btn>
    </div>
  )
}

export default function OllamaPage() {
  const { ollamaStatus: status, models, setOllamaStatus, setModels } = useStore()
  const [loading, setLoading] = useState(false)
  const [pullModel, setPullModel] = useState('')
  const [pulling, setPulling] = useState(false)
  const [infoModal, setInfoModal] = useState({ open: false, data: null, name: '' })

  const refresh = async () => {
    setLoading(true)
    try {
      const [s, m] = await Promise.all([ollamaStatus(), ollamaModels()])
      setOllamaStatus(s.data)
      setModels(m.data.models || [])
    } catch (e) {
      toast.error('Failed to fetch Ollama data')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { refresh() }, [])

  const handlePull = async () => {
    if (!pullModel.trim()) return
    setPulling(true)
    try {
      const r = await requestPull(pullModel.trim())
      toast.success(`Pull request queued. Approval ID: ${r.data.approval_request_id.slice(0, 8)}…`)
      setPullModel('')
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Pull request failed')
    } finally {
      setPulling(false)
    }
  }

  const handleInfo = async name => {
    try {
      const r = await ollamaModelInfo(name)
      setInfoModal({ open: true, data: r.data, name })
    } catch {
      toast.error('Could not fetch model info')
    }
  }

  return (
    <div style={{ animation: 'fadeIn 0.2s ease' }}>
      <PageHelp
        steps={[
          'Your local Ollama models appear automatically — no re-downloading needed',
          'Binary "not found" is normal — KRONOS uses your host Ollama via network',
          'Use "Request Pull" to download new models (requires Approvals approval)',
          'Pulled models appear as dropdowns in RAG and Agents pages',
        ]}
        tips={[
          'nomic-embed-text is required for RAG — it should already be pulled',
          'For coding tasks: qwen2.5-coder. For general: llama3.1 or qwen2.5',
          'Smaller models (1-4GB) are faster; larger models (7B+) are more accurate',
        ]}
      />
      <PageHeader
        title="Ollama"
        subtitle="Local model management"
        action={
          <Btn variant="ghost" onClick={refresh} loading={loading}>
            <RefreshCw size={12} /> refresh
          </Btn>
        }
      />

      {/* Status cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 24 }}>
        <div style={{ padding: '14px 16px', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)' }}>
          <div style={{ fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 8 }}>Binary</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {status?.binary_installed
              ? <CheckCircle size={16} style={{ color: 'var(--green)' }} />
              : <XCircle size={16} style={{ color: 'var(--red)' }} />}
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{status?.binary_version || 'not found'}</span>
          </div>
        </div>
        <div style={{ padding: '14px 16px', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)' }}>
          <div style={{ fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 8 }}>API</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <StatusDot status={status?.api_reachable ? 'online' : 'offline'} />
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>
              {status?.api_reachable ? status.api_version : 'unreachable'}
            </span>
          </div>
        </div>
        <StatBox label="Models Pulled" value={models.length} />
      </div>

      {/* Pull model */}
      <Card style={{ marginBottom: 20 }}>
        <CardHeader>Pull New Model</CardHeader>
        <div style={{ padding: '14px 18px', display: 'flex', gap: 10, alignItems: 'flex-end' }}>
          <div style={{ flex: 1 }}>
            <Input
              label="Model name"
              value={pullModel}
              onChange={e => setPullModel(e.target.value)}
              placeholder="e.g. llama3.2, mistral, codellama:13b"
              onKeyDown={e => e.key === 'Enter' && handlePull()}
            />
          </div>
          <Btn variant="accent" onClick={handlePull} loading={pulling}>
            <Download size={12} /> Request Pull
          </Btn>
        </div>
        <div style={{ padding: '0 18px 14px', fontSize: 11, color: 'var(--text-muted)' }}>
          Pull requests require owner approval. Check the Approvals tab to execute.
        </div>
      </Card>

      {/* Model list */}
      <Card>
        <CardHeader>Available Models</CardHeader>
        {loading && <div style={{ display: 'flex', justifyContent: 'center', padding: 32 }}><Spinner /></div>}
        {!loading && models.length === 0 && (
          <Empty icon="📦" title="No models pulled" description="Use the form above to pull a model from Ollama registry." />
        )}
        {!loading && models.map(m => (
          <ModelRow key={m.name} model={m} onInfo={handleInfo} />
        ))}
      </Card>

      {/* Info modal */}
      <Modal open={infoModal.open} onClose={() => setInfoModal({ open: false })} title={`Model: ${infoModal.name}`} width={560}>
        {infoModal.data && (
          <pre style={{
            fontSize: 11, color: 'var(--text-secondary)',
            background: 'var(--bg-raised)', borderRadius: 'var(--radius)',
            padding: 12, overflow: 'auto', maxHeight: 400,
            border: '1px solid var(--border)',
          }}>
            {JSON.stringify(infoModal.data, null, 2)}
          </pre>
        )}
      </Modal>
    </div>
  )
}
