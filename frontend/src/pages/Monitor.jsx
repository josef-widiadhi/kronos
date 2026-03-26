import React, { useEffect, useState } from 'react'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, AreaChart, Area } from 'recharts'
import { Activity, RefreshCw, CheckCircle, XCircle, AlertCircle } from 'lucide-react'
import { PageHeader } from '../components/layout/Layout'
import { Card, CardHeader, Badge, Btn, StatusDot, Empty, Spinner } from '../components/ui'
import { monitorOverview } from '../api'
import { useStore } from '../hooks/useStore'
import api from '../api'

const STATUS_COLOR = { running: 'green', staged: 'default', deploying: 'amber', stopped: 'default', error: 'red' }

const CustomTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) return null
  return (
    <div style={{ background: 'var(--bg-overlay)', border: '1px solid var(--border-mid)', borderRadius: 6, padding: '6px 10px', fontSize: 11 }}>
      {payload.map((p, i) => (
        <div key={i} style={{ color: p.color }}>{p.name}: {p.value?.toFixed?.(1) ?? p.value}{p.unit}</div>
      ))}
    </div>
  )
}

function ServicePill({ name, status }) {
  const ok = status?.ok
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      padding: '8px 14px',
      background: ok ? 'rgba(61,214,140,0.06)' : 'rgba(242,107,107,0.06)',
      border: `1px solid ${ok ? 'rgba(61,214,140,0.2)' : 'rgba(242,107,107,0.2)'}`,
      borderRadius: 'var(--radius-lg)',
    }}>
      {ok
        ? <CheckCircle size={13} style={{ color: 'var(--green)', flexShrink: 0 }} />
        : <XCircle size={13} style={{ color: 'var(--red)', flexShrink: 0 }} />}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: ok ? 'var(--green)' : 'var(--red)' }}>{name}</div>
        {status?.version && <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{status.version}</div>}
        {status?.error && <div style={{ fontSize: 10, color: 'var(--red)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{status.error}</div>}
        {status?.note && !status.error && <div style={{ fontSize: 10, color: ok ? 'var(--text-muted)' : 'var(--amber)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{status.note}</div>}
        {status?.running !== undefined && <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{status.running} running</div>}
      </div>
    </div>
  )
}

function AgentCard({ agent, history }) {
  const cpuData = (history || []).map((s, i) => ({ t: i, cpu: s.cpu, mem: s.mem }))
  return (
    <Card>
      <div style={{ padding: '14px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <StatusDot status={agent.status} />
            <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 13 }}>{agent.name}</span>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <Badge color={STATUS_COLOR[agent.status] || 'default'}>{agent.status}</Badge>
            <Badge color="default">{agent.type?.replace('_', ' ')}</Badge>
          </div>
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 10, fontFamily: 'var(--font-mono)' }}>
          {agent.model} {agent.container_name ? `· ${agent.container_name}` : ''}
        </div>

        {agent.status === 'running' && cpuData.length > 1 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              {[
                { key: 'cpu', label: 'CPU %', color: 'var(--accent)', unit: '%', current: agent.cpu_percent },
                { key: 'mem', label: 'Mem MB', color: 'var(--blue)', unit: 'MB', current: agent.memory_mb },
              ].map(m => (
                <div key={m.key}>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 4, display: 'flex', justifyContent: 'space-between' }}>
                    <span>{m.label}</span>
                    <span style={{ color: m.color }}>{m.current?.toFixed(1)}{m.unit}</span>
                  </div>
                  <ResponsiveContainer width="100%" height={40}>
                    <AreaChart data={cpuData}>
                      <Area type="monotone" dataKey={m.key} stroke={m.color} fill={m.color} fillOpacity={0.1} dot={false} />
                      <Tooltip content={<CustomTooltip />} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              ))}
            </div>
            {/* Memory limit bar */}
            {agent.mem_limit_mb > 0 && agent.memory_mb != null && (() => {
              const pct = Math.min((agent.memory_mb / agent.mem_limit_mb) * 100, 100)
              const barColor = pct > 85 ? 'var(--red)' : pct > 65 ? 'var(--amber)' : 'var(--blue)'
              return (
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text-muted)', marginBottom: 3 }}>
                    <span>Memory limit</span>
                    <span style={{ color: barColor }}>{agent.memory_mb?.toFixed(0)} / {agent.mem_limit_mb} MB ({pct.toFixed(0)}%)</span>
                  </div>
                  <div style={{ height: 4, background: 'var(--bg-raised)', borderRadius: 2, overflow: 'hidden' }}>
                    <div style={{ width: `${pct}%`, height: '100%', background: barColor, borderRadius: 2, transition: 'width 0.5s, background 0.3s' }} />
                  </div>
                  {pct > 85 && (
                    <div style={{ fontSize: 10, color: 'var(--red)', marginTop: 3 }}>
                      ⚠ Near limit — consider increasing mem_limit_mb in agent settings
                    </div>
                  )}
                </div>
              )
            })()}
          </div>
        ) : agent.status === 'running' ? (
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Collecting metrics…</div>
        ) : (
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            {agent.status === 'staged' ? 'Not deployed yet. Go to Agents → Deploy.' : `Status: ${agent.status}`}
          </div>
        )}

        {agent.activity && (
          <div style={{ marginTop: 8, padding: '6px 8px', background: 'var(--bg-raised)', borderRadius: 'var(--radius)', fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>
            {agent.activity.status} · {agent.activity.query_count} queries
            {agent.activity.last_query && ` · last: "${agent.activity.last_query?.slice(0, 40)}…"`}
          </div>
        )}
      </div>
    </Card>
  )
}

