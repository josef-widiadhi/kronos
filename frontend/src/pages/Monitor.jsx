import React, { useEffect, useState } from 'react'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, AreaChart, Area } from 'recharts'
import { Activity, Cpu, MemoryStick, Zap, AlertCircle } from 'lucide-react'
import { PageHeader } from '../components/layout/Layout'
import { Card, CardHeader, StatusDot, Badge, StatBox, Empty, Spinner } from '../components/ui'
import { monitorOverview } from '../api'
import { useStore } from '../hooks/useStore'

const STATUS_COLOR = {
  running: 'green', staged: 'default', deploying: 'amber',
  stopped: 'default', error: 'red',
}

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null
  return (
    <div style={{ background: 'var(--bg-overlay)', border: '1px solid var(--border-mid)', borderRadius: 6, padding: '6px 10px', fontSize: 11 }}>
      {payload.map((p, i) => (
        <div key={i} style={{ color: p.color }}>{p.name}: {p.value?.toFixed?.(1) ?? p.value}{p.unit}</div>
      ))}
    </div>
  )
}

function AgentCard({ agent, history }) {
  const cpuData  = (history || []).map((s, i) => ({ t: i, cpu: s.cpu, mem: s.mem }))

  return (
    <Card>
      <div style={{ padding: '14px 16px' }}>
        {/* Header row */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <StatusDot status={agent.status} />
            <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 13 }}>{agent.name}</span>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <Badge color={STATUS_COLOR[agent.status] || 'default'}>{agent.status}</Badge>
            <Badge color="default">{agent.type.replace('_', ' ')}</Badge>
          </div>
        </div>

        {/* Model */}
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 12, fontFamily: 'var(--font-mono)' }}>
          model: <span style={{ color: 'var(--accent)' }}>{agent.model}</span>
        </div>

        {/* Activity */}
        {agent.activity && (
          <div style={{
            background: 'var(--bg-raised)', borderRadius: 'var(--radius)',
            padding: '7px 10px', marginBottom: 12,
            border: '1px solid var(--border)',
            fontSize: 11, color: 'var(--text-secondary)',
            display: 'flex', alignItems: 'center', gap: 7,
          }}>
            <Zap size={11} style={{ color: 'var(--accent)', flexShrink: 0 }} />
            <span className="truncate">{agent.activity.last_query || 'Idle'}</span>
            {agent.activity.query_count > 0 && (
              <span style={{ color: 'var(--text-muted)', flexShrink: 0 }}>{agent.activity.query_count} queries</span>
            )}
          </div>
        )}

        {/* Stats row */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
          <div style={{ background: 'var(--bg-raised)', borderRadius: 'var(--radius)', padding: '8px 10px', border: '1px solid var(--border)' }}>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 3, letterSpacing: '0.06em' }}>CPU</div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 700, color: agent.cpu_percent > 70 ? 'var(--red)' : 'var(--text-primary)' }}>
              {agent.cpu_percent != null ? `${agent.cpu_percent}%` : '—'}
            </div>
          </div>
          <div style={{ background: 'var(--bg-raised)', borderRadius: 'var(--radius)', padding: '8px 10px', border: '1px solid var(--border)' }}>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 3, letterSpacing: '0.06em' }}>MEM</div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 700, color: 'var(--text-primary)' }}>
              {agent.memory_mb != null ? `${agent.memory_mb}M` : '—'}
            </div>
          </div>
        </div>

        {/* CPU chart */}
        {cpuData.length > 2 && (
          <div style={{ height: 52 }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={cpuData} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id={`grad-${agent.id}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="var(--accent)" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <Area type="monotone" dataKey="cpu" stroke="var(--accent)" strokeWidth={1.5}
                  fill={`url(#grad-${agent.id})`} dot={false} isAnimationActive={false} name="CPU%" unit="%" />
                <Tooltip content={<CustomTooltip />} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
        {cpuData.length <= 2 && agent.status === 'running' && (
          <div style={{ height: 52, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: 11 }}>
            collecting data…
          </div>
        )}
      </div>
    </Card>
  )
}

export default function Monitor() {
  const [overview, setOverview] = useState([])
  const [loading, setLoading] = useState(true)
  const { monitorHistory, pushMonitorSample } = useStore()

  const refresh = async () => {
    try {
      const r = await monitorOverview()
      setOverview(r.data.agents || [])
      r.data.agents?.forEach(a => {
        if (a.cpu_percent != null) {
          pushMonitorSample(a.id, {
            ts: Date.now(),
            cpu: a.cpu_percent,
            mem: a.memory_mb,
          })
        }
      })
    } catch {}
    setLoading(false)
  }

  useEffect(() => {
    refresh()
    const t = setInterval(refresh, 4000)
    return () => clearInterval(t)
  }, [])

  const running  = overview.filter(a => a.status === 'running').length
  const staged   = overview.filter(a => a.status === 'staged').length
  const errors   = overview.filter(a => a.status === 'error').length

  return (
    <div style={{ animation: 'fadeIn 0.2s ease' }}>
      <PageHeader
        title="Monitor"
        subtitle="Real-time view of all agents"
        action={
          <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            <StatusDot status="online" />
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Live · 4s</span>
          </div>
        }
      />

      {/* Summary stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 24 }}>
        <StatBox label="Total Agents" value={overview.length} />
        <StatBox label="Running" value={running} color="var(--green)" />
        <StatBox label="Staged" value={staged} color="var(--text-muted)" />
        <StatBox label="Errors" value={errors} color={errors > 0 ? 'var(--red)' : 'var(--text-muted)'} />
      </div>

      {loading && (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}>
          <Spinner size={24} />
        </div>
      )}

      {!loading && overview.length === 0 && (
        <Empty icon="⚡" title="No agents yet" description="Create and deploy agents to see them monitored here." />
      )}

      {!loading && overview.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 14 }}>
          {overview.map(agent => (
            <AgentCard key={agent.id} agent={agent} history={monitorHistory[agent.id]} />
          ))}
        </div>
      )}
    </div>
  )
}
