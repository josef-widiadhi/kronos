import React, { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { Network, Zap, Play, ChevronDown, ChevronRight, Copy, ExternalLink } from 'lucide-react'
import { PageHeader } from '../components/layout/Layout'
import { PageHelp } from '../components/help'
import { Card, CardHeader, Badge, Btn, Select, Textarea, Input, Modal, Spinner, Empty, StatusDot, SectionLabel } from '../components/ui'
import { useStore } from '../hooks/useStore'
import api from '../api'

const TYPE_COLOR = { url_crawler: 'blue', db_learner: 'purple', folder_watcher: 'amber', rag_validator: 'green', custom: 'default' }

function ToolBadge({ tool }) {
  return (
    <div style={{
      padding: '4px 10px',
      background: 'var(--bg-raised)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius)',
      fontSize: 11,
      fontFamily: 'var(--font-mono)',
      color: 'var(--text-secondary)',
      display: 'flex', alignItems: 'center', gap: 6,
    }}>
      <Zap size={9} style={{ color: 'var(--accent)' }} />
      {tool}
    </div>
  )
}

function AgentMCPCard({ agent, onCall }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div style={{
      background: 'var(--bg-surface)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius-lg)',
      overflow: 'hidden',
    }}>
      <div
        onClick={() => setExpanded(e => !e)}
        style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '13px 16px', cursor: 'pointer',
          borderBottom: expanded ? '1px solid var(--border)' : 'none',
          transition: 'background 0.1s',
        }}
        onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-hover)'}
        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
      >
        <StatusDot status={agent.status === 'running' ? 'online' : 'offline'} />
        <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 13, flex: 1 }}>{agent.name}</span>
        <Badge color={TYPE_COLOR[agent.type] || 'default'}>{agent.type.replace('_', ' ')}</Badge>
        <Badge color={agent.status === 'running' ? 'green' : 'default'}>{agent.status}</Badge>
        {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
      </div>

      {expanded && (
        <div style={{ padding: '14px 16px', animation: 'fadeIn 0.15s ease' }}>
          {/* Endpoint */}
          <div style={{ marginBottom: 12 }}>
            <SectionLabel>MCP Endpoint</SectionLabel>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '7px 10px',
              background: 'var(--bg-base)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius)',
              fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--accent)',
            }}>
              <span style={{ flex: 1 }}>POST /api/mcp/agents/{agent.id}/call</span>
              <button
                onClick={() => { navigator.clipboard.writeText(`/api/mcp/agents/${agent.id}/call`); toast.success('Copied') }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 2 }}
              >
                <Copy size={11} />
              </button>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
              <div style={{ padding: '4px 8px', background: 'var(--bg-raised)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                SSE: /api/mcp/agents/{agent.id}/sse
              </div>
              <div style={{ padding: '4px 8px', background: 'var(--bg-raised)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                tools: /api/mcp/agents/{agent.id}/tools
              </div>
            </div>
          </div>

          {/* Tools */}
          <div style={{ marginBottom: 12 }}>
            <SectionLabel>Available Tools ({agent.tools?.length || 0})</SectionLabel>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {agent.tools?.map(t => <ToolBadge key={t} tool={t} />)}
            </div>
          </div>

          {/* Call tool button */}
          {agent.status !== 'staged' && (
            <Btn size="sm" variant="accent" onClick={() => onCall(agent)}>
              <Play size={11} /> Invoke Tool
            </Btn>
          )}
          {agent.status === 'staged' && (
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Deploy this agent to invoke tools</div>
          )}
        </div>
      )}
    </div>
  )
}

