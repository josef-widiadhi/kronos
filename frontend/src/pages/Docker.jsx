import React, { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { Box, RefreshCw, Cpu, Zap, Terminal, Send, Database, ChevronDown, ChevronRight, Check } from 'lucide-react'
import { PageHeader } from '../components/layout/Layout'
import { Card, CardHeader, Badge, Btn, Select, Modal, Spinner, Empty, StatusDot, SectionLabel } from '../components/ui'
import { PageHelp, Hint } from '../components/help'
import { useStore } from '../hooks/useStore'
import api from '../api'

const STATUS_COLOR = {
  running: 'green', exited: 'default', stopped: 'default',
  paused: 'amber', restarting: 'amber', dead: 'red',
}

// ── Push Wizard Modal ─────────────────────────────────────────────────────────
function PushWizard({ open, onClose, containers, collections, models }) {
  const [step, setStep] = useState(1)  // 1=target, 2=model, 3=kb, 4=confirm, 5=done
  const [target, setTarget] = useState(null)
  const [ollamaContainer, setOllamaContainer] = useState(null)
  const [selectedModel, setSelectedModel] = useState('')
  const [selectedKBs, setSelectedKBs] = useState([])
  const [ollamaCheck, setOllamaCheck] = useState(null)
  const [checkingOllama, setCheckingOllama] = useState(false)
  const [pushing, setPushing] = useState(false)
  const [pushLog, setPushLog] = useState([])
  const [modelApprovalId, setModelApprovalId] = useState(null)
  const [kbApprovalIds, setKbApprovalIds] = useState([])
  const [results, setResults] = useState([])

  const runningContainers = containers.filter(c => c.status === 'running')
  const ollamaContainers = runningContainers.filter(c => c.is_ollama || c.name.toLowerCase().includes('ollama'))

  const reset = () => {
    setStep(1); setTarget(null); setOllamaContainer(null)
    setSelectedModel(''); setSelectedKBs([]); setOllamaCheck(null)
    setPushLog([]); setModelApprovalId(null); setKbApprovalIds([]); setResults([])
  }

  const handleClose = () => { reset(); onClose() }

  const checkOllama = async (containerId) => {
    setCheckingOllama(true); setOllamaCheck(null)
    try {
      const r = await api.get(`/docker/containers/${containerId}/ollama-check`)
      setOllamaCheck(r.data)
    } catch { setOllamaCheck({ has_ollama: false, hint: 'Check failed' }) }
    finally { setCheckingOllama(false) }
  }

  const handleQueueAll = async () => {
    setPushing(true)
    const newResults = []
    try {
      // Queue model push
      if (selectedModel && ollamaContainer) {
        const r = await api.post('/docker/push-model', {
          target_container_id: ollamaContainer,
          model_name: selectedModel,
        })
        newResults.push({ type: 'model', label: `Model: ${selectedModel}`, approvalId: r.data.approval_request_id, status: 'queued' })
        setModelApprovalId(r.data.approval_request_id)
      }
      // Queue KB injections
      for (const kbId of selectedKBs) {
        const kb = collections.find(c => c.id === kbId)
        const r = await api.post('/docker/inject-kb', {
          container_id: target.id,
          kb_collection_id: kbId,
          target_path: '/root/.chroma',
        })
        newResults.push({ type: 'kb', label: `KB: ${kb?.name}`, approvalId: r.data.approval_request_id, status: 'queued' })
      }
      setResults(newResults)
      setStep(5)
      toast.success(`Queued ${newResults.length} action(s) for approval`)
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Queue failed')
    } finally { setPushing(false) }
  }

  if (!open) return null

  return (
    <div onClick={handleClose} style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      background: 'rgba(0,0,0,0.75)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      backdropFilter: 'blur(4px)',
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        width: 560, maxWidth: 'calc(100vw - 32px)',
        background: 'var(--bg-surface)',
        border: '1px solid var(--border-mid)',
        borderRadius: 'var(--radius-lg)',
        overflow: 'hidden',
        animation: 'fadeIn 0.15s ease',
      }}>
        {/* Header */}
        <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 14 }}>
              Push Model + KB to External Container
            </div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
              Step {step} of 5 — {['', 'Select target', 'Push model', 'Push KB', 'Confirm', 'Done'][step]}
            </div>
          </div>
          {/* Progress dots */}
          <div style={{ display: 'flex', gap: 6 }}>
            {[1,2,3,4,5].map(s => (
              <div key={s} style={{
                width: 8, height: 8, borderRadius: '50%',
                background: s <= step ? 'var(--accent)' : 'var(--border-mid)',
                transition: 'background 0.2s',
              }} />
            ))}
          </div>
        </div>

        <div style={{ padding: 18 }}>

          {/* Step 1: Select target container */}
          {step === 1 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <Hint type="tip">Select the container you want to push knowledge into (e.g. arachne, your app container). For model push, you also need its Ollama container.</Hint>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                <label style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Target App Container (for KB injection)</label>
                <select value={target?.id || ''} onChange={e => setTarget(runningContainers.find(c => c.id === e.target.value) || null)}
                  style={{ padding: '8px 10px', borderRadius: 'var(--radius)', border: '1px solid var(--border-mid)', background: 'var(--bg-raised)', color: 'var(--text-primary)', fontSize: 12, fontFamily: 'var(--font-mono)' }}>
                  <option value="">Select container…</option>
                  {runningContainers.map(c => (
                    <option key={c.id} value={c.id}>{c.name} ({c.image?.split(':')[0]?.split('/').pop()})</option>
                  ))}
                </select>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                <label style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Ollama Container (for model push)</label>
                <select value={ollamaContainer || ''} onChange={async e => {
                  setOllamaContainer(e.target.value)
                  if (e.target.value) checkOllama(e.target.value)
                }}
                  style={{ padding: '8px 10px', borderRadius: 'var(--radius)', border: '1px solid var(--border-mid)', background: 'var(--bg-raised)', color: 'var(--text-primary)', fontSize: 12, fontFamily: 'var(--font-mono)' }}>
                  <option value="">Select Ollama container… (optional)</option>
                  {runningContainers.map(c => (
                    <option key={c.id} value={c.id}>{c.name} {c.is_ollama ? '🤖' : ''}</option>
                  ))}
                </select>
                {checkingOllama && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}><Spinner size={11} /> Checking Ollama…</div>}
                {ollamaCheck && (
                  <div style={{ padding: '6px 10px', borderRadius: 'var(--radius)', fontSize: 11, fontFamily: 'var(--font-mono)',
                    background: ollamaCheck.has_ollama ? 'var(--green-dim)' : 'var(--red-dim)',
                    border: `1px solid ${ollamaCheck.has_ollama ? 'rgba(61,214,140,0.3)' : 'rgba(242,107,107,0.3)'}`,
                    color: ollamaCheck.has_ollama ? 'var(--green)' : 'var(--red)',
                  }}>
                    {ollamaCheck.has_ollama
                      ? `✓ Ollama found · ${ollamaCheck.model_count} models · ${ollamaCheck.endpoint}`
                      : `✗ ${ollamaCheck.hint || 'No Ollama'}`}
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 4 }}>
                <Btn variant="accent" onClick={() => setStep(2)} disabled={!target && !ollamaContainer}>Next →</Btn>
              </div>
            </div>
          )}

          {/* Step 2: Model selection */}
          {step === 2 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <Hint type="tip">Select a model to push to {containers.find(c=>c.id===ollamaContainer)?.name || 'target Ollama'}. The model will be pulled from your host Ollama — no internet download needed if it's already there.</Hint>
              {!ollamaContainer ? (
                <Hint type="warning">No Ollama container selected — skip model push or go back to select one.</Hint>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  <label style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Model to push</label>
                  <select value={selectedModel} onChange={e => setSelectedModel(e.target.value)}
                    style={{ padding: '8px 10px', borderRadius: 'var(--radius)', border: '1px solid var(--border-mid)', background: 'var(--bg-raised)', color: 'var(--text-primary)', fontSize: 12, fontFamily: 'var(--font-mono)' }}>
                    <option value="">Skip model push</option>
                    {models.filter(m => !m.name.includes('embed')).map(m => (
                      <option key={m.name} value={m.name}>{m.name} ({m.size_gb} GB)</option>
                    ))}
                  </select>
                  {ollamaCheck?.models?.length > 0 && (
                    <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                      Already in target: {ollamaCheck.models.join(', ')}
                    </div>
                  )}
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
                <Btn variant="ghost" onClick={() => setStep(1)}>← Back</Btn>
                <Btn variant="accent" onClick={() => setStep(3)}>Next →</Btn>
              </div>
            </div>
          )}

          {/* Step 3: KB selection */}
          {step === 3 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <Hint type="tip">Select which KB collections to inject into {target?.name}. They'll be copied as ChromaDB persistent directories — no re-embedding needed.</Hint>
              {collections.length === 0 ? (
                <Empty icon="🗄️" title="No KB collections" description="Create collections in RAG/KB first" />
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 280, overflow: 'auto' }}>
                  {collections.map(col => {
                    const sel = selectedKBs.includes(col.id)
                    return (
                      <div key={col.id} onClick={() => setSelectedKBs(prev => sel ? prev.filter(i=>i!==col.id) : [...prev, col.id])}
                        style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', cursor: 'pointer',
                          background: sel ? 'var(--accent-subtle)' : 'var(--bg-raised)',
                          border: `1px solid ${sel ? 'rgba(245,166,35,0.4)' : 'var(--border)'}`,
                          borderRadius: 'var(--radius)', transition: 'all 0.1s',
                        }}>
                        <div style={{ width: 16, height: 16, borderRadius: 3, flexShrink: 0,
                          background: sel ? 'var(--accent)' : 'var(--bg-overlay)',
                          border: `1px solid ${sel ? 'var(--accent)' : 'var(--border-mid)'}`,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}>
                          {sel && <Check size={10} style={{ color: 'var(--bg-base)' }} />}
                        </div>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 12, fontWeight: 600, color: sel ? 'var(--accent)' : 'var(--text-primary)' }}>{col.name}</div>
                          <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{col.doc_count} chunks · {col.model} · embed: {col.embed_model}</div>
                        </div>
                        <Badge color="default">{col.doc_count} chunks</Badge>
                      </div>
                    )
                  })}
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
                <Btn variant="ghost" onClick={() => setStep(2)}>← Back</Btn>
                <Btn variant="accent" onClick={() => setStep(4)} disabled={selectedKBs.length === 0 && !selectedModel}>Next →</Btn>
              </div>
            </div>
          )}

          {/* Step 4: Confirm */}
          {step === 4 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 13 }}>Review before queuing</div>
              <div style={{ background: 'var(--bg-raised)', borderRadius: 'var(--radius)', padding: '12px 14px', border: '1px solid var(--border)', fontSize: 11, fontFamily: 'var(--font-mono)', display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ color: 'var(--text-muted)' }}>Target app container:</div>
                <div style={{ color: 'var(--text-primary)', paddingLeft: 12 }}>{target?.name} ({target?.image?.split('/').pop()})</div>
                {ollamaContainer && selectedModel && <>
                  <div style={{ color: 'var(--text-muted)', marginTop: 4 }}>Model push → {containers.find(c=>c.id===ollamaContainer)?.name}:</div>
                  <div style={{ color: 'var(--accent)', paddingLeft: 12 }}>📦 {selectedModel}</div>
                </>}
                {selectedKBs.length > 0 && <>
                  <div style={{ color: 'var(--text-muted)', marginTop: 4 }}>KB injection → {target?.name}:</div>
                  {selectedKBs.map(id => {
                    const kb = collections.find(c=>c.id===id)
                    return <div key={id} style={{ color: 'var(--green)', paddingLeft: 12 }}>🧠 {kb?.name} ({kb?.doc_count} chunks)</div>
                  })}
                </>}
              </div>
              <Hint type="info">These actions will be queued for your approval. Go to the Approvals tab to review and execute them.</Hint>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
                <Btn variant="ghost" onClick={() => setStep(3)}>← Back</Btn>
                <Btn variant="accent" onClick={handleQueueAll} loading={pushing}>
                  <Zap size={12} /> Queue All for Approval
                </Btn>
              </div>
            </div>
          )}

          {/* Step 5: Done */}
          {step === 5 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ textAlign: 'center', padding: '16px 0' }}>
                <div style={{ fontSize: 32, marginBottom: 8 }}>✅</div>
                <div style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 14 }}>Queued for approval!</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>Go to the Approvals tab to review and execute each action.</div>
              </div>
              {results.map((r, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', background: 'var(--bg-raised)', borderRadius: 'var(--radius)', border: '1px solid var(--border)', fontSize: 11 }}>
                  <Badge color={r.type === 'model' ? 'amber' : 'blue'}>{r.type}</Badge>
                  <span style={{ flex: 1 }}>{r.label}</span>
                  <span style={{ fontSize: 9, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{r.approvalId?.slice(0,8)}…</span>
                </div>
              ))}
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 4 }}>
                <Btn variant="accent" onClick={handleClose}>Done</Btn>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  )
}


