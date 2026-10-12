import { config } from '../config.js'
import type { JsonRequest } from './index.js'

export async function geminiJson(req: JsonRequest): Promise<string> {
  const { apiKey, model } = config.llm.gemini
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set')
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: req.system }] },
      contents: [{ role: 'user', parts: [{ text: req.user }] }],
      generationConfig: {
        temperature: req.temperature ?? 0.7,
        maxOutputTokens: req.maxTokens ?? 2048,
        responseMimeType: 'application/json',
      },
    }),
    signal: AbortSignal.timeout(90_000),
  })
  const json = (await res.json().catch(() => null)) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string; thought?: boolean }> } }>
    error?: { message?: string }
  } | null
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${json?.error?.message ?? 'request failed'}`)
  const text = (json?.candidates?.[0]?.content?.parts ?? [])
    .filter((p) => !p.thought)
    .map((p) => p.text ?? '')
    .join('')
  if (!text) throw new Error('Gemini returned no text')
  return text
}
