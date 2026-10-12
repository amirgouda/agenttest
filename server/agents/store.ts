/**
 * The store — once the customer confirms, Ordoor sends the order to the store's WhatsApp. In a
 * rehearsal that message is suppressed, so this agent answers in the store's place, following the
 * scenario's `storeBehaviour`.
 */
import { z } from 'zod'

import { generateJson } from '../llm/index.js'
import type { Scenario, TranscriptEntry } from '../types.js'
import { formatTranscript } from './transcript.js'

export const StoreDecision = z.object({
  action: z.enum(['text', 'tap', 'none']),
  text: z.string().optional().nullable(),
  optionId: z.string().optional().nullable(),
  reasoning: z.string().default(''),
})
export type StoreDecision = z.infer<typeof StoreDecision>

const SYSTEM = (behaviour: string) => `You are the owner of a small Egyptian grocery store answering an order-review assistant on WhatsApp. The assistant ("ORDOOR → STORE") sends you a customer's order and asks you to review it with buttons; you answer as a busy shop owner would — short messages in Egyptian Arabic, or by tapping a button.

How you must handle THIS order (the test's instruction — follow it exactly):
${behaviour}

Rules:
- Prefer tapping the button that does what the instruction says (action "tap" with its exact id).
- Type a message (action "text") when you need to say something a button cannot: a price, a missing item, a replacement, the delivery fee.
- When nothing is waiting for you (the last message needs no answer, or the order is finished), answer action "none".

Answer with ONE JSON object:
{"action": "text" | "tap" | "none", "text": "<message, for text>", "optionId": "<exact id, for tap>", "reasoning": "<one short English sentence — for the report>"}`

export async function decideStoreMove(params: { scenario: Scenario; storeTranscript: TranscriptEntry[]; settlementState: string }): Promise<StoreDecision> {
  const user = `Settlement state (for your information): ${params.settlementState}

The store's WhatsApp so far (you are STORE — shown as YOU):
${formatTranscript(params.storeTranscript, { you: 'store_agent' })}

What do you do next?`
  const raw = await generateJson<unknown>({ system: SYSTEM(params.scenario.storeBehaviour), user, temperature: 0.3, maxTokens: 4096 })
  return StoreDecision.parse(raw)
}
