import React, { useState, useEffect } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import {
  Terminal, Database, Box, Cpu, Activity,
  MessageSquare, ShieldCheck, LogOut, ChevronRight, Network, BookOpen, HelpCircle, Shield, FlaskConical, Settings, Globe,
} from 'lucide-react'
import { useStore } from '../../hooks/useStore'
import { StatusDot, Badge } from '../ui'
import { getApprovals, ollamaStatus, ollamaModels, getCollections } from '../../api'

const NAV = [
  { to: '/',         icon: Activity,      label: 'Monitor',  exact: true },
  { to: '/ollama',   icon: Terminal,      label: 'Ollama'  },
  { to: '/rag',      icon: Database,      label: 'RAG / KB' },
  { to: '/docker',   icon: Box,           label: 'Docker'  },
  { to: '/agents',    icon: Cpu,           label: 'Agents'   },
  { to: '/mcp',       icon: Network,       label: 'MCP'      },
  { to: '/pentest',   icon: Shield,        label: 'Pentest KB'  },
  { to: '/finetune',  icon: FlaskConical,  label: 'Fine-Tune'   },
  { to: '/chat',      icon: MessageSquare, label: 'Chat Test' },
  { to: '/approvals',icon: ShieldCheck,   label: 'Approvals' },
  { separator: true },
  { to: '/watchers',  icon: Globe,         label: 'URL Watchers' },
  { to: '/wiki',      icon: BookOpen,      label: 'Wiki'      },
  { to: '/howto',     icon: HelpCircle,    label: 'How-To'    },
  { to: '/settings',  icon: Settings,      label: 'Settings'  },
]

export function Sidebar() {
  const { ollamaStatus: status, approvals, logout } = useStore()
  const pendingCount = approvals.filter(a => a.status === 'pending').length

  return (
    <aside style={{
      width: 'var(--sidebar-w)',
      background: 'var(--bg-surface)',
      borderRight: '1px solid var(--border)',
      display: 'flex',
      flexDirection: 'column',
      flexShrink: 0,
      position: 'relative',
      zIndex: 10,
    }}>
      {/* Logo */}
      <div style={{
        height: 'var(--header-h)',
        display: 'flex',
        alignItems: 'center',
        padding: '0 18px',
        borderBottom: '1px solid var(--border)',
        gap: 10,
      }}>
        <div style={{
          width: 28, height: 28,
          background: 'var(--accent)',
          borderRadius: 6,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <span style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 12, color: 'var(--bg-base)' }}>K</span>
        </div>
        <div>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 13, letterSpacing: '0.05em' }}>KRONOS</div>
          <div style={{ fontSize: 9, color: 'var(--text-muted)', letterSpacing: '0.06em' }}>AI OPERATOR</div>
        </div>
      </div>

      {/* Ollama status pill */}
      <div style={{ padding: '12px 14px 8px', borderBottom: '1px solid var(--border)' }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 7,
          background: 'var(--bg-raised)', borderRadius: 6,
          padding: '6px 10px',
          border: '1px solid var(--border)',
        }}>
          <StatusDot status={status?.api_reachable ? 'online' : 'offline'} />
          <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
            Ollama {status?.api_reachable ? status.api_version || 'online' : 'offline'}
          </span>
        </div>
      </div>

      {/* Nav */}
      <nav style={{ flex: 1, padding: '10px 10px', display: 'flex', flexDirection: 'column', gap: 2 }}>
        {NAV.map((item, idx) => {
            if (item.separator) {
              return <div key={`sep-${idx}`} style={{ height: 1, background: 'var(--border)', margin: '4px 10px' }} />
            }
            const { to, icon: Icon, label, exact } = item
            return (
          <NavLink
            key={to}
            to={to}
            end={exact}
            style={({ isActive }) => ({
              display: 'flex',
              alignItems: 'center',
              gap: 9,
              padding: '7px 10px',
              borderRadius: 'var(--radius)',
              color: isActive ? 'var(--accent)' : 'var(--text-secondary)',
              background: isActive ? 'var(--accent-subtle)' : 'transparent',
              border: `1px solid ${isActive ? 'rgba(245,166,35,0.2)' : 'transparent'}`,
              fontSize: 12,
              fontFamily: 'var(--font-mono)',
              transition: 'all 0.12s',
              textDecoration: 'none',
            })}
          >
            {({ isActive }) => (
              <>
                <Icon size={14} />
                <span style={{ flex: 1 }}>{label}</span>
                {label === 'Approvals' && pendingCount > 0 && (
                  <Badge color="amber">{pendingCount}</Badge>
                )}
                {isActive && <ChevronRight size={11} style={{ opacity: 0.6 }} />}
              </>
            )}
          </NavLink>
        )
        })}
      </nav>

      {/* Footer */}
      <div style={{ padding: '10px 14px', borderTop: '1px solid var(--border)' }}>
        <button
          onClick={logout}
          style={{
            display: 'flex', alignItems: 'center', gap: 8,
            color: 'var(--text-muted)', fontSize: 12,
            background: 'none', border: 'none', cursor: 'pointer',
            padding: '6px 0', width: '100%',
            transition: 'color 0.12s',
          }}
          onMouseEnter={e => e.currentTarget.style.color = 'var(--red)'}
          onMouseLeave={e => e.currentTarget.style.color = 'var(--text-muted)'}
        >
          <LogOut size={13} />
          logout
        </button>
      </div>
    </aside>
  )
}

export function AppLayout({ children }) {
  const { setOllamaStatus, setApprovals, setModels, setCollections } = useStore()

  useEffect(() => {
    // Poll ollama status every 10s
    const pollOllama = async () => {
      try {
        const r = await ollamaStatus()
        setOllamaStatus(r.data)
      } catch {}
    }
    const pollModels = async () => {
      try {
        const r = await ollamaModels()
        setModels(r.data.models || [])
      } catch {}
    }
    const pollCollections = async () => {
      try {
        const r = await getCollections()
        setCollections(r.data || [])
      } catch {}
    }
    const pollApprovals = async () => {
      try {
        const r = await getApprovals()
        setApprovals(r.data)
      } catch {}
    }
    pollOllama()
    pollApprovals()
    pollModels()
    pollCollections()
    const t1 = setInterval(pollOllama, 10000)
    const t2 = setInterval(pollApprovals, 5000)
    const t3 = setInterval(pollModels, 30000)
    const t4 = setInterval(pollCollections, 20000)
    return () => { clearInterval(t1); clearInterval(t2); clearInterval(t3); clearInterval(t4) }
  }, [])

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', position: 'relative', zIndex: 1 }}>
      <Sidebar />
      <main style={{ flex: 1, overflow: 'auto', padding: '24px 28px' }}>
        {children}
      </main>
    </div>
  )
}

// ── Page header ───────────────────────────────────────────────────────────────
export function PageHeader({ title, subtitle, action }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
      marginBottom: 24,
      animation: 'slideIn 0.2s ease',
    }}>
      <div>
        <h1 style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 22, color: 'var(--text-primary)', letterSpacing: '-0.01em' }}>
          {title}
        </h1>
        {subtitle && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>{subtitle}</div>}
      </div>
      {action}
    </div>
  )
}
