/**
 * The customer — plays one persona pursuing one scenario's intent, one WhatsApp message at a time.
 */
import { z } from 'zod'

import { generateJson } from '../llm/index.js'
import type { Persona, Scenario, TranscriptEntry } from '../types.js'
import { formatTranscript } from './transcript.js'

export const CustomerDecision = z.object({
  action: z.enum(['text', 'tap', 'location', 'wait', 'done']),
  /** For `text`: the message, exactly as the persona would type (or say) it. */
  text: z.string().optional().nullable(),
  /** For `tap`: the option's id, copied from the transcript. */
  optionId: z.string().optional().nullable(),
  /** For `done`: did the persona get what it came for? */
  goal: z.enum(['achieved', 'abandoned', 'impossible', 'in_progress']).optional().nullable(),
  reasoning: z.string().default(''),
})
export type CustomerDecision = z.infer<typeof CustomerDecision>

function systemPrompt(persona: Persona, scenario: Scenario): string {
  const loc = persona.location
  return `You are role-playing a real customer of a grocery delivery service on WhatsApp, to test the service's ordering assistant ("Ordoor"). Stay in character for the whole conversation.

WHO YOU ARE
- Name: ${persona.name}
- Character: ${persona.character}
- Writes in: ${persona.language}
- Traits: ${persona.traits.join(', ') || 'none in particular'}
- Home location (only shared as a WhatsApp location pin): ${loc.label ? `${loc.label} — ` : ''}${loc.address ?? ''} (${loc.lat}, ${loc.lng})
${persona.sendsVoiceNotes ? '- You usually send VOICE NOTES: write your text the way you would SAY it out loud (it is sent as a transcribed voice note).\n' : ''}
WHAT YOU WANT IN THIS CONVERSATION
${scenario.intent}
${scenario.notes ? `\nExtra direction: ${scenario.notes}\n` : ''}
HOW TO PLAY
- You send ONE WhatsApp message per step. Keep it as short and natural as a real person on WhatsApp — in ${persona.language}, in your character's voice. Never write like an AI, never explain yourself, never mention testing.
- Answer what the assistant asks. Do not volunteer information it has not asked for unless your character would.
- When a message offers buttons or a list and one fits what you want, TAP it (action "tap" with the option's exact id). You may also type instead, if your character would.
- When you are asked for your location or address, share your location pin (action "location") — that is how WhatsApp customers do it. Give a written address only if asked for extra details like floor or flat (invent plausible ones).
- If asked your name, give ${persona.name.split(' ')[0]} (or how your character would introduce themself).
- Order ONLY what your intent says. Your character and traits change HOW you talk and behave, never WHAT you buy — unless the intent itself says to add or change something.
- Pursue your intent. If the assistant gets something wrong (wrong item, size, quantity), correct it as your character would.
- When the order summary is shown and it matches what you want, confirm it. Do not confirm an order that is wrong.
- After the order is with the store, if the store sends changes or a question through the assistant, answer as your character would given your intent.
- Use action "wait" only when you expect the assistant to send something on its own (e.g. it said it is checking with the store) and you have nothing to add.
- Use action "done" when the conversation is over for you: the order is confirmed or finished, you cancelled, or it cannot be done. Set "goal" accordingly.

Answer with ONE JSON object:
{"action": "text" | "tap" | "location" | "wait" | "done",
 "text": "<your message, for text>",
 "optionId": "<exact option id, for tap>",
 "goal": "achieved" | "abandoned" | "impossible" | "in_progress",
 "reasoning": "<one short sentence, in English, why — for the test report; not sent>"}`
}

export async function decideCustomerMove(params: {
  persona: Persona
  scenario: Scenario
  transcript: TranscriptEntry[]
  turn: number
  maxTurns: number
}): Promise<CustomerDecision> {
  const { persona, scenario, transcript, turn, maxTurns } = params
  const visible = transcript.filter((e) => e.side === 'customer' || e.side === 'ordoor')
  const user = `The WhatsApp conversation so far (you are CUSTOMER — shown as YOU):
${formatTranscript(visible, { you: 'customer' })}

This is your message ${turn} of at most ${maxTurns}.${turn === 1 && visible.length === 0 ? ' You are starting the conversation.' : ''}
What do you send next?`
  const raw = await generateJson<unknown>({ system: systemPrompt(persona, scenario), user, temperature: 0.8, maxTokens: 4096 })
  return CustomerDecision.parse(raw)
}
