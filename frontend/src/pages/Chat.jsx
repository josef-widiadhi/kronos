import React, { useState, useRef, useEffect } from 'react'
import toast from 'react-hot-toast'
import { Send, Bot, User, Zap, Database, RefreshCw } from 'lucide-react'
import { PageHeader } from '../components/layout/Layout'
import { PageHelp } from '../components/help'
import { Card, Btn, Select, Badge, Spinner } from '../components/ui'
import { sendChat } from '../api'
import { useStore } from '../hooks/useStore'

function MessageBubble({ msg }) {
  const isUser = msg.role === 'user'
  return (
    <div style={{
      display: 'flex',
      flexDirection: isUser ? 'row-reverse' : 'row',
      gap: 10,
      alignItems: 'flex-start',
      animation: 'fadeIn 0.15s ease',
    }}>
      {/* Avatar */}
      <div style={{
        width: 28, height: 28, flexShrink: 0,
        borderRadius: 6,
        background: isUser ? 'var(--bg-overlay)' : 'var(--accent-subtle)',
        border: `1px solid ${isUser ? 'var(--border-mid)' : 'rgba(245,166,35,0.3)'}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {isUser
          ? <User size={13} style={{ color: 'var(--text-muted)' }} />
          : <Bot size={13} style={{ color: 'var(--accent)' }} />}
      </div>

      <div style={{ maxWidth: '72%', minWidth: 0 }}>
        {/* Bubble */}
        <div style={{
          padding: '9px 13px',
          borderRadius: isUser ? '10px 4px 10px 10px' : '4px 10px 10px 10px',
          background: isUser ? 'var(--bg-overlay)' : 'var(--bg-raised)',
          border: `1px solid ${isUser ? 'var(--border-mid)' : 'var(--border)'}`,
          fontSize: 12,
          lineHeight: 1.7,
          color: 'var(--text-primary)',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}>
          {msg.content}
          {msg.loading && <span style={{ display: 'inline-block', width: 8, height: 12, background: 'var(--accent)', marginLeft: 3, animation: 'pulse-dot 0.8s infinite', borderRadius: 1 }} />}
        </div>

        {/* Sources */}
        {msg.sources?.length > 0 && (
          <div style={{ marginTop: 6, display: 'flex', gap: 5, flexWrap: 'wrap' }}>
            {msg.sources.slice(0, 3).map((s, i) => (
              <div key={i} style={{
                display: 'flex', alignItems: 'center', gap: 4,
                padding: '2px 7px',
                background: 'var(--bg-raised)',
                border: '1px solid var(--border)',
                borderRadius: 4,
                fontSize: 10, color: 'var(--text-muted)',
              }}>
                <Zap size={9} style={{ color: 'var(--accent)' }} />
                <span className="truncate" style={{ maxWidth: 160 }}>{s.source}</span>
                <span style={{ color: 'var(--accent)' }}>{(s.relevance * 100).toFixed(0)}%</span>
              </div>
            ))}
          </div>
        )}

        {msg.model && (
          <div style={{ marginTop: 4, fontSize: 10, color: 'var(--text-muted)' }}>
            {msg.model} {msg.rag_used && '· RAG'}
            {msg.tokens && ` · ${msg.tokens} tok`}
          </div>
        )}
      </div>
    </div>
  )
}

export default function ChatPage() {
  const { models, collections } = useStore()
  const [selectedModel, setSelectedModel] = useState('')
  const [selectedKB, setSelectedKB] = useState('')
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const bottomRef = useRef(null)
  const inputRef = useRef(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleSend = async () => {
    if (!input.trim() || loading) return
    if (!selectedModel) return toast.error('Select a model first')

    const userMsg = { role: 'user', content: input.trim() }
    const history = messages.map(m => ({ role: m.role, content: m.content }))
    setMessages(m => [...m, userMsg])
    setInput('')
    setLoading(true)

    // Add loading placeholder
    const loadingId = Date.now()
    setMessages(m => [...m, { id: loadingId, role: 'assistant', content: '', loading: true }])

    try {
      const r = await sendChat(selectedModel, userMsg.content, selectedKB || null, history)
      setMessages(m => m.map(msg =>
        msg.id === loadingId
          ? { role: 'assistant', content: r.data.reply, model: r.data.model, sources: r.data.sources, rag_used: r.data.rag_used, tokens: r.data.tokens }
          : msg
      ))
    } catch (e) {
      setMessages(m => m.map(msg =>
        msg.id === loadingId
          ? { role: 'assistant', content: `Error: ${e.response?.data?.detail || e.message}`, error: true }
          : msg
      ))
    } finally {
      setLoading(false)
      inputRef.current?.focus()
    }
  }

  return (
    <div style={{ animation: 'fadeIn 0.2s ease', height: 'calc(100vh - 48px)', display: 'flex', flexDirection: 'column' }}>
      <PageHelp
        steps={[
          'Select a model from your pulled Ollama models on the left',
          'Optionally select a KB Collection to enable RAG (recommended)',
          'Type your question — sources show which KB chunks were used',
          'If answers are poor, check KB query quality in RAG / KB → Test Query',
        ]}
        tips={[
          'No KB selected = pure LLM, no document context',
          'Source relevance % shows how well the retrieved chunks matched your question',
          'This uses the same pipeline as deployed agents — what works here works in production',
          'Use Shift+Enter for multiline messages',
        ]}
      />
      <PageHeader
        title="Chat Test"
        subtitle="Test RAG models before deploying"
        action={
          <Btn variant="ghost" onClick={() => setMessages([])}>
            <RefreshCw size={12} /> clear
          </Btn>
        }
      />

      <div style={{ flex: 1, display: 'flex', gap: 16, overflow: 'hidden' }}>
        {/* Config panel */}
        <div style={{ width: 240, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Card>
            <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
              <Select
                label="Model"
                value={selectedModel}
                onChange={e => setSelectedModel(e.target.value)}
              >
                <option value="">Select model…</option>
                {models.map(m => <option key={m.name} value={m.name}>{m.name}</option>)}
              </Select>

              <Select
                label="KB Collection (RAG)"
                value={selectedKB}
                onChange={e => setSelectedKB(e.target.value)}
              >
                <option value="">None (no RAG)</option>
                {collections.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>

              {selectedKB && (
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '6px 8px',
                  background: 'var(--green-dim)',
                  border: '1px solid rgba(61,214,140,0.3)',
                  borderRadius: 'var(--radius)',
                  fontSize: 11, color: 'var(--green)',
                }}>
                  <Database size={11} />
                  RAG enabled
                </div>
              )}
            </div>
          </Card>

          {messages.length > 0 && (
            <Card>
              <div style={{ padding: '12px 14px' }}>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 6, letterSpacing: '0.06em' }}>SESSION</div>
                <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                  {messages.filter(m => m.role === 'user').length} messages
                </div>
                {messages.some(m => m.rag_used) && (
                  <div style={{ fontSize: 11, color: 'var(--green)', marginTop: 4 }}>
                    ✓ RAG was used
                  </div>
                )}
              </div>
            </Card>
          )}
        </div>

        {/* Chat area */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          {/* Messages */}
          <div style={{
            flex: 1, overflow: 'auto',
            background: 'var(--bg-surface)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-lg)',
            padding: '16px 18px',
            display: 'flex', flexDirection: 'column', gap: 16,
            marginBottom: 12,
          }}>
            {messages.length === 0 && (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', gap: 10 }}>
                <Bot size={32} style={{ opacity: 0.3 }} />
                <div style={{ fontSize: 13, color: 'var(--text-secondary)', fontFamily: 'var(--font-display)' }}>Ready to chat</div>
                <div style={{ fontSize: 11 }}>Select a model and optional KB, then type your message.</div>
              </div>
            )}
            {messages.map((msg, i) => <MessageBubble key={i} msg={msg} />)}
            <div ref={bottomRef} />
          </div>

          {/* Input bar */}
          <div style={{
            display: 'flex', gap: 8,
            background: 'var(--bg-surface)',
            border: '1px solid var(--border-mid)',
            borderRadius: 'var(--radius-lg)',
            padding: '8px 8px 8px 14px',
            alignItems: 'flex-end',
          }}>
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() }
              }}
              placeholder="Type a message… (Enter to send, Shift+Enter for newline)"
              rows={1}
              style={{
                flex: 1, resize: 'none', border: 'none', background: 'none',
                color: 'var(--text-primary)', fontSize: 12, fontFamily: 'var(--font-mono)',
                lineHeight: 1.5, padding: '4px 0', maxHeight: 120, overflow: 'auto',
                outline: 'none',
              }}
            />
            <Btn
              variant={input.trim() ? 'accent' : 'ghost'}
              onClick={handleSend}
              loading={loading}
              disabled={!input.trim()}
            >
              <Send size={13} />
            </Btn>
          </div>
        </div>
      </div>
    </div>
  )
}
