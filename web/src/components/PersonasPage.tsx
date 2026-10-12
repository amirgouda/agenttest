import { useCallback, useEffect, useState } from 'react'

import { go } from '../App'
import { api, type Persona, type Scenario } from '../api'
import { PersonaForm } from './PersonaForm'
import { ScenarioForm } from './ScenarioForm'

const OUTCOME_LABEL: Record<Scenario['expectedOutcome'], string> = {
  order_confirmed: 'Order confirmed by store',
  order_placed: 'Order placed',
  no_order: 'No order',
  any: 'Any outcome',
}

export function PersonasPage({ selectedId }: { selectedId?: string }) {
  const [personas, setPersonas] = useState<Persona[]>([])
  const [scenarios, setScenarios] = useState<Scenario[]>([])
  const [editingPersona, setEditingPersona] = useState<Persona | 'new' | null>(null)
  const [editingScenario, setEditingScenario] = useState<Scenario | 'new' | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const [p, s] = await Promise.all([api.personas(), api.scenarios()])
    setPersonas(p)
    setScenarios(s)
  }, [])
  useEffect(() => {
    load().catch((e: Error) => setError(e.message))
  }, [load])

  const selected = personas.find((p) => p.id === selectedId) ?? personas[0]
  const theirs = scenarios.filter((s) => s.personaId === selected?.id)

  const run = async (body: Parameters<typeof api.startRuns>[0]) => {
    setError(null)
    try {
      const runs = await api.startRuns(body)
      go(runs.length === 1 ? `/runs/${runs[0]!.id}` : '/runs')
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <div className="split">
      <aside className="sidebar">
        <div className="sidebar-head">
          <h2>Personas</h2>
          <button className="btn small" onClick={() => setEditingPersona('new')}>
            + New
          </button>
        </div>
        <ul className="persona-list">
          {personas.map((p) => (
            <li key={p.id}>
              <a href={`#/personas/${p.id}`} className={p.id === selected?.id ? 'active' : ''}>
                <span className="avatar">{initials(p.name)}</span>
                <span className="persona-meta">
                  <strong>{p.name}</strong>
                  <small>
                    +{p.phone} · {p.language}
                  </small>
                </span>
                <span className="count">{scenarios.filter((s) => s.personaId === p.id).length}</span>
              </a>
            </li>
          ))}
        </ul>
        <button className="btn ghost wide" disabled={!scenarios.length} onClick={() => run({ all: true })}>
          ▶ Run every scenario
        </button>
      </aside>

      <section className="panel">
        {error && <div className="alert">{error}</div>}
        {!selected ? (
          <div className="empty">No personas yet. Create one to start.</div>
        ) : (
          <>
            <div className="persona-header">
              <span className="avatar large">{initials(selected.name)}</span>
              <div className="grow">
                <h1>{selected.name}</h1>
                <div className="muted">
                  +{selected.phone} · {selected.language}
                  {selected.sendsVoiceNotes ? ' · 🎤 voice notes' : ''}
                </div>
              </div>
              <button className="btn ghost" onClick={() => setEditingPersona(selected)}>
                Edit
              </button>
              <button
                className="btn ghost danger"
                onClick={async () => {
                  if (!confirm(`Delete ${selected.name} and their scenarios?`)) return
                  await api.deletePersona(selected.id)
                  go('/personas')
                  await load()
                }}
              >
                Delete
              </button>
            </div>

            <div className="persona-facts">
              <div>
                <h4>Character</h4>
                <p>{selected.character}</p>
                {selected.traits.length > 0 && (
                  <div className="chips">
                    {selected.traits.map((t) => (
                      <span className="chip" key={t}>
                        {t}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <h4>Location</h4>
                <p dir="auto">
                  {selected.location.label && <strong>{selected.location.label} · </strong>}
                  {selected.location.address || '—'}
                </p>
                <a className="muted small" href={`https://www.openstreetmap.org/?mlat=${selected.location.lat}&mlon=${selected.location.lng}#map=17/${selected.location.lat}/${selected.location.lng}`} target="_blank" rel="noreferrer">
                  {selected.location.lat.toFixed(5)}, {selected.location.lng.toFixed(5)} ↗
                </a>
              </div>
            </div>

            <div className="section-head">
              <h2>Scenarios</h2>
              <div className="row">
                <button className="btn ghost" disabled={!theirs.length} onClick={() => run({ personaId: selected.id })}>
                  ▶ Run all ({theirs.length})
                </button>
                <button className="btn" onClick={() => setEditingScenario('new')}>
                  + New scenario
                </button>
              </div>
            </div>

            {theirs.length === 0 ? (
              <div className="empty">No scenarios for {selected.name} yet.</div>
            ) : (
              <div className="scenario-grid">
                {theirs.map((s) => (
                  <article className="card scenario" key={s.id}>
                    <header>
                      <h3>{s.title}</h3>
                      <span className={`pill outcome-${s.expectedOutcome}`}>{OUTCOME_LABEL[s.expectedOutcome]}</span>
                    </header>
                    <p className="intent" dir="auto">
                      {s.intent}
                    </p>
                    {s.expectedItems.length > 0 && (
                      <ul className="items">
                        {s.expectedItems.map((i, n) => (
                          <li key={n}>
                            {[i.quantity, i.unit].filter(Boolean).join(' ')} {i.description}
                          </li>
                        ))}
                      </ul>
                    )}
                    <div className="muted small">
                      Store: {s.storeBehaviour || 'not played'} · max {s.maxTurns} messages{s.resetBeforeRun ? ' · fresh start' : ''}
                    </div>
                    <footer>
                      <button className="btn" onClick={() => run({ scenarioIds: [s.id] })}>
                        ▶ Run
                      </button>
                      <button className="btn ghost" onClick={() => setEditingScenario(s)}>
                        Edit
                      </button>
                      <button
                        className="btn ghost danger"
                        onClick={async () => {
                          if (!confirm(`Delete scenario "${s.title}"?`)) return
                          await api.deleteScenario(s.id)
                          await load()
                        }}
                      >
                        Delete
                      </button>
                    </footer>
                  </article>
                ))}
              </div>
            )}
          </>
        )}
      </section>

      {editingPersona && (
        <PersonaForm
          persona={editingPersona === 'new' ? null : editingPersona}
          onClose={() => setEditingPersona(null)}
          onSaved={async (p) => {
            setEditingPersona(null)
            await load()
            go(`/personas/${p.id}`)
          }}
        />
      )}
      {editingScenario && selected && (
        <ScenarioForm
          personaId={selected.id}
          scenario={editingScenario === 'new' ? null : editingScenario}
          onClose={() => setEditingScenario(null)}
          onSaved={async () => {
            setEditingScenario(null)
            await load()
          }}
        />
      )}
    </div>
  )
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('')
}
