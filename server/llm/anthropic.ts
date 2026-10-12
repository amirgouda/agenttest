import { config } from '../config.js'
import type { JsonRequest } from './index.js'

export async function anthropicJson(req: JsonRequest): Promise<string> {
  const { apiKey, model } = config.llm.anthropic
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set')
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model,
      max_tokens: req.maxTokens ?? 2048,
      temperature: req.temperature ?? 0.7,
      system: `${req.system}\n\nAnswer with ONE JSON object and nothing else.`,
      messages: [{ role: 'user', content: req.user }],
    }),
    signal: AbortSignal.timeout(90_000),
  })
  const json = (await res.json().catch(() => null)) as {
    content?: Array<{ type: string; text?: string }>
    error?: { message?: string }
  } | null
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${json?.error?.message ?? 'request failed'}`)
  const text = (json?.content ?? []).filter((b) => b.type === 'text').map((b) => b.text ?? '').join('')
  if (!text) throw new Error('Anthropic returned no text')
  return text
}
