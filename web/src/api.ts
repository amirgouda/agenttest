import type { Evaluation, Persona, Run, Scenario } from '../../server/types'

export type { Evaluation, ExpectedItem, ExpectedOutcome, MessageOption, Persona, Run, RunStatus, Scenario, TranscriptEntry } from '../../server/types'

export type RunSummary = Omit<Run, 'transcript' | 'storeTranscript' | 'log' | 'finalState' | 'evaluation'> & {
  messageCount: number
  evaluation?: Pick<Evaluation, 'verdict' | 'score' | 'summary'>
}

export interface Health {
  ordoor: { baseUrl: string; tokenSet: boolean; ok: boolean; error?: string }
  llm: { model: string; configured: boolean }
  runConcurrency: number
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body !== undefined ? { 'content-type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (res.status === 204) return undefined as T
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((json as { error?: string }).error ?? `${res.status}`)
  return json as T
}

export type PersonaInput = Omit<Persona, 'id' | 'createdAt' | 'updatedAt'>
export type ScenarioInput = Omit<Scenario, 'id' | 'createdAt' | 'updatedAt'>

export const api = {
  health: () => request<Health>('GET', '/api/health'),
  personas: () => request<Persona[]>('GET', '/api/personas'),
  savePersona: (p: PersonaInput, id?: string) => (id ? request<Persona>('PUT', `/api/personas/${id}`, p) : request<Persona>('POST', '/api/personas', p)),
  deletePersona: (id: string) => request<void>('DELETE', `/api/personas/${id}`),
  scenarios: () => request<Scenario[]>('GET', '/api/scenarios'),
  saveScenario: (s: ScenarioInput, id?: string) => (id ? request<Scenario>('PUT', `/api/scenarios/${id}`, s) : request<Scenario>('POST', '/api/scenarios', s)),
  deleteScenario: (id: string) => request<void>('DELETE', `/api/scenarios/${id}`),
  runs: () => request<RunSummary[]>('GET', '/api/runs'),
  run: (id: string) => request<Run>('GET', `/api/runs/${id}`),
  startRuns: (body: { scenarioIds: string[] } | { personaId: string } | { all: true }) => request<Run[]>('POST', '/api/runs', body),
  stopRun: (id: string) => request<void>('POST', `/api/runs/${id}/stop`),
  rerun: (id: string) => request<Run>('POST', `/api/runs/${id}/rerun`),
  deleteRun: (id: string) => request<void>('DELETE', `/api/runs/${id}`),
}
