/**
 * Runs scenarios: the customer agent talks to Ordoor through the simulator API, the store agent
 * answers the store's side, and the judge grades the result.
 *
 * Runs are queued and executed `RUN_CONCURRENCY` at a time, never two on the same number at once
 * (they would share one conversation). Every step is saved, so the web app shows a run live.
 */
import { decideCustomerMove, type CustomerDecision } from './agents/customer.js'
import { evaluateRun } from './agents/judge.js'
import { decideStoreMove } from './agents/store.js'
import { latestOptions, resolveOption } from './agents/transcript.js'
import { config } from './config.js'
import { ordoor, type CustomerInput } from './ordoor-client.js'
import { ValidationError, claimRun, failInterruptedRuns, getPersona, getScenario, newId, queuedRuns, saveRun, stopQueuedRun } from './store.js'
import type { OrdoorCustomerState, OrdoorMessage, OrdoorStoreSide, Run, TranscriptEntry } from './types.js'

/** Settlement states in which the STORE is expected to act. */
const STORE_TURN = new Set(['STORE_REVIEW', 'STORE_EDITING', 'STORE_READBACK', 'STORE_FINAL_CHECK', 'STORE_CANCEL_CONFIRM', 'STORE_CANCEL_REASON', 'CANCEL_AFTER_CONFIRM_CONFIRM'])
/** Settlement states after which there is nothing left to test in this conversation. */
const SETTLEMENT_OVER = new Set(['CONFIRMED', 'OUT_FOR_DELIVERY', 'CANCELLED_BY_STORE', 'CANCELLED_BY_STORE_AFTER_CONFIRM', 'CANCELLED_BY_CUSTOMER', 'NO_STORE_RESPONSE', 'NO_CUSTOMER_RESPONSE'])

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const nowIso = () => new Date().toISOString()

// ── Queue ────────────────────────────────────────────────────────────────────────────────────────

const active = new Map<string, { phone: string; stop: boolean }>()

/** After a restart: what was mid-way failed; what was queued is picked up again. */
export async function recoverRunsAfterRestart(): Promise<void> {
  const failed = await failInterruptedRuns()
  if (failed) console.log(`  ${failed} interrupted run(s) marked failed`)
  schedulePump()
}

export async function enqueueRun(scenarioId: string, batchId?: string): Promise<Run> {
  const scenario = await getScenario(scenarioId)
  if (!scenario) throw new ValidationError(`Unknown scenario ${scenarioId}`)
  const persona = await getPersona(scenario.personaId)
  if (!persona) throw new ValidationError(`Scenario ${scenario.title} has no persona`)
  const run: Run = {
    id: newId('run'),
    ...(batchId ? { batchId } : {}),
    personaId: persona.id,
    scenarioId: scenario.id,
    persona,
    scenario,
    status: 'queued',
    createdAt: nowIso(),
    customerTurns: 0,
    transcript: [],
    storeTranscript: [],
    log: [],
  }
  await saveRun(run)
  schedulePump()
  return run
}

export async function stopRun(id: string): Promise<boolean> {
  const handle = active.get(id)
  if (handle) {
    handle.stop = true
    return true
  }
  return stopQueuedRun(id)
}

// One pump at a time; a request while it runs makes it go round once more.
let pumping = false
let pumpAgain = false

function schedulePump(): void {
  if (pumping) {
    pumpAgain = true
    return
  }
  pumping = true
  void pump()
    .catch((err: Error) => console.error('run queue:', err.message))
    .finally(() => {
      pumping = false
      if (pumpAgain) {
        pumpAgain = false
        schedulePump()
      }
    })
}