export default function MCPPage() {
  const { agents } = useStore()
  const [mcpAgents, setMcpAgents] = useState([])
  const [loading, setLoading] = useState(true)
  const [callModal, setCallModal] = useState({ open: false, agent: null, tool: '', args: '{}', result: null, running: false })
  const [orchModal, setOrchModal] = useState({ open: false })
  const [orchForm, setOrchForm] = useState({ task: '', strategy: 'parallel', agent_ids: [] })
  const [orchResult, setOrchResult] = useState(null)
  const [orching, setOrching] = useState(false)

  const refresh = async () => {
    setLoading(true)
    try {
      const r = await api.get('/mcp/agents')
      setMcpAgents(r.data.agents || [])
    } catch { toast.error('Failed to load MCP agents') }
    finally { setLoading(false) }
  }

  useEffect(() => { refresh() }, [])

  const handleCallTool = async () => {
    const { agent, tool, args } = callModal
    let parsedArgs = {}
    try { parsedArgs = JSON.parse(args) } catch { return toast.error('Invalid JSON arguments') }

    setCallModal(s => ({ ...s, running: true, result: null }))
    try {
      const r = await api.post(`/mcp/agents/${agent.id}/call`, {
        tool_name: tool,
        arguments: parsedArgs,
      })
      setCallModal(s => ({ ...s, result: r.data, running: false }))
    } catch (e) {
      setCallModal(s => ({ ...s, result: { error: e.response?.data?.detail || e.message }, running: false }))
      toast.error('Tool call failed')
    }
  }

  const handleOrchestrate = async () => {
    if (!orchForm.task.trim()) return toast.error('Enter a task')
    setOrching(true)
    setOrchResult(null)
    try {
      const r = await api.post('/mcp/orchestrate', {
        task: orchForm.task,
        strategy: orchForm.strategy,
        agent_ids: orchForm.agent_ids.length ? orchForm.agent_ids : null,
      })
      setOrchResult(r.data)
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Orchestration failed')
    } finally { setOrching(false) }
  }

  const running  = mcpAgents.filter(a => a.status === 'running').length
  const staged   = mcpAgents.filter(a => a.status === 'staged').length

  return (
    <div style={{ animation: 'fadeIn 0.2s ease' }}>
      <PageHelp
        steps={[
          'Deploy agents in the Agents tab first — they appear here automatically',
          'Expand an agent to see its MCP endpoint and available tools',
          'Use "Invoke Tool" to test a tool call directly from the browser',
          'Use "Orchestrate" to send one task to multiple agents simultaneously',
        ]}
        tips={[
          'Each agent type gets different tools: url_crawler → web queries, folder_watcher → document queries',
          'The SSE endpoint (/mcp/sse) is for Claude Desktop and other MCP-compatible clients',
          'parallel strategy: all agents answer, results merged (best coverage)',
          'best_of strategy: picks the agent with highest relevance score (most confident answer)',
        ]}
      />
      <PageHeader
        title="MCP Layer"
        subtitle="Agents as MCP tool servers · Agent-to-agent orchestration"
        action={
          <div style={{ display: 'flex', gap: 8 }}>
            <Btn variant="ghost" onClick={refresh} loading={loading}>↻ refresh</Btn>
            <Btn variant="accent" onClick={() => setOrchModal({ open: true })}>
              <Network size={12} /> Orchestrate
            </Btn>
          </div>
        }
      />

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 20 }}>
        {[
          { label: 'MCP Agents', value: mcpAgents.length },
          { label: 'Running', value: running, color: 'var(--green)' },
          { label: 'Staged', value: staged },
          { label: 'Total Tools', value: mcpAgents.reduce((acc, a) => acc + (a.tools?.length || 0), 0), color: 'var(--accent)' },
        ].map(s => (
          <div key={s.label} style={{ padding: '12px 16px', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)' }}>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 4 }}>{s.label}</div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 700, color: s.color || 'var(--text-primary)' }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Protocol info */}
      <div style={{
        padding: '12px 16px', marginBottom: 20,
        background: 'var(--accent-subtle)', border: '1px solid rgba(245,166,35,0.2)',
        borderRadius: 'var(--radius-lg)', fontSize: 11, color: 'var(--text-secondary)',
        display: 'flex', gap: 24,
      }}>
        <div><span style={{ color: 'var(--accent)' }}>POST</span> /api/mcp/agents/:id/call — invoke tool</div>
        <div><span style={{ color: 'var(--accent)' }}>GET</span> /api/mcp/agents/:id/tools — list tools</div>
        <div><span style={{ color: 'var(--accent)' }}>GET</span> /api/mcp/agents/:id/sse — SSE stream</div>
        <div><span style={{ color: 'var(--accent)' }}>POST</span> /api/mcp/orchestrate — multi-agent task</div>
      </div>

      {loading && <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}><Spinner size={24} /></div>}

      {!loading && mcpAgents.length === 0 && (
        <Empty icon="🔌" title="No agents" description="Create agents in the Agents tab. All agents are automatically MCP-capable." />
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {mcpAgents.map(agent => (
          <AgentMCPCard
            key={agent.id}
            agent={agent}
            onCall={a => setCallModal({ open: true, agent: a, tool: a.tools?.[0] || '', args: '{}', result: null, running: false })}
          />
        ))}
      </div>

      {/* Tool call modal */}
      <Modal open={callModal.open} onClose={() => setCallModal({ ...callModal, open: false })} title={`Call tool · ${callModal.agent?.name}`} width={580}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Select label="Tool" value={callModal.tool} onChange={e => setCallModal(s => ({ ...s, tool: e.target.value }))}>
            {callModal.agent?.tools?.map(t => <option key={t} value={t}>{t}</option>)}
          </Select>
          <Textarea
            label="Arguments (JSON)"
            value={callModal.args}
            onChange={e => setCallModal(s => ({ ...s, args: e.target.value }))}
            style={{ minHeight: 80, fontFamily: 'var(--font-mono)' }}
            placeholder='{"query": "your question here"}'
          />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Btn variant="ghost" onClick={() => setCallModal(s => ({ ...s, open: false }))}>cancel</Btn>
            <Btn variant="accent" onClick={handleCallTool} loading={callModal.running}>
              <Play size={11} /> Invoke
            </Btn>
          </div>

          {callModal.result && (
            <div>
              <SectionLabel>Result</SectionLabel>
              <pre style={{
                fontSize: 11, fontFamily: 'var(--font-mono)',
                background: 'var(--bg-base)', borderRadius: 'var(--radius)',
                padding: 12, maxHeight: 320, overflow: 'auto',
                color: callModal.result.is_error ? 'var(--red)' : 'var(--text-secondary)',
                border: '1px solid var(--border)', whiteSpace: 'pre-wrap',
              }}>
                {JSON.stringify(callModal.result, null, 2)}
              </pre>
            </div>
          )}
        </div>
      </Modal>

      {/* Orchestration modal */}
      <Modal open={orchModal.open} onClose={() => setOrchModal({ open: false })} title="Multi-Agent Orchestration" width={620}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ padding: '8px 12px', background: 'var(--bg-raised)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', fontSize: 11, color: 'var(--text-secondary)' }}>
            Send a task to multiple agents simultaneously. Strategies:<br/>
            <span style={{ color: 'var(--accent)' }}>parallel</span> — all agents answer, results merged ·
            <span style={{ color: 'var(--blue)' }}> sequential</span> — chain agents, pass context forward ·
            <span style={{ color: 'var(--green)' }}> best_of</span> — pick highest-relevance answer
          </div>

          <Textarea
            label="Task"
            value={orchForm.task}
            onChange={e => setOrchForm(f => ({ ...f, task: e.target.value }))}
            placeholder="What do you want the agents to work on?"
            style={{ minHeight: 70 }}
          />

          <Select label="Strategy" value={orchForm.strategy} onChange={e => setOrchForm(f => ({ ...f, strategy: e.target.value }))}>
            <option value="parallel">parallel — all agents, merge results</option>
            <option value="sequential">sequential — chain with context</option>
            <option value="best_of">best_of — pick highest relevance</option>
          </Select>

          <div>
            <label style={{ fontSize: 11, color: 'var(--text-muted)', letterSpacing: '0.04em', textTransform: 'uppercase', display: 'block', marginBottom: 6 }}>
              Target Agents (leave empty for all running)
            </label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {mcpAgents.filter(a => a.status === 'running').map(a => (
                <label key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={orchForm.agent_ids.includes(a.id)}
                    onChange={e => setOrchForm(f => ({
                      ...f,
                      agent_ids: e.target.checked
                        ? [...f.agent_ids, a.id]
                        : f.agent_ids.filter(id => id !== a.id)
                    }))}
                    style={{ accentColor: 'var(--accent)' }}
                  />
                  <StatusDot status="online" />
                  <span>{a.name}</span>
                  <Badge color={TYPE_COLOR[a.type] || 'default'}>{a.type.replace('_', ' ')}</Badge>
                </label>
              ))}
              {mcpAgents.filter(a => a.status === 'running').length === 0 && (
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>No running agents. Deploy some agents first.</div>
              )}
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Btn variant="ghost" onClick={() => setOrchModal({ open: false })}>cancel</Btn>
            <Btn variant="accent" onClick={handleOrchestrate} loading={orching}>
              <Network size={11} /> Orchestrate
            </Btn>
          </div>

          {orchResult && (
            <div>
              <SectionLabel>Orchestration Result · {orchResult.strategy}</SectionLabel>
              {orchResult.responses?.map((r, i) => (
                <div key={i} style={{
                  marginBottom: 8, padding: '10px 12px',
                  background: 'var(--bg-base)', border: '1px solid var(--border)',
                  borderRadius: 'var(--radius)',
                }}>
                  <div style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
                    <span style={{ fontFamily: 'var(--font-display)', fontSize: 12, fontWeight: 600 }}>{r.agent_name}</span>
                    {r.error && <Badge color="red">error</Badge>}
                    {orchResult.winner?.agent_id === r.agent_id && <Badge color="green">winner</Badge>}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)', whiteSpace: 'pre-wrap' }}>
                    {r.error ? r.error : (r.result?.reply || JSON.stringify(r.result, null, 2))?.slice(0, 300)}
                    {(r.result?.reply?.length > 300) ? '…' : ''}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </Modal>
    </div>
  )
}
