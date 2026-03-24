import React, { useState, useRef, useEffect } from 'react'
import { HelpCircle, X, ExternalLink, BookOpen, Lightbulb, AlertCircle } from 'lucide-react'

// ── Tooltip ───────────────────────────────────────────────────────────────────
// Usage: <Help text="What this means" />
export function Help({ text, link }) {
  const [show, setShow] = useState(false)
  const ref = useRef()

  useEffect(() => {
    if (!show) return
    const handler = e => { if (ref.current && !ref.current.contains(e.target)) setShow(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [show])

  return (
    <span ref={ref} style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
      <button
        onClick={() => setShow(s => !s)}
        style={{
          background: 'none', border: 'none', cursor: 'pointer',
          color: 'var(--text-muted)', padding: '0 2px',
          display: 'inline-flex', alignItems: 'center',
          transition: 'color 0.1s',
        }}
        onMouseEnter={e => e.currentTarget.style.color = 'var(--accent)'}
        onMouseLeave={e => e.currentTarget.style.color = 'var(--text-muted)'}
      >
        <HelpCircle size={13} />
      </button>
      {show && (
        <div style={{
          position: 'absolute',
          top: 'calc(100% + 6px)',
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 200,
          width: 260,
          background: 'var(--bg-overlay)',
          border: '1px solid var(--border-mid)',
          borderRadius: 'var(--radius-lg)',
          padding: '10px 12px',
          fontSize: 11,
          color: 'var(--text-secondary)',
          lineHeight: 1.6,
          boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
          animation: 'fadeIn 0.1s ease',
        }}>
          {/* Arrow */}
          <div style={{
            position: 'absolute', top: -5, left: '50%', transform: 'translateX(-50%)',
            width: 8, height: 8,
            background: 'var(--bg-overlay)',
            border: '1px solid var(--border-mid)',
            borderRight: 'none', borderBottom: 'none',
            transform: 'translateX(-50%) rotate(45deg)',
          }} />
          <div>{text}</div>
          {link && (
            <a href={link} style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'var(--accent)', fontSize: 10, marginTop: 6 }}>
              <ExternalLink size={9} /> Learn more
            </a>
          )}
        </div>
      )}
    </span>
  )
}

// ── Inline hint bar ───────────────────────────────────────────────────────────
// Usage: <Hint type="info">Text</Hint>
export function Hint({ children, type = 'info', dismissible = false }) {
  const [dismissed, setDismissed] = useState(false)
  if (dismissed) return null

  const styles = {
    info:    { bg: 'var(--blue-dim)',   border: 'rgba(91,141,238,0.3)',   icon: <Lightbulb size={12} style={{ color: 'var(--blue)', flexShrink: 0 }} /> },
    tip:     { bg: 'var(--accent-subtle)', border: 'rgba(245,166,35,0.2)', icon: <Lightbulb size={12} style={{ color: 'var(--accent)', flexShrink: 0 }} /> },
    warning: { bg: 'var(--red-dim)',    border: 'rgba(242,107,107,0.3)',  icon: <AlertCircle size={12} style={{ color: 'var(--red)', flexShrink: 0 }} /> },
  }
  const s = styles[type] || styles.info

  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 8,
      padding: '8px 12px',
      background: s.bg,
      border: `1px solid ${s.border}`,
      borderRadius: 'var(--radius)',
      fontSize: 11,
      color: 'var(--text-secondary)',
      lineHeight: 1.6,
    }}>
      {s.icon}
      <span style={{ flex: 1 }}>{children}</span>
      {dismissible && (
        <button onClick={() => setDismissed(true)}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 0, flexShrink: 0 }}>
          <X size={11} />
        </button>
      )}
    </div>
  )
}

// ── Field label with help ─────────────────────────────────────────────────────
// Usage: <FieldLabel label="Model" help="The LLM used for chat responses" />
export function FieldLabel({ label, help }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 5 }}>
      <label style={{ fontSize: 11, color: 'var(--text-muted)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
        {label}
      </label>
      {help && <Help text={help} />}
    </div>
  )
}

// ── Page help panel (collapsible sidebar tip) ─────────────────────────────────
export function PageHelp({ title, steps, tips }) {
  const [open, setOpen] = useState(false)

  return (
    <div style={{ marginBottom: 16 }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          display: 'flex', alignItems: 'center', gap: 6,
          background: open ? 'var(--accent-subtle)' : 'transparent',
          border: `1px solid ${open ? 'rgba(245,166,35,0.3)' : 'var(--border)'}`,
          borderRadius: 'var(--radius)',
          padding: '5px 10px',
          cursor: 'pointer',
          color: open ? 'var(--accent)' : 'var(--text-muted)',
          fontSize: 11,
          fontFamily: 'var(--font-mono)',
          transition: 'all 0.12s',
        }}
      >
        <BookOpen size={12} />
        {open ? 'Hide guide' : 'How to use this page'}
      </button>

      {open && (
        <div style={{
          marginTop: 10,
          background: 'var(--bg-surface)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-lg)',
          padding: '14px 18px',
          animation: 'fadeIn 0.15s ease',
          display: 'grid',
          gridTemplateColumns: steps ? '1fr 1fr' : '1fr',
          gap: 16,
        }}>
          {steps && (
            <div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 10 }}>Steps</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {steps.map((step, i) => (
                  <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                    <div style={{
                      width: 18, height: 18, flexShrink: 0,
                      background: 'var(--accent-subtle)',
                      border: '1px solid rgba(245,166,35,0.3)',
                      borderRadius: '50%',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 9, color: 'var(--accent)', fontWeight: 600,
                    }}>{i + 1}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.5 }}>{step}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {tips && (
            <div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 10 }}>Tips</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {tips.map((tip, i) => (
                  <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                    <Lightbulb size={11} style={{ color: 'var(--accent)', flexShrink: 0, marginTop: 2 }} />
                    <div style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.5 }}>{tip}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
