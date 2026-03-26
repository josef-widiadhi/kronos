import axios from 'axios'

// In Docker production: nginx proxies /api → kronos-api:8000
// In local dev: vite proxy in vite.config.js handles /api → localhost:8000
const api = axios.create({
  baseURL: '/api',
  timeout: 30000,
})

api.interceptors.request.use(config => {
  const token = localStorage.getItem('kronos_token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

api.interceptors.response.use(
  res => res,
  err => {
    if (err.response?.status === 401) {
      localStorage.removeItem('kronos_token')
      window.location.href = '/login'
    }
    return Promise.reject(err)
  }
)

// ── Auth ──────────────────────────────────────────────────────────────────────
export const login = (username, password) => {
  const form = new FormData()
  form.append('username', username)
  form.append('password', password)
  return api.post('/auth/token', form)
}
export const getApprovals   = () => api.get('/auth/approvals')
export const resolveApproval = (id, approved, note) =>
  api.post('/auth/approve', { request_id: id, approved, note })

// ── Ollama ────────────────────────────────────────────────────────────────────
export const ollamaStatus    = () => api.get('/ollama/status')
export const ollamaModels    = () => api.get('/ollama/models')
export const ollamaModelInfo = name => api.get(`/ollama/models/${name}/info`)
export const requestPull     = model => api.post('/ollama/models/pull', { model_name: model })
export const executePull     = id => api.post(`/ollama/models/pull/execute/${id}`)
export const deleteModel     = name => api.delete(`/ollama/models/${name}`)

// ── RAG ───────────────────────────────────────────────────────────────────────
export const getCollections   = () => api.get('/rag/collections')
export const createCollection = data => api.post('/rag/collections', data)
export const deleteCollection = id => api.delete(`/rag/collections/${id}`)
export const ingestFile = (collectionId, file) => {
  const form = new FormData()
  form.append('collection_id', collectionId)
  form.append('file', file)
  return api.post('/rag/ingest/file', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 120000,
  })
}
export const ingestURLs = (collectionId, urls) =>
  api.post('/rag/ingest/url', { collection_id: collectionId, urls }, { timeout: 120000 })
export const queryKB = (collectionId, query, topK = 5) =>
  api.post('/rag/query', { collection_id: collectionId, query, top_k: topK })

// ── Docker ────────────────────────────────────────────────────────────────────
export const getContainers        = () => api.get('/docker/containers')
export const containerStats       = id => api.get(`/docker/containers/${id}/stats`)
export const containerOllamaCheck = id => api.get(`/docker/containers/${id}/ollama-check`)
export const requestPushModel = (targetContainerId, modelName, port) =>
  api.post('/docker/push-model', { target_container_id: targetContainerId, model_name: modelName, target_ollama_port: port })
export const executePushModel     = id => api.post(`/docker/push-model/execute/${id}`)
export const requestInjectKB      = (containerId, kbId, targetPath) =>
  api.post('/docker/inject-kb', { container_id: containerId, kb_collection_id: kbId, target_path: targetPath || '/root/.chroma' })
export const executeInjectKB      = id => api.post(`/docker/inject-kb/execute/${id}`)
export const exportInjectKB       = id => api.post(`/docker/inject-kb/export-and-inject/${id}`)
export const requestExec          = (containerId, command) =>
  api.post('/docker/exec', { container_id: containerId, command })

// ── Agents ────────────────────────────────────────────────────────────────────
export const getAgents    = () => api.get('/agents')
export const getAgent     = id => api.get(`/agents/${id}`)
export const createAgent  = data => api.post('/agents', data)
export const updateAgent  = (id, data) => api.patch(`/agents/${id}`, data)
export const deleteAgent  = id => api.delete(`/agents/${id}`)
export const deployAgent  = (agentId, port, envVars) =>
  api.post('/agents/deploy', { agent_id: agentId, port, env_vars: envVars })
export const executeDeployAgent = id => api.post(`/agents/deploy/execute/${id}`)
export const stopAgent    = id => api.post(`/agents/${id}/stop`)
export const agentLogs    = (id, tail = 100) => api.get(`/agents/${id}/logs?tail=${tail}`)

// ── Monitor ───────────────────────────────────────────────────────────────────
export const monitorOverview = () => api.get('/monitor/overview')

// ── Chat ──────────────────────────────────────────────────────────────────────
export const sendChat = (model, message, kbCollectionId, history, topK, stream) =>
  api.post('/chat/', { model, message, kb_collection_id: kbCollectionId, history, top_k: topK, stream })

// ── Workers ───────────────────────────────────────────────────────────────────
export const seedWorkers   = model => api.post(`/workers/seed?model=${encodeURIComponent(model)}`)
export const listDefaults  = () => api.get('/workers/defaults')
export const folderScan    = (kbId, folder) => api.post(`/workers/folder-scan?kb_collection_id=${kbId}&folder_path=${encodeURIComponent(folder || '/watch_folder')}`)

export default api
