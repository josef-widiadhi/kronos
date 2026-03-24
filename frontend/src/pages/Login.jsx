import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { login } from '../api'
import { useStore } from '../hooks/useStore'
import { Btn, Input } from '../components/ui'
import { ShieldCheck } from 'lucide-react'

export default function Login() {
  const [username, setUsername] = useState('admin')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const { setToken } = useStore()
  const navigate = useNavigate()

  const handleLogin = async e => {
    e.preventDefault()
    setLoading(true)
    try {
      const r = await login(username, password)
      setToken(r.data.access_token)
      navigate('/')
    } catch {
      toast.error('Invalid credentials')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      position: 'relative',
      zIndex: 1,
    }}>
      <div style={{
        width: 360,
        background: 'var(--bg-surface)',
        border: '1px solid var(--border-mid)',
        borderRadius: 'var(--radius-lg)',
        overflow: 'hidden',
        animation: 'fadeIn 0.3s ease',
      }}>
        {/* Header */}
        <div style={{
          padding: '28px 28px 22px',
          borderBottom: '1px solid var(--border)',
          textAlign: 'center',
        }}>
          <div style={{
            width: 44, height: 44,
            background: 'var(--accent)',
            borderRadius: 10,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            margin: '0 auto 14px',
          }}>
            <span style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 22, color: 'var(--bg-base)' }}>K</span>
          </div>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 18, letterSpacing: '-0.01em' }}>KRONOS</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4, letterSpacing: '0.05em' }}>
            KNOWLEDGE RUNTIME ORCHESTRATION
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleLogin} style={{ padding: '22px 28px 28px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 7,
            padding: '8px 12px',
            background: 'var(--accent-subtle)',
            border: '1px solid rgba(245,166,35,0.2)',
            borderRadius: 'var(--radius)',
            fontSize: 11,
            color: 'var(--accent)',
          }}>
            <ShieldCheck size={12} />
            Owner-only access. All actions are logged.
          </div>

          <Input
            label="Username"
            value={username}
            onChange={e => setUsername(e.target.value)}
            autoComplete="username"
          />
          <Input
            label="Password"
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="••••••••"
            autoComplete="current-password"
          />

          <Btn variant="accent" size="lg" loading={loading} style={{ width: '100%', justifyContent: 'center', marginTop: 4 }}>
            Authenticate
          </Btn>
        </form>
      </div>
    </div>
  )
}