async function pump(): Promise<void> {
  if (active.size >= config.runConcurrency) return
  const busyPhones = new Set([...active.values()].map((a) => a.phone))
  for (const queued of await queuedRuns()) {
    if (active.size >= config.runConcurrency) return
    if (busyPhones.has(queued.persona.phone)) continue
    const run = await claimRun(queued.id)
    if (!run) continue
    busyPhones.add(run.persona.phone)
    const handle = { phone: run.persona.phone, stop: false }
    active.set(run.id, handle)
    void execute(run, handle).finally(() => {
      active.delete(run.id)
      schedulePump()
    })
  }
}

// ── One run ──────────────────────────────────────────────────────────────────────────────────────

class RunContext {
  cursor: string | null = null
  readonly seen = new Set<string>()
  /** The store agent's reasons, by the Ordoor id of the store message it produced. */
  readonly storeReasons = new Map<string, string>()
  private dirty = false
  private writing: Promise<void> | null = null

  constructor(public run: Run, readonly handle: { stop: boolean }) {}

  get phone() {
    return this.run.persona.phone
  }

  /**
   * Saved in the background so a run never waits on the database between steps — writes are
   * coalesced (one in flight, the newest state next) and `flush()` waits for the last one.
   */
  save(patch: Partial<Run> = {}) {
    this.run = { ...this.run, ...patch }
    this.dirty = true
    if (!this.writing) this.writing = this.writeLoop()
  }

  private async writeLoop(): Promise<void> {
    try {
      while (this.dirty) {
        this.dirty = false
        await saveRun(this.run)
      }
    } catch (err) {
      console.error(`run ${this.run.id}: could not save:`, (err as Error).message)
    } finally {
      this.writing = null
    }
  }

  async flush(): Promise<void> {
    while (this.writing) await this.writing
    if (this.dirty) await (this.writing = this.writeLoop())
  }

  log(line: string) {
    this.run.log.push(`${new Date().toISOString().slice(11, 19)} ${line}`)
    this.save()
  }

  add(entry: TranscriptEntry) {
    this.run.transcript.push(entry)
    this.save()
  }

  /** Ordoor's messages to the customer — each once, whichever read found it first. */
  addOrdoorMessages(messages: OrdoorMessage[]): number {
    let added = 0
    for (const m of messages) {
      if (m.direction !== 'outbound' || this.seen.has(m.id)) continue
      this.seen.add(m.id)
      this.run.transcript.push({ id: m.id, side: 'ordoor', type: m.type, text: m.text, options: m.options, at: m.createdAt })
      added++
    }
    if (added) this.save()
    return added
  }
}

