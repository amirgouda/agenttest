/**
 * The judge — did the customer get what the scenario asked for, and how did Ordoor behave?
 *
 * The outcome (an order or not, confirmed or not) is checked by CODE from Ordoor's own state, never
 * by the model: a model that reads "تم تأكيد الطلب" in the transcript would pass an order that does
 * not exist. The model judges the rest — the items, the conversation's quality — and cannot overrule
 * a failed outcome.
 */
import { z } from 'zod'

import { generateJson } from '../llm/index.js'
import type { Evaluation, EvaluationCheck, OrdoorCustomerState, Run } from '../types.js'
import { formatTranscript } from './transcript.js'

const STORE_CONFIRMED = new Set(['CONFIRMED', 'OUT_FOR_DELIVERY'])

/** The outcome check — code, from Ordoor's state. */
export function outcomeCheck(run: Pick<Run, 'scenario'>, state: OrdoorCustomerState | undefined): EvaluationCheck {
  const expected = run.scenario.expectedOutcome
  const order = state?.order ?? null
  const live = order && !order.cancelledAt
  const settlement = order?.settlementState ?? 'none'
  switch (expected) {
    case 'order_confirmed': {
      const passed = Boolean(live && STORE_CONFIRMED.has(settlement))
      return { name: 'Outcome: order confirmed by the store', passed, detail: order ? `Order ${order.ref}: status ${order.status}, settlement ${settlement}${order.cancelledAt ? ', cancelled' : ''}` : 'No order was created.' }
    }
    case 'order_placed': {
      return { name: 'Outcome: order placed', passed: Boolean(order), detail: order ? `Order ${order.ref}: status ${order.status}, settlement ${settlement}` : 'No order was created.' }
    }
    case 'no_order': {
      return { name: 'Outcome: no order', passed: !live, detail: live ? `An order exists: ${order!.ref} (${order!.status}).` : 'No live order — as expected.' }
    }
    default:
      return { name: 'Outcome: any', passed: true, detail: 'Not checked by this scenario.' }
  }
}

const JudgeAnswer = z.object({
  score: z.number().min(0).max(100),
  summary: z.string(),
  checks: z.array(z.object({ name: z.string(), passed: z.boolean(), detail: z.string() })).default([]),
  issues: z.array(z.string()).default([]),
})

const SYSTEM = `You are a strict QA reviewer of a WhatsApp grocery ordering assistant ("Ordoor"), operating in Egypt. A simulated customer just had a conversation with it. Judge Ordoor, not the customer.

Produce:
- "checks": one per expected item — is it in the final basket/order with the right product type, size and quantity? (A sensible equivalent is a pass; a different product, size or quantity is a fail; explain.) Add a check for any item in the order the customer never asked for.
- Then these checks: "Understood the request", "Asked only necessary questions", "Handled corrections", "Tone and language matched the customer".
- "issues": concrete problems in Ordoor's behaviour worth a developer's look (quote the message). Empty if none.
- "score": 0–100 for how well Ordoor served this customer.
- "summary": two sentences, in English.

Answer with ONE JSON object: {"score": n, "summary": "...", "checks": [{"name": "...", "passed": true|false, "detail": "..."}], "issues": ["..."]}`

export async function evaluateRun(run: Run): Promise<Evaluation> {
  const outcome = outcomeCheck(run, run.finalState)
  const state = run.finalState
  const user = `SCENARIO
Persona: ${run.persona.name} — ${run.persona.character}
Intent: ${run.scenario.intent}
Expected items: ${run.scenario.expectedItems.length ? run.scenario.expectedItems.map((i) => `${i.quantity ?? ''} ${i.unit ?? ''} ${i.description}`.trim()).join('; ') : '(none)'}
Expected outcome: ${run.scenario.expectedOutcome}
Store instruction: ${run.scenario.storeBehaviour || '(store not played)'}

OUTCOME (checked by code — you cannot change it): ${outcome.passed ? 'PASSED' : 'FAILED'} — ${outcome.detail}

FINAL BASKET (Ordoor's record of the conversation):
${JSON.stringify(state?.conversation?.lines ?? [], null, 1)}

FINAL ORDER:
${JSON.stringify(state?.order ?? null, null, 1)}

CUSTOMER CONVERSATION:
${formatTranscript(run.transcript.filter((e) => e.side !== 'system'))}

STORE SIDE:
${formatTranscript(run.storeTranscript)}

Conversation ended because: ${run.endReason ?? 'unknown'}`

  const answer = JudgeAnswer.parse(await generateJson<unknown>({ system: SYSTEM, user, temperature: 0.1, maxTokens: 8192 }))
  const checks = [outcome, ...answer.checks]
  const failed = checks.filter((c) => !c.passed).length
  // The outcome is a gate: failing it fails the run whatever the score.
  const verdict: Evaluation['verdict'] = !outcome.passed ? 'fail' : failed === 0 && answer.score >= 70 ? 'pass' : answer.score >= 40 ? 'partial' : 'fail'
  return { verdict, score: Math.round(answer.score), summary: answer.summary, checks, issues: answer.issues }
}
