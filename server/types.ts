/** Domain types shared by the server and (via `web/src/api.ts`) the web app. */

export interface PersonaLocation {
  lat: number
  lng: number
  /** The text a WhatsApp location carries with it (building, street). Optional. */
  address?: string
  /** What the persona calls it — «البيت», "work". Only used in the prompt. */
  label?: string
}

/** Who the simulated customer is. Each persona has its own WhatsApp number. */
export interface Persona {
  id: string
  name: string
  /** The persona's WhatsApp number, international digits (e.g. 201000000101). Unique per persona. */
  phone: string
  location: PersonaLocation
  /** Free text: age, situation, temperament, how they write. The agent plays this. */
  character: string
  /** e.g. "Egyptian Arabic", "Franco-Arabic", "English". */
  language: string
  /** Short traits that shape behaviour: "brief", "indecisive", "asks about prices"… */
  traits: string[]
  /** Sends text as a transcribed voice note (Ordoor answers a voice note in kind). */
  sendsVoiceNotes: boolean
  createdAt: string
  updatedAt: string
}

export interface ExpectedItem {
  /** What should end up in the order, in plain words: "full fat milk". */
  description: string
  quantity?: number
  /** "litre", "kg", "piece", "pack"… */
  unit?: string
}

/**
 * - `order_confirmed`: the store confirmed the order (store side driven by `storeBehaviour`).
 * - `order_placed`: the customer confirmed; whatever the store does next.
 * - `no_order`: the scenario must NOT end in an order (e.g. the customer cancels).
 * - `any`: judged on the conversation alone.
 */
export type ExpectedOutcome = 'order_confirmed' | 'order_placed' | 'no_order' | 'any'

/** What a persona wants to do in one test. */
export interface Scenario {
  id: string
  personaId: string
  title: string
  /** The goal in plain words — "buy two litres of full fat milk". */
  intent: string
  expectedItems: ExpectedItem[]
  expectedOutcome: ExpectedOutcome
  /**
   * How the agent plays the STORE once the order reaches it — free text for the store-side model
   * ("confirm everything as is", "say the 2L milk is out of stock and offer 1L"). Empty: the store
   * side is left alone (the order waits, as it would for a store that never answers).
   */
  storeBehaviour: string
  /** Hard cap on customer messages. */
  maxTurns: number
  /** Close this number's unfinished attempt first, so the scenario starts a new one. */
  resetBeforeRun: boolean
  notes?: string
  createdAt: string
  updatedAt: string
}

export interface MessageOption {
  position: number
  id: string
  title: string
  description?: string | null
}

export type TranscriptSide = 'customer' | 'ordoor' | 'store' | 'store_agent' | 'system'

export interface TranscriptEntry {
  /** Ordoor's message id when it came from Ordoor; ours otherwise. */
  id: string
  side: TranscriptSide
  /** text | tap | location | voice | buttons | list | location_request | link | … */
  type: string
  text: string
  options?: MessageOption[] | null
  at: string
  /** The agent's own reason for this message (customer / store agent only). */
  reasoning?: string
}

export type RunStatus = 'queued' | 'running' | 'evaluating' | 'completed' | 'failed' | 'stopped'

export interface EvaluationCheck {
  name: string
  passed: boolean
  detail: string
}

export interface Evaluation {
  verdict: 'pass' | 'partial' | 'fail'
  /** 0–100. */
  score: number
  summary: string
  checks: EvaluationCheck[]
  /** Problems in ORDOOR's behaviour worth a look — wrong item, repeated question, rude tone… */
  issues: string[]
}

export interface Run {
  id: string
  batchId?: string
  personaId: string
  scenarioId: string
  /** Copies at start time — a run stays readable after its persona or scenario is edited. */
  persona: Persona
  scenario: Scenario
  status: RunStatus
  createdAt: string
  startedAt?: string
  finishedAt?: string
  customerTurns: number
  /** Why the conversation ended: the agent's own words, a finished order, or the turn cap. */
  endReason?: string
  transcript: TranscriptEntry[]
  /** What the store's WhatsApp would have shown, and the store agent's answers. */
  storeTranscript: TranscriptEntry[]
  /** Ordoor's view of the customer at the end (`GET /api/simulator/whatsapp/customers`). */
  finalState?: OrdoorCustomerState
  evaluation?: Evaluation
  error?: string
  /** Timing and decisions, for debugging the run itself. */
  log: string[]
}

// ── Ordoor's simulator API (mirrors `code/lib/services/order-taking/simulator-api/read.ts`) ─────────

export interface OrdoorMessage {
  id: string
  conversationId: string
  direction: 'inbound' | 'outbound'
  type: string
  text: string
  options: MessageOption[] | null
  createdAt: string
}

export interface OrdoorCustomerState {
  conversation: {
    id: string
    stage: string
    orientingStep: string | null
    status: string
    closedReason: string | null
    storeId: string | null
    storeName: string | null
    customerName: string | null
    deliveryAddress: string | null
    lines: Array<{
      lineNo: number
      requested: string
      matchedName: string | null
      quantity: number | null
      unit: string | null
      unitPrice: number | null
      lineTotal: number | null
      status: string
    }>
  } | null
  order: {
    id: string
    ref: string
    status: string
    storeName: string
    subtotal: number | null
    deliveryFee: number | null
    total: number | null
    confirmedAt: string | null
    cancelledAt: string | null
    settlementState: string | null
    items: Array<{ name: string; quantity: number; unit: string | null; unitPrice: number | null; lineTotal: number | null }>
  } | null
}

export interface OrdoorStoreSide {
  orderId: string
  settlementState: string
  version: number
  messages: Array<{ id: string; direction: 'inbound' | 'outbound'; type: string; text: string; options: MessageOption[] | null; createdAt: string }>
}
