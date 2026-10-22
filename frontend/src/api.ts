export const API_BASE = (
  import.meta.env.VITE_API_BASE_URL || (import.meta.env.DEV ? 'http://localhost:8000/api' : '')
).replace(/\/+$/, '')

let authToken: string | null = sessionStorage.getItem('researchlens.googleToken')

export function setAuthToken(token: string | null) {
  authToken = token
  if (token) sessionStorage.setItem('researchlens.googleToken', token)
  else sessionStorage.removeItem('researchlens.googleToken')
}

export type Paper = {
  id: string
  filename: string
  title: string
  authors: string
  page_count: number
  word_count: number
  sections: Record<string, string>
  project_id: string | null
  created_at: string
}

export type SupportingDocument = {
  id: string
  filename: string
  word_count: number
  created_at: string
}

export type PaperDetail = Paper & { extracted_text: string }

export type Analysis = {
  id: string
  prompt: string
  mode: string
  provider: string
  result: Record<string, any>
  created_at: string
}

export type Project = {
  id: string
  name: string
  description: string
  paper_ids: string[]
  analysis_ids: string[]
  created_at: string
}

export type AssistantMessage = {
  role: 'user' | 'assistant'
  content: string
  sources?: { paper_id: string; paper_title: string; page_number: number | null; excerpt: string }[]
}

export type AssistantConversation = {
  id: string
  title: string
  paper_ids: string[]
  messages: AssistantMessage[]
  created_at: string
  updated_at: string
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  if (!API_BASE) {
    throw new Error('The cloud API URL is not configured. Set VITE_API_BASE_URL and rebuild the frontend.')
  }
  let response: Response
  try {
    const headers = new Headers(options?.headers)
    if (authToken) headers.set('Authorization', `Bearer ${authToken}`)
    response = await fetch(`${API_BASE}${path}`, { ...options, headers })
  } catch {
    throw new Error('Could not reach the ResearchLens API. Check that the backend is running.')
  }
  if (response.status === 401 && authToken) {
    window.dispatchEvent(new Event('researchlens-auth-expired'))
  }
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}))
    throw new Error(payload.detail || `Request failed (${response.status}).`)
  }
  return response.json() as Promise<T>
}

export const api = {
  health: () => request<{ status: string; live_ai_enabled: boolean; provider: string }>('/health'),
  me: () => request<{ email: string }>('/me'),
  papers: async () => (await request<{ papers: Paper[] }>('/papers')).papers,
  paper: (id: string) => request<PaperDetail>(`/papers/${id}`),
  documents: async () => (await request<{ documents: SupportingDocument[] }>('/documents')).documents,
  upload: async (files: File[]) => {
    const data = new FormData()
    files.forEach((file) => data.append('files', file))
    return request<{ papers: Paper[] }>('/papers/upload', { method: 'POST', body: data })
  },
  uploadDocuments: async (files: File[]) => {
    const data = new FormData()
    files.forEach((file) => data.append('files', file))
    return request<{ documents: SupportingDocument[] }>('/documents/upload', { method: 'POST', body: data })
  },
  removePaper: (id: string) => request(`/papers/${id}`, { method: 'DELETE' }),
  projects: async () => (await request<{ projects: Project[] }>('/projects')).projects,
  createProject: (payload: { name: string; description: string }) =>
    request<Project>('/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }),
  updateProject: (id: string, payload: { name: string; description: string }) =>
    request<Project>(`/projects/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }),
  assignProjectPapers: (id: string, paperIds: string[]) =>
    request<Project>(`/projects/${id}/papers`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ paper_ids: paperIds }) }),
  deleteProject: (id: string) => request(`/projects/${id}`, { method: 'DELETE' }),
  analyses: async () => (await request<{ analyses: Analysis[] }>('/analyses')).analyses,
  assistantConversations: async () =>
    (await request<{ conversations: AssistantConversation[] }>('/assistant/conversations')).conversations,
  assistantChat: (payload: { question: string; paper_ids: string[]; conversation_id?: string }) =>
    request<AssistantConversation>('/assistant/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),
  deleteAssistantConversation: (id: string) =>
    request(`/assistant/conversations/${id}`, { method: 'DELETE' }),
  analysis: (payload: {
    prompt: string
    paper_ids: string[]
    project_id: string | null
    document_ids: string[]
    mode: string
    criteria: string[]
    questions: string[]
    report_format: string
  }) => request<Analysis>('/analyses', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }),
  downloadReport: async (id: string) => {
    if (!API_BASE) {
      throw new Error('The cloud API URL is not configured. Set VITE_API_BASE_URL and rebuild the frontend.')
    }
    const headers = new Headers()
    if (authToken) headers.set('Authorization', `Bearer ${authToken}`)
    let response: Response
    try {
      response = await fetch(`${API_BASE}/analyses/${id}/report`, { headers })
    } catch {
      throw new Error('Could not reach the ResearchLens API. Check that the backend is running.')
    }
    if (response.status === 401 && authToken) {
      window.dispatchEvent(new Event('researchlens-auth-expired'))
    }
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}))
      throw new Error(payload.detail || `Request failed (${response.status}).`)
    }
    const url = URL.createObjectURL(await response.blob())
    const link = document.createElement('a')
    link.href = url
    link.download = `researchlens-${id.slice(0, 8)}.pdf`
    link.click()
    URL.revokeObjectURL(url)
  },
}
