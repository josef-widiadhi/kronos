import React, { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { Settings, RefreshCw, RotateCcw, Save, Check, Cpu, FlaskConical, Database, Zap, Info } from 'lucide-react'
import { PageHeader } from '../components/layout/Layout'
import { Card, CardHeader, Btn, Badge, Spinner, SectionLabel } from '../components/ui'
import { PageHelp, Hint } from '../components/help'
import api from '../api'

const CATEGORY_META = {
  compute: {
    icon: '🖥️',
    label: 'Compute',
    color: 'var(--blue)',
    description: 'GPU/CPU mode, VRAM, Docker image for fine-tuning',
  },
  finetune: {
    icon: '⚗️',
    label: 'Fine-Tune Defaults',
    color: 'var(--purple)',
    description: 'Default hyperparameters for training jobs',
  },
  rag: {
    icon: '🧠',
    label: 'RAG / KB',
    color: 'var(--green)',
    description: 'Chunk sizes, embed model, retrieval settings',
  },
  ollama: {
    icon: '🦙',
    label: 'Ollama',
    color: 'var(--amber)',
    description: 'Default model, request timeouts',
  },
  general: {
    icon: '⚙️',
    label: 'General',
    color: 'var(--text-secondary)',
    description: 'Instance name, approval requirements, logging',
  },
}

const DEVICE_OPTIONS = [
  { value: 'cpu',  label: 'CPU only',         desc: 'Works everywhere, slow (hours/epoch for 7B)' },
  { value: 'cuda', label: 'NVIDIA GPU (CUDA)', desc: 'Fast, requires NVIDIA GPU + CUDA drivers' },
  { value: 'mps',  label: 'Apple Silicon (MPS)', desc: 'For Mac M1/M2/M3 machines' },
  { value: 'auto', label: 'Auto-detect',       desc: 'Use CUDA if available, else MPS, else CPU' },
]

const METHOD_OPTIONS = [
  { value: 'lora',  label: 'LoRA',            desc: '16-bit adapters, ~6GB VRAM for 7B, recommended' },
  { value: 'qlora', label: 'QLoRA (4-bit)',    desc: '~4GB VRAM for 7B, slightly less accurate' },
  { value: 'full',  label: 'Full fine-tuning', desc: 'Needs 40GB+ VRAM, not recommended' },
]

const GGUF_OPTIONS = [
  { value: 'q2_k',   label: 'Q2_K — smallest',  desc: '~2GB for 7B, lowest quality' },
  { value: 'q4_k_m', label: 'Q4_K_M — balanced', desc: '~4GB for 7B, recommended' },
  { value: 'q5_k_m', label: 'Q5_K_M — better',   desc: '~5GB for 7B, good quality' },
  { value: 'q8_0',   label: 'Q8_0 — high quality', desc: '~8GB for 7B, near lossless' },
  { value: 'f16',    label: 'F16 — full precision', desc: '~14GB for 7B, no quantization' },
]

const LOG_OPTIONS = ['DEBUG', 'INFO', 'WARNING', 'ERROR']

// ── Individual setting input ──────────────────────────────────────────────────
function SettingRow({ setting, onChange, dirty }) {
  const { key, value, value_type, label, description } = setting
  const [showDesc, setShowDesc] = useState(false)

  const inputStyle = {
    padding: '6px 10px',
    borderRadius: 'var(--radius)',
    border: `1px solid ${dirty ? 'var(--accent)' : 'var(--border-mid)'}`,
    background: 'var(--bg-base)',
    color: dirty ? 'var(--accent)' : 'var(--text-primary)',
    fontSize: 12,
    fontFamily: 'var(--font-mono)',
    width: '100%',
    transition: 'border-color 0.15s',
  }

  const renderInput = () => {
    // Special dropdowns for known keys
    if (key === 'compute.device') {
      return (
        <select value={value} onChange={e => onChange(key, e.target.value)} style={inputStyle}>
          {DEVICE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label} — {o.desc}</option>)}
        </select>
      )
    }
    if (key === 'finetune.default_method') {
      return (
        <select value={value} onChange={e => onChange(key, e.target.value)} style={inputStyle}>
          {METHOD_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label} — {o.desc}</option>)}
        </select>
      )
    }
    if (key === 'finetune.gguf_quantization') {
      return (
        <select value={value} onChange={e => onChange(key, e.target.value)} style={inputStyle}>
          {GGUF_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label} — {o.desc}</option>)}
        </select>
      )
    }
    if (key === 'general.log_level') {
      return (
        <select value={value} onChange={e => onChange(key, e.target.value)} style={inputStyle}>
          {LOG_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      )
    }
    if (value_type === 'bool') {
      return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
            <div
              onClick={() => onChange(key, value === 'true' ? 'false' : 'true')}
              style={{
                width: 36, height: 20, borderRadius: 10,
                background: value === 'true' ? 'var(--accent)' : 'var(--border-mid)',
                position: 'relative', cursor: 'pointer', transition: 'background 0.2s',
                flexShrink: 0,
              }}
            >
              <div style={{
                width: 14, height: 14, borderRadius: '50%', background: 'white',
                position: 'absolute', top: 3,
                left: value === 'true' ? 18 : 3,
                transition: 'left 0.2s',
              }} />
            </div>
            <span style={{ fontSize: 12, color: value === 'true' ? 'var(--accent)' : 'var(--text-muted)' }}>
              {value === 'true' ? 'Enabled' : 'Disabled'}
            </span>
          </label>
        </div>
      )
    }
    if (value_type === 'int') {
      return (
        <input
          type="number"
          value={value}
          onChange={e => onChange(key, e.target.value)}
          style={{ ...inputStyle, width: 120 }}
        />
      )
    }
    return (
      <input
        type="text"
        value={value}
        onChange={e => onChange(key, e.target.value)}
        style={inputStyle}
      />
    )
  }

  return (
    <div style={{
      padding: '12px 16px',
      borderBottom: '1px solid var(--border)',
      display: 'grid',
      gridTemplateColumns: '200px 1fr auto',
      gap: 16,
      alignItems: 'start',
      background: dirty ? 'rgba(245,166,35,0.03)' : 'transparent',
      transition: 'background 0.15s',
    }}>
      <div>
        <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-primary)', marginBottom: 2 }}>{label}</div>
        <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{key}</div>
      </div>
      <div>
        {renderInput()}
        {showDesc && description && (
          <div style={{
            marginTop: 6, fontSize: 11, color: 'var(--text-muted)',
            lineHeight: 1.6, whiteSpace: 'pre-wrap',
            padding: '6px 8px',
            background: 'var(--bg-raised)',
            borderRadius: 'var(--radius)',
            border: '1px solid var(--border)',
          }}>
            {description}
          </div>
        )}
      </div>
      <div style={{ display: 'flex', gap: 4, paddingTop: 4 }}>
        {dirty && <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--accent)', marginTop: 6 }} title="Unsaved change" />}
        <button
          onClick={() => setShowDesc(s => !s)}
          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, color: showDesc ? 'var(--accent)' : 'var(--text-muted)' }}
          title="Show description"
        >
          <Info size={13} />
        </button>
      </div>
    </div>
  )
}