// ── Main Docker page ──────────────────────────────────────────────────────────
export default function DockerPage() {
  const { collections, models } = useStore()
  const [containers, setContainers] = useState([])
  const [loading, setLoading] = useState(true)
  const [statsModal, setStatsModal] = useState({ open: false, container: null, data: null, loading: false })
  const [pushWizard, setPushWizard] = useState(false)

  const refresh = async () => {
    setLoading(true)
    try {
      const r = await api.get('/docker/containers')
      setContainers(r.data.containers || [])
    } catch { toast.error('Cannot connect to Docker daemon') }
    finally { setLoading(false) }
  }

  useEffect(() => { refresh() }, [])

  const handleStats = async container => {
    setStatsModal({ open: true, container, data: null, loading: true })
    try {
      const r = await api.get(`/docker/containers/${container.id}/stats`)
      setStatsModal(s => ({ ...s, data: r.data, loading: false }))
    } catch {
      setStatsModal(s => ({ ...s, loading: false }))
      toast.error('Stats unavailable — container may be stopped')
    }
  }

  const running = containers.filter(c => c.status === 'running').length
  const ollama  = containers.filter(c => c.is_ollama).length

  return (
    <div style={{ animation: 'fadeIn 0.2s ease' }}>
      <PageHelp
        steps={[
          'See all Docker containers on your host — KRONOS detects which ones have Ollama',
          'Click "Push Model + KB" to open the wizard — select a target container (e.g. arachne)',
          'Choose which model to push and which KB collections to inject',
          'Actions are queued for your approval, then executed with one click',
          'The target container gets the model + KB without re-downloading or re-embedding',
        ]}
        tips={[
          'Ollama containers are auto-detected by port 11434 or image name',
          'KB injection copies the ChromaDB collection directory — the target app needs to read it with PersistentClient',
          'Model push uses the target Ollama API — it connects to your host Ollama as source',
          'You can inject the same KB into multiple containers (e.g. arachne + another app)',
        ]}
      />

      <PageHeader
        title="Docker"
        subtitle="Container management · Push models and KB to external containers"
        action={
          <div style={{ display: 'flex', gap: 8 }}>
            <Btn variant="ghost" onClick={refresh} loading={loading}><RefreshCw size={12} /> refresh</Btn>
            <Btn variant="accent" onClick={() => setPushWizard(true)}>
              <Send size={12} /> Push Model + KB
            </Btn>
          </div>
        }
      />

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 20 }}>
        {[
          { label: 'Total',   value: containers.length },
          { label: 'Running', value: running,  color: 'var(--green)' },
          { label: 'Stopped', value: containers.length - running },
          { label: 'Ollama',  value: ollama,   color: 'var(--accent)' },
        ].map(s => (
          <div key={s.label} style={{ padding: '12px 16px', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)' }}>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 4 }}>{s.label}</div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 700, color: s.color || 'var(--text-primary)' }}>{s.value}</div>
          </div>
        ))}
      </div>

      <Card>
        <CardHeader>Containers</CardHeader>
        {loading && <div style={{ display: 'flex', justifyContent: 'center', padding: 32 }}><Spinner /></div>}
        {!loading && containers.length === 0 && <Empty icon="🐳" title="No containers" description="No Docker containers found." />}
        {!loading && containers.map(c => (
          <div key={c.id} style={{
            display: 'flex', alignItems: 'center', gap: 12,
            padding: '11px 16px', borderBottom: '1px solid var(--border)',
            transition: 'background 0.1s',
          }}
          onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-hover)'}
          onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
          >
            <StatusDot status={c.status === 'running' ? 'online' : 'offline'} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{c.name}</span>
                {c.is_ollama && <Badge color="amber">ollama</Badge>}
              </div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
                {c.image?.split('/').pop()} {c.ollama_host_port ? `· :${c.ollama_host_port}` : ''}
              </div>
            </div>
            <Badge color={STATUS_COLOR[c.status] || 'default'}>{c.status}</Badge>
            <Badge color="default">{c.id}</Badge>
            <Btn size="sm" variant="ghost" onClick={() => handleStats(c)}>
              <Cpu size={11} /> stats
            </Btn>
          </div>
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

      {/* Push wizard */}
      <PushWizard
        open={pushWizard}
        onClose={() => setPushWizard(false)}
        containers={containers}
        collections={collections}
        models={models}
      />
    </div>
  )
}
