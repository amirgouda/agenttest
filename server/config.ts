import 'dotenv/config'

import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

const str = (name: string, fallback = ''): string => (process.env[name] ?? fallback).trim()

export type LlmProviderName = 'gemini' | 'anthropic'

function llmProvider(): LlmProviderName {
  const raw = str('LLM_PROVIDER').toLowerCase()
  if (raw === 'gemini' || raw === 'anthropic') return raw
  return str('GEMINI_API_KEY') ? 'gemini' : 'anthropic'
}

export const config = {
  root,
  /** This app's own PostgreSQL database — personas, scenarios and runs. Never Ordoor's. */
  databaseUrl: str('DATABASE_URL'),
  port: Number(str('AGENT_TEST_PORT', '4100')),
  runConcurrency: Math.max(1, Number(str('RUN_CONCURRENCY', '1')) || 1),
  ordoor: {
    baseUrl: str('ORDOOR_BASE_URL', 'http://localhost:3000').replace(/\/+$/, ''),
    token: str('ORDOOR_SIMULATOR_TOKEN'),
  },
  llm: {
    provider: llmProvider(),
    gemini: { apiKey: str('GEMINI_API_KEY'), model: str('GEMINI_MODEL', 'gemini-3-flash-preview') },
    anthropic: { apiKey: str('ANTHROPIC_API_KEY'), model: str('ANTHROPIC_MODEL', 'claude-sonnet-5-5') },
  },
  /** How often Ordoor is read while waiting for its replies. */
  pollMs: 800,
  /** After a message, keep reading Ordoor until it has been quiet this long (it may answer in parts). */
  quietMs: 2500,
  /** …but never longer than this per message. */
  drainMaxMs: 20_000,
  /** How long a `wait` decision waits for Ordoor to say something. */
  waitMaxMs: 45_000,
  /** Store-side actions per customer turn, at most. */
  maxStoreStepsPerTurn: 6,
}
