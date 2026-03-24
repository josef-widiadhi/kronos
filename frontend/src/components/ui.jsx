import React, { useState } from 'react'
import { Loader2 } from 'lucide-react'

// ── Button ────────────────────────────────────────────────────────────────────
export function Btn({ children, variant = 'default', size = 'md', loading, disabled, onClick, className = '', ...props }) {
  const base = `
    inline-flex items-center gap-1.5 border rounded font-mono font-medium
    transition-all duration-150 cursor-pointer select-none
    disabled:opacity-40 disabled:cursor-not-allowed
  `
  const sizes = {
    sm: 'px-2.5 py-1 text-[11px]',
    md: 'px-3.5 py-1.5 text-[12px]',
    lg: 'px-5 py-2 text-[13px]',
  }
  const variants = {
    default: 'bg-bg-raised border-border-mid text-text-secondary hover:border-accent hover:text-accent',
    accent:  'bg-accent border-accent text-bg-base hover:brightness-110',
    ghost:   'bg-transparent border-transparent text-text-muted hover:text-text-primary hover:bg-bg-hover',
    danger:  'bg-red-dim border-red text-red hover:brightness-110',
    success: 'bg-green-dim border-green text-green hover:brightness-110',
  }

  return (
    <button
      className={`${base} ${sizes[size]} ${variants[variant]} ${className}`}
      style={{ fontFamily: 'var(--font-mono)' }}
      disabled={disabled || loading}
      onClick={onClick}
      {...props}
    >
      {loading
        ? <Loader2 size={11} style={{ animation: 'spin 0.8s linear infinite' }} />
        : null}
      {children}
    </button>
  )
}

// ── Badge ─────────────────────────────────────────────────────────────────────
export function Badge({ children, color = 'default' }) {
  const colors = {
    default: { bg: 'var(--bg-overlay)', color: 'var(--text-secondary)', border: 'var(--border-mid)' },
    green:   { bg: 'var(--green-dim)', color: 'var(--green)', border: 'rgba(61,214,140,0.3)' },
    red:     { bg: 'var(--red-dim)', color: 'var(--red)', border: 'rgba(242,107,107,0.3)' },
    amber:   { bg: 'var(--accent-subtle)', color: 'var(--accent)', border: 'rgba(245,166,35,0.3)' },
    blue:    { bg: 'var(--blue-dim)', color: 'var(--blue)', border: 'rgba(91,141,238,0.3)' },
    purple:  { bg: 'var(--purple-dim)', color: 'var(--purple)', border: 'rgba(157,124,244,0.3)' },
  }
  const c = colors[color] || colors.default
  return (
    <span style={{
      display: 'inline-block',
      padding: '1px 7px',
      borderRadius: '4px',
      fontSize: '10px',
      fontFamily: 'var(--font-mono)',
      fontWeight: 500,
      letterSpacing: '0.03em',
      background: c.bg,
      color: c.color,
      border: `1px solid ${c.border}`,
    }}>
      {children}
    </span>
  )
}

// ── StatusDot ─────────────────────────────────────────────────────────────────
export function StatusDot({ status }) {
  const map = {
    running:   { color: 'var(--green)', pulse: true },
    staged:    { color: 'var(--text-muted)', pulse: false },
    deploying: { color: 'var(--accent)', pulse: true },
    stopped:   { color: 'var(--red)', pulse: false },
    error:     { color: 'var(--red)', pulse: true },
    online:    { color: 'var(--green)', pulse: true },
    offline:   { color: 'var(--text-muted)', pulse: false },
  }
  const s = map[status] || map.staged
  return (
    <span style={{
      display: 'inline-block',
      width: 7, height: 7,
      borderRadius: '50%',
      background: s.color,
      flexShrink: 0,
      animation: s.pulse ? 'pulse-dot 1.4s ease-in-out infinite' : 'none',
    }} />
  )
}

// ── Card ──────────────────────────────────────────────────────────────────────
export function Card({ children, className = '', style = {} }) {
  return (
    <div style={{
      background: 'var(--bg-surface)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius-lg)',
      ...style,
    }} className={className}>
      {children}
    </div>
  )
}

