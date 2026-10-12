import { useState } from 'react'

import { api, type ExpectedItem, type Scenario, type ScenarioInput } from '../api'
import { Modal } from './Modal'

const STORE_PRESETS = [
  'Confirm the order exactly as it is, with a delivery fee of 15 EGP if one is needed.',
  'Cancel the order: the store is closed.',
  'Say one item is not available and offer a similar product instead; confirm the rest.',
]

export function ScenarioForm({ personaId, scenario, onClose, onSaved }: { personaId: string; scenario: Scenario | null; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<ScenarioInput>(
    scenario
      ? strip(scenario)
      : { personaId, title: '', intent: '', expectedItems: [], expectedOutcome: 'order_confirmed', storeBehaviour: STORE_PRESETS[0]!, maxTurns: 14, resetBeforeRun: true, notes: '' },
  )
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const set = <K extends keyof ScenarioInput>(k: K, v: ScenarioInput[K]) => setForm((f) => ({ ...f, [k]: v }))

  const setItem = (n: number, patch: Partial<ExpectedItem>) => set('expectedItems', form.expectedItems.map((it, i) => (i === n ? { ...it, ...patch } : it)))

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      await api.saveScenario(
        {
          ...form,
          notes: form.notes?.trim() || undefined,
          expectedItems: form.expectedItems
            .filter((i) => i.description.trim())
            .map((i) => ({ description: i.description.trim(), ...(i.quantity ? { quantity: Number(i.quantity) } : {}), ...(i.unit?.trim() ? { unit: i.unit.trim() } : {}) })),
        },
        scenario?.id,
      )
      onSaved()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title={scenario ? 'Edit scenario' : 'New scenario'} onClose={onClose}>
      <div className="form">
        <label>
          Title
          <input value={form.title} onChange={(e) => set('title', e.target.value)} placeholder="Two litres of full-fat milk" />
        </label>
        <label>
          Intent — what the customer wants, in plain words
          <textarea dir="auto" rows={3} value={form.intent} onChange={(e) => set('intent', e.target.value)} placeholder="Buy two litres of full fat milk." />
          <small>The customer agent pursues this. Describe twists here too («add honey halfway», «cancel at the summary»).</small>
        </label>

        <fieldset>
          <legend>Expected items (graded at the end)</legend>
          {form.expectedItems.map((it, n) => (
            <div className="item-row" key={n}>
              <input type="number" min={0} step="any" placeholder="Qty" value={it.quantity ?? ''} onChange={(e) => setItem(n, { quantity: e.target.value ? Number(e.target.value) : undefined })} />
              <input placeholder="Unit" value={it.unit ?? ''} onChange={(e) => setItem(n, { unit: e.target.value })} />
              <input dir="auto" placeholder="Description (full fat milk)" value={it.description} onChange={(e) => setItem(n, { description: e.target.value })} />
              <button className="btn ghost small" onClick={() => set('expectedItems', form.expectedItems.filter((_, i) => i !== n))}>
                ✕
              </button>
            </div>
          ))}
          <button className="btn ghost small" onClick={() => set('expectedItems', [...form.expectedItems, { description: '' }])}>
            + Add item
          </button>
        </fieldset>

        <div className="grid2">
          <label>
            Expected outcome
            <select value={form.expectedOutcome} onChange={(e) => set('expectedOutcome', e.target.value as ScenarioInput['expectedOutcome'])}>
              <option value="order_confirmed">Order confirmed by the store</option>
              <option value="order_placed">Order placed by the customer</option>
              <option value="no_order">No order (e.g. customer cancels)</option>
              <option value="any">Any — judge the conversation only</option>
            </select>
          </label>
          <label>
            Max customer messages
            <input type="number" min={1} max={60} value={form.maxTurns} onChange={(e) => set('maxTurns', Number(e.target.value))} />
          </label>
        </div>

        <label>
          Store behaviour — how the agent answers as the store
          <textarea rows={2} value={form.storeBehaviour} onChange={(e) => set('storeBehaviour', e.target.value)} placeholder="Leave empty to not play the store." />
          <span className="chips">
            {STORE_PRESETS.map((p) => (
              <button key={p} type="button" className="chip button" onClick={() => set('storeBehaviour', p)}>
                {p.split(':')[0]!.split(',')[0]}
              </button>
            ))}
            <button type="button" className="chip button" onClick={() => set('storeBehaviour', '')}>
              Don't play the store
            </button>
          </span>
        </label>

        <label>
          Notes for the customer agent (optional)
          <textarea rows={2} value={form.notes ?? ''} onChange={(e) => set('notes', e.target.value)} />
        </label>

        <label className="check">
          <input type="checkbox" checked={form.resetBeforeRun} onChange={(e) => set('resetBeforeRun', e.target.checked)} />
          Start fresh — close this number's unfinished conversation before running
        </label>

        {error && <div className="alert">{error}</div>}
        <div className="form-actions">
          <button className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn" disabled={saving || !form.title || !form.intent} onClick={save}>
            {saving ? 'Saving…' : 'Save scenario'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

function strip(s: Scenario): ScenarioInput {
  const { id: _id, createdAt: _c, updatedAt: _u, ...rest } = s
  return rest
}
