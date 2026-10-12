import { describe, expect, it } from 'vitest'

import { outcomeCheck } from '../agents/judge.js'
import { formatTranscript, latestOptions, resolveOption } from '../agents/transcript.js'
import { parseJsonObject } from '../llm/index.js'
import type { OrdoorCustomerState, Scenario, TranscriptEntry } from '../types.js'

describe('parseJsonObject', () => {
  it('reads plain JSON, a fenced block, and JSON inside prose', () => {
    expect(parseJsonObject('{"a":1}')).toEqual({ a: 1 })
    expect(parseJsonObject('```json\n{"a":2}\n```')).toEqual({ a: 2 })
    expect(parseJsonObject('Sure! {"a":3} hope it helps')).toEqual({ a: 3 })
  })
  it('throws on no JSON', () => {
    expect(() => parseJsonObject('no')).toThrow(/did not answer with JSON/)
  })
})

const entry = (p: Partial<TranscriptEntry>): TranscriptEntry => ({ id: 'x', side: 'ordoor', type: 'text', text: '', at: '', ...p })

describe('options', () => {
  const transcript = [
    entry({ id: '1', options: [{ position: 1, id: 'OLD', title: 'قديم' }] }),
    entry({ id: '2', side: 'customer', text: 'hi' }),
    entry({ id: '3', type: 'buttons', options: [{ position: 1, id: 'YES', title: 'أيوه' }, { position: 2, id: 'NO', title: 'لأ' }] }),
  ]
  it('the newest message with options wins', () => {
    expect(latestOptions(transcript, ['ordoor']).map((o) => o.id)).toEqual(['YES', 'NO'])
  })
  it('resolves by id, then by title, else nothing', () => {
    const opts = latestOptions(transcript, ['ordoor'])
    expect(resolveOption(opts, 'NO')?.id).toBe('NO')
    expect(resolveOption(opts, 'أيوه')?.id).toBe('YES')
    expect(resolveOption(opts, 'OLD')).toBeUndefined()
  })
  it('the transcript shows the tappable ids', () => {
    expect(formatTranscript(transcript, { you: 'customer' })).toContain('id="YES" title="أيوه"')
    expect(formatTranscript(transcript, { you: 'customer' })).toContain('YOU: hi')
  })
})

describe('outcomeCheck — code, never the model', () => {
  const scenario = (expectedOutcome: Scenario['expectedOutcome']) => ({ scenario: { expectedOutcome } as Scenario })
  const order = (settlementState: string | null, cancelledAt: string | null = null): OrdoorCustomerState => ({
    conversation: null,
    order: { id: 'o', ref: 'ORD-1', status: 'X', storeName: 'S', subtotal: 1, deliveryFee: 0, total: 1, confirmedAt: null, cancelledAt, settlementState, items: [] },
  })
  it('order_confirmed needs a live order the store confirmed', () => {
    expect(outcomeCheck(scenario('order_confirmed'), order('CONFIRMED')).passed).toBe(true)
    expect(outcomeCheck(scenario('order_confirmed'), order('STORE_REVIEW')).passed).toBe(false)
    expect(outcomeCheck(scenario('order_confirmed'), order('CONFIRMED', '2026-01-01')).passed).toBe(false)
    expect(outcomeCheck(scenario('order_confirmed'), { conversation: null, order: null }).passed).toBe(false)
  })
  it('no_order passes with none or a cancelled one', () => {
    expect(outcomeCheck(scenario('no_order'), { conversation: null, order: null }).passed).toBe(true)
    expect(outcomeCheck(scenario('no_order'), order(null, '2026-01-01')).passed).toBe(true)
    expect(outcomeCheck(scenario('no_order'), order('STORE_REVIEW')).passed).toBe(false)
  })
})
