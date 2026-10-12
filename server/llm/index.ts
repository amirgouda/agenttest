/**
 * The testing agent's own model — the customer it plays, the store it plays, and the judge.
 * Separate from Ordoor's models on purpose: the system under test must not grade itself.
 */
import { config } from '../config.js'
import { anthropicJson } from './anthropic.js'
import { geminiJson } from './gemini.js'

export interface JsonRequest {
  system: string
  user: string
  temperature?: number
  maxTokens?: number
}

/** Ask for one JSON object. Throws when the model answers with something that is not one. */
export async function generateJson<T>(req: JsonRequest): Promise<T> {
  const ask = () => (config.llm.provider === 'gemini' ? geminiJson(req) : anthropicJson(req))
  try {
    return parseJsonObject<T>(await ask())
  } catch {
    // Once more: a reply cut short or wrapped in prose is usually fine the second time.
    return parseJsonObject<T>(await ask())
  }
}

export function llmDescription(): string {
  const p = config.llm.provider
  return `${p}:${p === 'gemini' ? config.llm.gemini.model : config.llm.anthropic.model}`
}

export function llmConfigured(): boolean {
  return config.llm.provider === 'gemini' ? Boolean(config.llm.gemini.apiKey) : Boolean(config.llm.anthropic.apiKey)
}

/** The first JSON object in the text — tolerant of a ```json fence or a sentence around it. */
export function parseJsonObject<T>(raw: string): T {
  const text = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  try {
    return JSON.parse(text) as T
  } catch {
    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    if (start >= 0 && end > start) return JSON.parse(text.slice(start, end + 1)) as T
    throw new Error(`The model did not answer with JSON: ${raw.slice(0, 200)}`)
  }
}