export function CardHeader({ children, action }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '14px 18px',
      borderBottom: '1px solid var(--border)',
    }}>
      <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 13, color: 'var(--text-primary)', letterSpacing: '0.03em' }}>
        {children}
      </span>
      {action}
    </div>
  )
}

// ── Modal ─────────────────────────────────────────────────────────────────────
export function Modal({ open, onClose, title, children, width = 480 }) {
  if (!open) return null
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.7)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        backdropFilter: 'blur(4px)',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width, maxWidth: 'calc(100vw - 32px)',
          background: 'var(--bg-surface)',
          border: '1px solid var(--border-mid)',
          borderRadius: 'var(--radius-lg)',
          animation: 'fadeIn 0.15s ease',
          overflow: 'hidden',
        }}
      >
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 18px',
          borderBottom: '1px solid var(--border)',
        }}>
          <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 13 }}>{title}</span>
          <button onClick={onClose} style={{ color: 'var(--text-muted)', fontSize: 18, lineHeight: 1, cursor: 'pointer', background: 'none', border: 'none' }}>×</button>
        </div>
        <div style={{ padding: 18 }}>{children}</div>
      </div>
    </div>
  )
}

// ── Input ─────────────────────────────────────────────────────────────────────
export function Input({ label, ...props }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      {label && <label style={{ fontSize: 11, color: 'var(--text-muted)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>{label}</label>}
      <input
        style={{ padding: '7px 10px', width: '100%', borderRadius: 'var(--radius)', border: '1px solid var(--border-mid)', background: 'var(--bg-raised)', color: 'var(--text-primary)', fontSize: 12, fontFamily: 'var(--font-mono)' }}
        {...props}
      />
    </div>
  )
}

export function Select({ label, children, ...props }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      {label && <label style={{ fontSize: 11, color: 'var(--text-muted)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>{label}</label>}
      <select
        style={{ padding: '7px 10px', width: '100%', borderRadius: 'var(--radius)', border: '1px solid var(--border-mid)', background: 'var(--bg-raised)', color: 'var(--text-primary)', fontSize: 12, fontFamily: 'var(--font-mono)' }}
        {...props}
      >
        {children}
      </select>
    </div>
  )
}

export function Textarea({ label, ...props }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      {label && <label style={{ fontSize: 11, color: 'var(--text-muted)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>{label}</label>}
      <textarea
        style={{ padding: '8px 10px', width: '100%', minHeight: 80, borderRadius: 'var(--radius)', border: '1px solid var(--border-mid)', background: 'var(--bg-raised)', color: 'var(--text-primary)', fontSize: 12, fontFamily: 'var(--font-mono)', resize: 'vertical', lineHeight: 1.6 }}
        {...props}
      />
    </div>
  )
}

// ── Spinner ───────────────────────────────────────────────────────────────────
export function Spinner({ size = 16 }) {
  return <Loader2 size={size} style={{ animation: 'spin 0.8s linear infinite', color: 'var(--accent)' }} />
}

// ── Empty state ───────────────────────────────────────────────────────────────
export function Empty({ icon, title, description }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, padding: '48px 24px', color: 'var(--text-muted)' }}>
      <div style={{ fontSize: 32, opacity: 0.4 }}>{icon}</div>
      <div style={{ fontFamily: 'var(--font-display)', fontSize: 14, color: 'var(--text-secondary)' }}>{title}</div>
      {description && <div style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', maxWidth: 280 }}>{description}</div>}
    </div>
  )
}

// ── Section label ─────────────────────────────────────────────────────────────
export function SectionLabel({ children }) {
  return (
    <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 10 }}>
      {children}
    </div>
  )
}

// ── Stat box ──────────────────────────────────────────────────────────────────
export function StatBox({ label, value, sub, color }) {
  return (
    <div style={{ padding: '12px 14px', background: 'var(--bg-raised)', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}>
      <div style={{ fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 4 }}>{label}</div>
      <div style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 700, color: color || 'var(--text-primary)', lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>{sub}</div>}
    </div>
  )
}
