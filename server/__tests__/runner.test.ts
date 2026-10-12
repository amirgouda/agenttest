/**
 * A whole run against a fake Ordoor and a scripted model: the customer greets, shares a location,
 * taps «confirm»; the store agent taps «تمام»; the judge grades. Proves the plumbing — taps carry the
 * option's id, the store is played only while it is the store's turn, and the run ends on the settled order.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest'

import type { OrdoorCustomerState, OrdoorMessage, OrdoorStoreSide } from '../types.js'
import { pgliteDb } from './pglite.js'

// ── A fake Ordoor ────────────────────────────────────────────────────────────────────────────────
const fake = vi.hoisted(() => {
  const state = {
    messages: [] as OrdoorMessage[],
    store: [] as OrdoorStoreSide['messages'],
    settlement: null as string | null,
    sent: [] as unknown[],
    storeActs: [] as unknown[],
    n: 0,
  }
  const msg = (direction: 'inbound' | 'outbound', text: string, type = 'text', options: OrdoorMessage['options'] = null): OrdoorMessage => ({
    id: `m${String(++state.n).padStart(3, '0')}`,
    conversationId: 'c1',
    direction,
    type,
    text,
    options,
    createdAt: new Date().toISOString(),
  })
  const customerState = (): OrdoorCustomerState => ({
    conversation: { id: 'c1', stage: 'ORDERING', orientingStep: null, status: state.settlement ? 'SETTLING' : 'COLLECTING', closedReason: null, storeId: 't1', storeName: 'Fake Store', customerName: 'Om', deliveryAddress: null, lines: [] },
    order: state.settlement
      ? { id: 'o1', ref: 'ORD-1', status: 'AWAITING_MERCHANT_REVIEW', storeName: 'Fake Store', subtotal: 60, deliveryFee: 15, total: 75, confirmedAt: null, cancelledAt: null, settlementState: state.settlement, items: [{ name: 'لبن كامل الدسم ١ لتر', quantity: 2, unit: null, unitPrice: 30, lineTotal: 60 }] }
      : null,
  })
  return { state, msg, customerState }
})

vi.mock('../ordoor-client.js', () => ({
  ordoor: {
    reset: vi.fn(async () => ({ abandoned: 0, settling: [] })),
    messagesAfter: vi.fn(async (_phone: string, after: string | null) => {
      const idx = after ? fake.state.messages.findIndex((m) => m.id === after) : fake.state.messages.length - 1
      const messages = fake.state.messages.slice(idx + 1)
      return { messages, cursor: messages.at(-1)?.id ?? after }
    }),
    send: vi.fn(async (_from: string, input: Record<string, unknown>) => {
      fake.state.sent.push(input)
      const before = fake.state.messages.length
      if ('text' in input) {
        fake.state.messages.push(fake.msg('inbound', String(input.text)), fake.msg('outbound', 'أهلاً! ابعتيلي موقعك', 'location_request'))
      } else if ('location' in input) {
        fake.state.messages.push(fake.msg('inbound', 'loc', 'location'), fake.msg('outbound', '٢ لبن كامل الدسم — ٦٠ ج. أأكد؟', 'buttons', [{ position: 1, id: 'CONFIRM:1', title: 'أكد' }, { position: 2, id: 'EDIT:1', title: 'عدّل' }]))
      } else if ('tap' in input) {
        fake.state.messages.push(fake.msg('inbound', 'أكد', 'tap'), fake.msg('outbound', 'بعتنا طلبك للمحل'))
        fake.state.settlement = 'STORE_REVIEW'
        fake.state.store.push({ id: 's1', direction: 'outbound', type: 'buttons', text: 'طلب جديد', options: [{ position: 1, id: 'SET:ok', title: 'تمام' }], createdAt: new Date().toISOString() })
      }
      const replies = fake.state.messages.slice(before).filter((m) => m.direction === 'outbound')
      return { conversationId: 'c1', isNew: before === 0, replies, cursor: fake.state.messages.at(-1)!.id, state: fake.customerState() }
    }),
    customer: vi.fn(async () => fake.customerState()),
    store: vi.fn(async () => ({ orderId: 'o1', settlementState: fake.state.settlement!, version: 1, messages: fake.state.store })),
    actAsStore: vi.fn(async (_orderId: string, input: unknown) => {
      fake.state.storeActs.push(input)
      fake.state.store.push({ id: 's2', direction: 'inbound', type: 'button_reply', text: 'تمام', options: null, createdAt: new Date().toISOString() })
      fake.state.settlement = 'CONFIRMED'
      fake.state.messages.push(fake.msg('outbound', 'المحل أكد طلبك ✅'))
      return { ok: true, store: { orderId: 'o1', settlementState: 'CONFIRMED', version: 2, messages: fake.state.store } }
    }),
  },
}))

// ── A scripted model ─────────────────────────────────────────────────────────────────────────────
vi.mock('../llm/index.js', async (orig) => ({
  ...(await orig<typeof import('../llm/index.js')>()),
  generateJson: vi.fn(async ({ system, user }: { system: string; user: string }) => {
    if (system.includes('QA reviewer')) return { score: 92, summary: 'Fine.', checks: [{ name: 'full fat milk', passed: true, detail: '2 × 1 L' }], issues: [] }
    if (system.includes('owner of a small')) return { action: 'tap', optionId: 'SET:ok', reasoning: 'instruction says confirm' }
    if (user.includes('المحل أكد')) return { action: 'done', goal: 'achieved', reasoning: 'confirmed' }
    if (user.includes('id="CONFIRM:1"')) return { action: 'tap', optionId: 'CONFIRM:1', reasoning: 'summary is right' }
    if (user.includes('(location_request)')) return { action: 'location', reasoning: 'asked for location' }
    return { action: 'text', text: 'السلام عليكم، عايزة ٢ لتر لبن كامل الدسم', reasoning: 'start' }
  }),
}))

const { config } = await import('../config.js')
const { useDb } = await import('../db.js')
const { initStore, saveScenario, getRun } = await import('../store.js')
const { enqueueRun } = await import('../runner.js')
const { ordoor } = await import('../ordoor-client.js')

beforeAll(async () => {
  Object.assign(config, { pollMs: 5, quietMs: 20, drainMaxMs: 500, waitMaxMs: 500 })
  useDb(await pgliteDb())
  await initStore()
})

describe('a run, end to end', () => {
  it('orders, plays the store, ends on the settled order, and is judged', async () => {
    const scenario = await saveScenario({
      personaId: 'per_om_ahmed',
      title: 'milk',
      intent: 'Buy two litres of full fat milk.',
      expectedItems: [{ description: 'full fat milk', quantity: 2, unit: 'litre' }],
      expectedOutcome: 'order_confirmed',
      storeBehaviour: 'Confirm as is.',
      maxTurns: 8,
      resetBeforeRun: true,
    })
    const queued = await enqueueRun(scenario.id)

    let run = (await getRun(queued.id))!
    for (let i = 0; i < 400 && !['completed', 'failed'].includes(run.status); i++) {
      await new Promise((r) => setTimeout(r, 10))
      run = (await getRun(queued.id))!
    }

    expect(run.error).toBeUndefined()
    expect(run.status).toBe('completed')
    expect(ordoor.reset).toHaveBeenCalledWith('201000000101')
    // The tap carries the option's hidden id and its caption.
    expect(fake.state.sent).toEqual([
      { text: 'السلام عليكم، عايزة ٢ لتر لبن كامل الدسم' },
      { location: { lat: 30.0389, lng: 31.2105, address: 'عمارة ١٢ شارع التحرير، الدقي' } },
      { tap: { id: 'CONFIRM:1', title: 'أكد' } },
    ])
    expect(fake.state.storeActs).toEqual([{ tap: { id: 'SET:ok', title: 'تمام' } }])
    expect(run.endReason).toMatch(/settled: CONFIRMED/)
    expect(run.transcript.map((e) => `${e.side}:${e.type}`)).toEqual([
      'customer:text',
      'ordoor:location_request',
      'customer:location',
      'ordoor:buttons',
      'customer:tap',
      'ordoor:text',
      'ordoor:text',
    ])
    expect(run.storeTranscript.find((e) => e.side === 'store_agent')?.reasoning).toBe('instruction says confirm')
    expect(run.evaluation).toMatchObject({ verdict: 'pass', score: 92 })
    expect(run.evaluation!.checks[0]).toMatchObject({ name: 'Outcome: order confirmed by the store', passed: true })
  })
})
