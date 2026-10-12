import { useState } from 'react'

import { api, type Persona, type PersonaInput } from '../api'
import { Modal } from './Modal'

const blank: PersonaInput = {
  name: '',
  phone: '',
  location: { lat: 30.0444, lng: 31.2357, address: '', label: '' },
  character: '',
  language: 'Egyptian Arabic',
  traits: [],
  sendsVoiceNotes: false,
}

export function PersonaForm({ persona, onClose, onSaved }: { persona: Persona | null; onClose: () => void; onSaved: (p: Persona) => void }) {
  const [form, setForm] = useState<PersonaInput>(persona ? strip(persona) : blank)
  const [traits, setTraits] = useState((persona?.traits ?? []).join(', '))
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const set = <K extends keyof PersonaInput>(k: K, v: PersonaInput[K]) => setForm((f) => ({ ...f, [k]: v }))
  const setLoc = (k: keyof PersonaInput['location'], v: string) =>
    setForm((f) => ({ ...f, location: { ...f.location, [k]: k === 'lat' || k === 'lng' ? Number(v) : v } }))

  /** Accepts «30.06, 31.34» or a Google Maps / OSM link. */
  const pasteCoords = (text: string) => {
    const m = text.match(/(-?\d{1,2}\.\d+)[,\s/]+(-?\d{1,3}\.\d+)/)
    if (m) setForm((f) => ({ ...f, location: { ...f.location, lat: Number(m[1]), lng: Number(m[2]) } }))
  }

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      const body: PersonaInput = {
        ...form,
        phone: form.phone.replace(/[\s+-]/g, ''),
        traits: traits.split(',').map((t) => t.trim()).filter(Boolean),
        location: { ...form.location, address: form.location.address?.trim() || undefined, label: form.location.label?.trim() || undefined },
      }
      onSaved(await api.savePersona(body, persona?.id))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title={persona ? `Edit ${persona.name}` : 'New persona'} onClose={onClose}>
      <div className="form">
        <div className="grid2">
          <label>
            Name
            <input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Om Ahmed" />
          </label>
          <label>
            WhatsApp number
            <input value={form.phone} onChange={(e) => set('phone', e.target.value)} placeholder="201000000101" inputMode="numeric" />
            <small>International digits. Must be unique — it is how Ordoor tells customers apart.</small>
          </label>
        </div>
        <label>
          Character
          <textarea rows={4} value={form.character} onChange={(e) => set('character', e.target.value)} placeholder="Age, situation, temperament, how they write…" />
        </label>
        <div className="grid2">
          <label>
            Writes in
            <input value={form.language} onChange={(e) => set('language', e.target.value)} placeholder="Egyptian Arabic" />
          </label>
          <label>
            Traits (comma-separated)
            <input value={traits} onChange={(e) => setTraits(e.target.value)} placeholder="brief, impatient" />
          </label>
        </div>
        <fieldset>
          <legend>Location (sent as a WhatsApp pin)</legend>
          <div className="grid3">
            <label>
              Latitude
              <input type="number" step="any" value={form.location.lat} onChange={(e) => setLoc('lat', e.target.value)} />
            </label>
            <label>
              Longitude
              <input type="number" step="any" value={form.location.lng} onChange={(e) => setLoc('lng', e.target.value)} />
            </label>
            <label>
              Paste coordinates / map link
              <input placeholder="30.06, 31.34" onPaste={(e) => pasteCoords(e.clipboardData.getData('text'))} onChange={(e) => pasteCoords(e.target.value)} />
            </label>
          </div>
          <div className="grid2">
            <label>
              Address text
              <input dir="auto" value={form.location.address ?? ''} onChange={(e) => setLoc('address', e.target.value)} />
            </label>
            <label>
              Label
              <input dir="auto" value={form.location.label ?? ''} onChange={(e) => setLoc('label', e.target.value)} placeholder="البيت" />
            </label>
          </div>
        </fieldset>
        <label className="check">
          <input type="checkbox" checked={form.sendsVoiceNotes} onChange={(e) => set('sendsVoiceNotes', e.target.checked)} />
          Sends voice notes (messages go in as transcribed voice notes)
        </label>
        {error && <div className="alert">{error}</div>}
        <div className="form-actions">
          <button className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn" disabled={saving || !form.name || !form.phone || !form.character} onClick={save}>
            {saving ? 'Saving…' : 'Save persona'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

function strip(p: Persona): PersonaInput {
  const { id: _id, createdAt: _c, updatedAt: _u, ...rest } = p
  return rest
}
