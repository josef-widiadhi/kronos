import React from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import { useStore } from './hooks/useStore'
import { AppLayout } from './components/layout/Layout'
import Login     from './pages/Login'
import Monitor   from './pages/Monitor'
import OllamaPage from './pages/Ollama'
import RAGPage   from './pages/RAG'
import DockerPage from './pages/Docker'
import AgentsPage from './pages/Agents'
import MCPPage   from './pages/MCP'
import WikiPage  from './pages/Wiki'
import HowToPage from './pages/HowTo'
import ChatPage  from './pages/Chat'
import ApprovalsPage from './pages/Approvals'
import './styles/global.css'

function ProtectedRoute({ children }) {
  const { token } = useStore()
  if (!token) return <Navigate to="/login" replace />
  return <AppLayout>{children}</AppLayout>
}

export default function App() {
  return (
    <BrowserRouter>
      <Toaster
        position="bottom-right"
        toastOptions={{
          style: {
            background: 'var(--bg-overlay)',
            color: 'var(--text-primary)',
            border: '1px solid var(--border-mid)',
            fontFamily: 'var(--font-mono)',
            fontSize: '12px',
          },
          success: { iconTheme: { primary: 'var(--green)', secondary: 'var(--bg-base)' } },
          error:   { iconTheme: { primary: 'var(--red)', secondary: 'var(--bg-base)' } },
        }}
      />
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/"        element={<ProtectedRoute><Monitor /></ProtectedRoute>} />
        <Route path="/ollama"  element={<ProtectedRoute><OllamaPage /></ProtectedRoute>} />
        <Route path="/rag"     element={<ProtectedRoute><RAGPage /></ProtectedRoute>} />
        <Route path="/docker"  element={<ProtectedRoute><DockerPage /></ProtectedRoute>} />
        <Route path="/agents"  element={<ProtectedRoute><AgentsPage /></ProtectedRoute>} />
        <Route path="/mcp"     element={<ProtectedRoute><MCPPage /></ProtectedRoute>} />
        <Route path="/chat"    element={<ProtectedRoute><ChatPage /></ProtectedRoute>} />
        <Route path="/approvals" element={<ProtectedRoute><ApprovalsPage /></ProtectedRoute>} />
        <Route path="/wiki"      element={<ProtectedRoute><WikiPage /></ProtectedRoute>} />
        <Route path="/howto"     element={<ProtectedRoute><HowToPage /></ProtectedRoute>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