// ── Category card ─────────────────────────────────────────────────────────────
function CategoryCard({ categoryKey, settings, dirty, onChange, onReset }) {
  const meta = CATEGORY_META[categoryKey] || { icon: '⚙️', label: categoryKey, color: 'var(--text-muted)', description: '' }
  const dirtyCount = settings.filter(s => dirty[s.key]).length

  return (
    <Card style={{ marginBottom: 14 }}>
      <div style={{
        padding: '12px 16px',
        borderBottom: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 3, height: 18, background: meta.color, borderRadius: 2 }} />
          <span style={{ fontSize: 20 }}>{meta.icon}</span>
          <div>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 13 }}>{meta.label}</div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{meta.description}</div>
          </div>
          {dirtyCount > 0 && (
            <Badge color="amber">{dirtyCount} unsaved</Badge>
          )}
        </div>
        <Btn size="sm" variant="ghost" onClick={() => onReset(categoryKey)} title="Reset category to defaults">
          <RotateCcw size={11} /> reset
        </Btn>
      </div>
      {settings.map(s => (
        <SettingRow
          key={s.key}
          setting={s}
          dirty={!!dirty[s.key]}
          onChange={onChange}
        />
      ))}
    </Card>
  )
}

// ── Main Settings page ────────────────────────────────────────────────────────
export default function SettingsPage() {
  const [categories, setCategories] = useState({})
  const [localValues, setLocalValues] = useState({})  // key → string value
  const [dirty, setDirty] = useState({})              // key → bool
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      const r = await api.get('/settings/')
      setCategories(r.data.categories || {})
      // Flatten all settings into local values
      const vals = {}
      Object.values(r.data.categories || {}).flat().forEach(s => {
        vals[s.key] = s.value ?? ''
      })
      setLocalValues(vals)
      setDirty({})
    } catch { toast.error('Failed to load settings') }
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  const handleChange = (key, value) => {
    setLocalValues(prev => ({ ...prev, [key]: value }))
    setDirty(prev => ({ ...prev, [key]: true }))
  }

  const handleSaveAll = async () => {
    const dirtyKeys = Object.keys(dirty).filter(k => dirty[k])
    if (dirtyKeys.length === 0) return toast.success('No changes to save')
    setSaving(true)
    try {
      const payload = {}
      dirtyKeys.forEach(k => { payload[k] = localValues[k] })
      await api.post('/settings/bulk', { settings: payload })
      toast.success(`Saved ${dirtyKeys.length} setting${dirtyKeys.length > 1 ? 's' : ''}`)
      setDirty({})
    } catch (e) { toast.error(e.response?.data?.detail || 'Save failed') }
    finally { setSaving(false) }
  }

  const handleReset = async (category) => {
    if (!confirm(`Reset all ${CATEGORY_META[category]?.label || category} settings to defaults?`)) return
    try {
      await api.post(`/settings/reset?category=${category}`)
      toast.success('Reset to defaults')
      load()
    } catch { toast.error('Reset failed') }
  }

  // Merge DB values with local edits for display
  const getDisplaySettings = (settings) =>
    settings.map(s => ({ ...s, value: localValues[s.key] ?? s.value }))

  const totalDirty = Object.values(dirty).filter(Boolean).length
  const CATEGORY_ORDER = ['compute', 'finetune', 'rag', 'ollama', 'general']

  return (
    <div style={{ animation: 'fadeIn 0.2s ease', maxWidth: 860 }}>
      <PageHelp
        steps={[
          'Set your compute device (CPU / CUDA / MPS) — this drives fine-tuning job behavior',
          'For CPU-only machines: set device=cpu and unsloth_image to the CPU build',
          'Adjust fine-tune defaults to match your hardware (batch size, LoRA rank)',
          'Click "Save All Changes" — settings persist in the database through restarts',
        ]}
        tips={[
          'Compute settings only affect fine-tuning — RAG and chat always use CPU/Ollama',
          'GPU VRAM setting helps KRONOS auto-tune batch sizes (0 = auto-detect)',
          'Approval toggles let you skip the approval queue for trusted actions',
          'Changes take effect immediately — no restart required',
        ]}
      />

      <PageHeader
        title="Settings"
        subtitle="System configuration — persisted in database across restarts"
        action={
          <div style={{ display: 'flex', gap: 8 }}>
            <Btn variant="ghost" onClick={load} loading={loading}><RefreshCw size={12} /></Btn>
            {totalDirty > 0 && (
              <Btn variant="accent" onClick={handleSaveAll} loading={saving}>
                <Save size={12} /> Save {totalDirty} Change{totalDirty > 1 ? 's' : ''}
              </Btn>
            )}
            {totalDirty === 0 && !loading && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 'var(--radius)', background: 'var(--green-dim)', border: '1px solid rgba(61,214,140,0.2)', fontSize: 11, color: 'var(--green)' }}>
                <Check size={11} /> All saved
              </div>
            )}
          </div>
        }
      />

      {/* Quick compute status banner */}
      {!loading && localValues['compute.device'] && (
        <div style={{
          padding: '10px 16px', marginBottom: 16,
          background: 'var(--bg-surface)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-lg)',
          display: 'flex', alignItems: 'center', gap: 16,
          fontSize: 12,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span>🖥️</span>
            <span style={{ color: 'var(--text-muted)' }}>Device:</span>
            <code style={{ color: 'var(--accent)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>{localValues['compute.device']}</code>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span>⚗️</span>
            <span style={{ color: 'var(--text-muted)' }}>Method:</span>
            <code style={{ color: 'var(--accent)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>{localValues['finetune.default_method']}</code>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span>📦</span>
            <span style={{ color: 'var(--text-muted)' }}>GGUF:</span>
            <code style={{ color: 'var(--accent)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>{localValues['finetune.gguf_quantization']}</code>
          </div>
          {localValues['compute.device'] === 'cpu' && (
            <div style={{ marginLeft: 'auto', padding: '3px 8px', background: 'rgba(245,166,35,0.1)', border: '1px solid rgba(245,166,35,0.2)', borderRadius: 4, fontSize: 10, color: 'var(--amber)' }}>
              ⚠️ CPU mode — fine-tuning will be slow
            </div>
          )}
          {localValues['compute.device'] === 'cuda' && (
            <div style={{ marginLeft: 'auto', padding: '3px 8px', background: 'rgba(61,214,140,0.1)', border: '1px solid rgba(61,214,140,0.2)', borderRadius: 4, fontSize: 10, color: 'var(--green)' }}>
              ✓ GPU mode — fast training
            </div>
          )}
        </div>
      )}

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}><Spinner /></div>
      ) : (
        CATEGORY_ORDER.filter(cat => categories[cat]).map(cat => (
          <CategoryCard
            key={cat}
            categoryKey={cat}
            settings={getDisplaySettings(categories[cat] || [])}
            dirty={dirty}
            onChange={handleChange}
            onReset={handleReset}
          />
        ))
      )}
    </div>
  )
}
