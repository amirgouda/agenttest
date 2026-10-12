/**
 * Ordoor's WhatsApp simulator API — the only way this app reaches Ordoor.
 *
 * Ordoor side: `code/app/api/simulator/whatsapp/*`. Every conversation it opens is a rehearsal, so
 * nothing here can reach a real phone.
 */
import { config } from './config.js'
import type { OrdoorCustomerState, OrdoorMessage, OrdoorStoreSide } from './types.js'

export class OrdoorError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
  }
}

async function call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  if (!config.ordoor.token) throw new OrdoorError('ORDOOR_SIMULATOR_TOKEN is not set', 0)
  let res: Response
  try {
    res = await fetch(`${config.ordoor.baseUrl}${path}`, {
      method,
      headers: { authorization: `Bearer ${config.ordoor.token}`, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      // A turn runs Ordoor's agents end to end — it can take a while.
      signal: AbortSignal.timeout(180_000),
    })
  } catch (err) {
    throw new OrdoorError(`Ordoor is unreachable at ${config.ordoor.baseUrl}: ${(err as Error).message}`, 0)
  }
  const text = await res.text()
  let json: unknown = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    // fall through with the raw text
  }
  if (!res.ok) {
    const detail = (json as { error?: string } | null)?.error ?? text.slice(0, 200)
    const hint = res.status === 404 && path.startsWith('/api/simulator') ? ' (is WHATSAPP_SIMULATOR_TOKEN set in Ordoor?)' : ''
    throw new OrdoorError(`Ordoor ${method} ${path} → ${res.status}: ${detail}${hint}`, res.status)
  }
  return json as T
}

export type CustomerInput =
  | { text: string; voice?: boolean }
  | { location: { lat: number; lng: number; address?: string | null } }
  | { tap: { id: string; title: string } }

export interface SendResult {
  conversationId: string
  isNew: boolean
  replies: OrdoorMessage[]
  cursor: string | null
  state: OrdoorCustomerState
}

const q = encodeURIComponent

export const ordoor = {
  send: (from: string, input: CustomerInput) => call<SendResult>('POST', '/api/simulator/whatsapp/messages', { from, ...input }),
  messagesAfter: (phone: string, after: string | null) =>
    call<{ messages: OrdoorMessage[]; cursor: string | null }>('GET', `/api/simulator/whatsapp/messages?phone=${q(phone)}${after ? `&after=${q(after)}` : ''}`),
  customer: (phone: string) => call<OrdoorCustomerState>('GET', `/api/simulator/whatsapp/customers?phone=${q(phone)}`),
  reset: (phone: string) =>
    call<{ abandoned: number; settling: Array<{ conversationId: string; orderId: string | null }> }>('POST', '/api/simulator/whatsapp/customers', { phone, action: 'reset' }),
  store: (orderId: string) => call<OrdoorStoreSide>('GET', `/api/simulator/whatsapp/orders/${q(orderId)}/store`),
  actAsStore: (orderId: string, input: { text: string } | { tap: { id: string; title: string } }) =>
    call<{ ok: true; store: OrdoorStoreSide | null }>('POST', `/api/simulator/whatsapp/orders/${q(orderId)}/store`, input),
}