export default function MonitorPage() {
  const [overview, setOverview] = useState({ agents: [], total: 0 })
  const [sysHealth, setSysHealth] = useState(null)
  const [loading, setLoading] = useState(true)
  const { monitorHistory, pushMonitorSample } = useStore()

  const refresh = async () => {
    try {
      const [o, s] = await Promise.all([
        monitorOverview(),
        api.get('/monitor/system'),
      ])
      setOverview(o.data)
      setSysHealth(s.data)

      // Push stats into store for sparklines
      for (const agent of o.data.agents || []) {
        if (agent.cpu_percent != null) {
          pushMonitorSample(agent.id, { cpu: agent.cpu_percent, mem: agent.memory_mb || 0, ts: Date.now() })
        }
      }
    } catch {}
    finally { setLoading(false) }
  }

  useEffect(() => {
    refresh()
    const t = setInterval(refresh, 5000)
    return () => clearInterval(t)
  }, [])

  const running = overview.agents?.filter(a => a.status === 'running').length || 0
  const services = sysHealth?.services || {}

  return (
    <div style={{ animation: 'fadeIn 0.2s ease' }}>
      <PageHeader
        title="Monitor"
        subtitle="System health and agent activity"
        action={<Btn variant="ghost" size="sm" onClick={refresh} loading={loading}><RefreshCw size={12} /></Btn>}
      />

      {/* System health row */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Services</div>
        {sysHealth ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10 }}>
            {[
              { name: 'Ollama',    status: services.ollama    },
              { name: 'ChromaDB', status: services.chromadb  },
              { name: 'Redis',    status: services.redis     },
              { name: 'Docker',   status: services.docker    },
              { name: 'LiteParse PDF', status: services.liteparse },
            ].map(s => <ServicePill key={s.name} {...s} />)}
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
            {['Ollama', 'ChromaDB', 'Redis', 'Docker'].map(n => (
              <div key={n} style={{ height: 48, background: 'var(--bg-raised)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border)' }} />
            ))}
          </div>
        )}
      </div>

      {/* Agent stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 20 }}>
        {[
          { label: 'Total Agents', value: overview.total },
          { label: 'Running',      value: running, color: running > 0 ? 'var(--green)' : undefined },
          { label: 'Staged',       value: overview.agents?.filter(a => a.status === 'staged').length || 0 },
          { label: 'Error',        value: overview.agents?.filter(a => a.status === 'error').length || 0, color: 'var(--red)' },
        ].map(s => (
          <div key={s.label} style={{ padding: '12px 16px', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)' }}>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 4 }}>{s.label}</div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 700, color: s.color || 'var(--text-primary)' }}>{s.value}</div>
          </div>
        ))}
      </div>

      {loading && !overview.agents?.length && (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}><Spinner /></div>
      )}

      {!loading && overview.agents?.length === 0 && (
        <Empty icon="📊" title="No agents yet"
          description="Go to Agents → Seed Default Workers to create agents, then deploy them to see live metrics here." />
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(380px, 1fr))', gap: 14 }}>
        {overview.agents?.map(agent => (
          <AgentCard key={agent.id} agent={agent} history={monitorHistory[agent.id]} />
        ))}
      </div>
    </div>
  )
}