async function execute(initial: Run, handle: { stop: boolean }): Promise<void> {
  const ctx = new RunContext(initial, handle)
  const { persona, scenario } = ctx.run
  try {
    if (scenario.resetBeforeRun) {
      const reset = await ordoor.reset(persona.phone)
      ctx.log(`reset: ${reset.abandoned} unfinished attempt(s) closed`)
      if (reset.settling.length) {
        ctx.add({
          id: newId('sys'),
          side: 'system',
          type: 'text',
          text: `⚠️ This number still has ${reset.settling.length} order(s) with the store (${reset.settling.map((s) => s.orderId).join(', ')}). Ordoor will treat new messages as about that order until it ends — finish or cancel it from the store side, or give this persona a fresh number.`,
          at: nowIso(),
        })
      }
    }
    ctx.cursor = (await ordoor.messagesAfter(persona.phone, null)).cursor
    for (const id of [ctx.cursor].filter(Boolean) as string[]) ctx.seen.add(id)

    let state: OrdoorCustomerState | undefined
    let turn = 0
    while (true) {
      if (handle.stop) {
        ctx.save({ endReason: 'Stopped by the user.' })
        break
      }
      if (turn >= scenario.maxTurns) {
        ctx.save({ endReason: `Reached the limit of ${scenario.maxTurns} customer messages.` })
        break
      }
      turn++

      const decision = await decideCustomerMove({ persona, scenario, transcript: ctx.run.transcript, turn, maxTurns: scenario.maxTurns })
      ctx.log(`turn ${turn}: ${decision.action}${decision.goal ? ` (${decision.goal})` : ''} — ${decision.reasoning}`)

      if (decision.action === 'done') {
        ctx.save({ endReason: `Customer finished (${decision.goal ?? 'no goal stated'}): ${decision.reasoning}` })
        break
      }
      if (decision.action === 'wait') {
        ctx.add({ id: newId('wait'), side: 'system', type: 'wait', text: '⏳ customer waits', at: nowIso(), reasoning: decision.reasoning })
        const got = await drain(ctx, { maxMs: config.waitMaxMs, untilAny: true })
        if (!got) ctx.log('wait: Ordoor said nothing')
      } else {
        const input = toInput(ctx, decision)
        ctx.save({ customerTurns: ctx.run.customerTurns + 1 })
        // Shown before Ordoor answers, so the web app shows the run as it happens.
        ctx.add({ ...input.entry, id: newId('cus') })
        const sent = await ordoor.send(persona.phone, input.input)
        ctx.addOrdoorMessages(sent.replies)
        if (sent.cursor) ctx.cursor = sent.cursor
        await drain(ctx)
      }

      state = await ordoor.customer(persona.phone)
      if (state.order && scenario.storeBehaviour.trim()) {
        await playStore(ctx, state.order.id)
        state = await ordoor.customer(persona.phone)
      }
      const over = conversationOver(state)
      if (over) {
        // One last read: the store's answer may still be on its way to the customer.
        await drain(ctx)
        ctx.save({ endReason: over })
        break
      }
    }

    const finalState = await ordoor.customer(persona.phone)
    if (finalState.order) await syncStore(ctx, finalState.order.id).catch(() => undefined)
    ctx.save({ finalState, status: 'evaluating' })
    try {
      ctx.save({ evaluation: await evaluateRun(ctx.run) })
    } catch (err) {
      ctx.log(`judge failed: ${(err as Error).message}`)
    }
    ctx.save({ status: handle.stop ? 'stopped' : 'completed', finishedAt: nowIso() })
  } catch (err) {
    ctx.log(`error: ${(err as Error).message}`)
    ctx.save({ status: 'failed', error: (err as Error).message, finishedAt: nowIso() })
  } finally {
    // The run's last state is in the database before its slot is given to the next one.
    await ctx.flush()
  }
}

function toInput(ctx: RunContext, d: CustomerDecision): { input: CustomerInput; entry: Omit<TranscriptEntry, 'id'> } {
  const { persona } = ctx.run
  const at = nowIso()
  if (d.action === 'location') {
    const loc = persona.location
    return {
      input: { location: { lat: loc.lat, lng: loc.lng, address: loc.address ?? null } },
      entry: { side: 'customer', type: 'location', text: `📍 ${[loc.label, loc.address].filter(Boolean).join(' — ') || `${loc.lat}, ${loc.lng}`}`, at, reasoning: d.reasoning },
    }
  }
  if (d.action === 'tap') {
    const option = resolveOption(latestOptions(ctx.run.transcript, ['ordoor']), d.optionId ?? undefined)
    if (option) {
      return { input: { tap: { id: option.id, title: option.title } }, entry: { side: 'customer', type: 'tap', text: option.title, at, reasoning: d.reasoning } }
    }
    ctx.log(`tap: no option "${d.optionId}" on screen — sending it as text`)
  }
  const text = (d.text ?? d.optionId ?? '').trim() || '؟'
  return {
    input: { text, ...(persona.sendsVoiceNotes ? { voice: true } : {}) },
    entry: { side: 'customer', type: persona.sendsVoiceNotes ? 'voice' : 'text', text, at, reasoning: d.reasoning },
  }
}

/**
 * Read what Ordoor says after a message, until it has been quiet for `quietMs` (or, with `untilAny`,
 * until it has said something and then gone quiet). Returns whether anything new arrived.
 */
