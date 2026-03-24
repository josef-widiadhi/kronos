import { create } from 'zustand'

export const useStore = create((set, get) => ({
  // Auth
  token: localStorage.getItem('kronos_token') || null,
  setToken: token => {
    localStorage.setItem('kronos_token', token)
    set({ token })
  },
  logout: () => {
    localStorage.removeItem('kronos_token')
    set({ token: null })
  },

  // Ollama
  ollamaStatus: null,
  models: [],
  setOllamaStatus: s => set({ ollamaStatus: s }),
  setModels: m => set({ models: m }),

  // Collections
  collections: [],
  setCollections: c => set({ collections: c }),

  // Agents
  agents: [],
  setAgents: a => set({ agents: a }),

  // Monitor data (history for graphs)
  monitorHistory: {},  // { agentId: [{ ts, cpu, mem }] }
  pushMonitorSample: (agentId, sample) => {
    const history = get().monitorHistory
    const prev = history[agentId] || []
    const next = [...prev, sample].slice(-60)  // keep last 60 samples
    set({ monitorHistory: { ...history, [agentId]: next } })
  },

  // Approvals
  approvals: [],
  setApprovals: a => set({ approvals: a }),

  // Pending approval modal
  pendingApprovalId: null,
  setPendingApproval: id => set({ pendingApprovalId: id }),
}))