async function drain(ctx: RunContext, opts: { maxMs?: number; untilAny?: boolean } = {}): Promise<boolean> {
  const maxMs = opts.maxMs ?? config.drainMaxMs
  const start = Date.now()
  let lastNew = Date.now()
  let gotAny = false
  while (Date.now() - start < maxMs && !ctx.handle.stop) {
    await sleep(config.pollMs)
    const read = await ordoor.messagesAfter(ctx.phone, ctx.cursor)
    if (read.cursor) ctx.cursor = read.cursor
    if (ctx.addOrdoorMessages(read.messages) > 0) {
      lastNew = Date.now()
      gotAny = true
    }
    const quiet = Date.now() - lastNew >= config.quietMs
    if (quiet && (!opts.untilAny || gotAny)) break
  }
  return gotAny
}

function conversationOver(state: OrdoorCustomerState): string | null {
  const order = state.order
  if (order?.settlementState && SETTLEMENT_OVER.has(order.settlementState)) return `Order ${order.ref} settled: ${order.settlementState}.`
  if (order?.cancelledAt) return `Order ${order.ref} cancelled.`
  if (order && !order.settlementState && state.conversation?.status === 'CONFIRMED') return `Order ${order.ref} placed (no store settlement).`
  if (state.conversation?.status === 'ABANDONED') return `Conversation closed: ${state.conversation.closedReason ?? 'abandoned'}.`
  return null
}

// ── The store's side ─────────────────────────────────────────────────────────────────────────────

async function syncStore(ctx: RunContext, orderId: string): Promise<OrdoorStoreSide | null> {
  let side: OrdoorStoreSide
  try {
    side = await ordoor.store(orderId)
  } catch {
    return null
  }
  ctx.run.storeTranscript = side.messages.map((m) => ({
    id: m.id,
    side: m.direction === 'outbound' ? 'store' : 'store_agent',
    type: m.type,
    text: m.text,
    options: m.options,
    at: m.createdAt,
    ...(ctx.storeReasons.has(m.id) ? { reasoning: ctx.storeReasons.get(m.id)! } : {}),
  }))
  ctx.save()
  return side
}

async function playStore(ctx: RunContext, orderId: string): Promise<void> {
  for (let step = 0; step < config.maxStoreStepsPerTurn && !ctx.handle.stop; step++) {
    let side = await syncStore(ctx, orderId)
    if (!side) return
    if (side.settlementState === 'QUEUED') {
      ctx.log('store: order is queued behind another rehearsal order on the same store number')
      return
    }
    if (!STORE_TURN.has(side.settlementState)) return
    // Our last answer is still being read by Ordoor: give it a moment, once.
    if (side.messages.at(-1)?.direction === 'inbound') {
      await sleep(config.quietMs)
      side = await syncStore(ctx, orderId)
      if (!side || side.messages.at(-1)?.direction === 'inbound' || !STORE_TURN.has(side.settlementState)) return
    }

    const decision = await decideStoreMove({ scenario: ctx.run.scenario, storeTranscript: ctx.run.storeTranscript, settlementState: side.settlementState })
    ctx.log(`store: ${decision.action} — ${decision.reasoning}`)
    if (decision.action === 'none') return

    const before = new Set(side.messages.map((m) => m.id))
    const option = decision.action === 'tap' ? resolveOption(latestOptions(ctx.run.storeTranscript, ['store']), decision.optionId ?? undefined) : undefined
    const text = (decision.text ?? decision.optionId ?? '').trim()
    if (!option && !text) return
    const acted = await ordoor.actAsStore(orderId, option ? { tap: { id: option.id, title: option.title } } : { text })
    const mine = acted.store?.messages.find((m) => m.direction === 'inbound' && !before.has(m.id))
    if (mine) ctx.storeReasons.set(mine.id, decision.reasoning)
    await syncStore(ctx, orderId)
    // What the store's action told the customer.
    await drain(ctx)
  }
}
