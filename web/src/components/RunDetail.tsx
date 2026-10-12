import { useEffect, useRef, useState } from 'react'

import { go } from '../App'
import { api, type Run, type TranscriptEntry } from '../api'
import { StatusPill, VerdictPill } from './pills'

const LIVE = new Set(['queued', 'running', 'evaluating'])

export function RunDetail({ id }: { id: string }) {
  const [run, setRun] = useState<Run | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showLog, setShowLog] = useState(false)

  useEffect(() => {
    let alive = true
    let timer: ReturnType<typeof setTimeout>
    const load = async () => {
      try {
        const r = await api.run(id)
        if (!alive) return
        setRun(r)
        if (LIVE.has(r.status)) timer = setTimeout(load, 1500)
      } catch (e) {
        if (alive) setError((e as Error).message)
      }
    }
    void load()
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [id])

  if (error) return <div className="page"><div className="alert">{error}</div></div>
  if (!run) return <div className="page muted">Loading…</div>

  const live = LIVE.has(run.status)
  const ev = run.evaluation
  const order = run.finalState?.order
  const lines = run.finalState?.conversation?.lines ?? []

  return (
    <div className="page">
      <a className="back" href="#/runs">
        ← Runs
      </a>
      <div className="run-header">
        <div className="grow">
          <h1>{run.scenario.title}</h1>
          <div className="muted">
            <a href={`#/personas/${run.personaId}`}>{run.persona.name}</a> · +{run.persona.phone} · {run.customerTurns} customer message{run.customerTurns === 1 ? '' : 's'}
          </div>
        </div>
        <StatusPill status={run.status} />
        {ev && <VerdictPill verdict={ev.verdict} score={ev.score} />}
        {live ? (
          <button className="btn ghost danger" onClick={() => api.stopRun(run.id)}>
            ■ Stop
          </button>
        ) : (
          <>
            <button className="btn" onClick={async () => go(`/runs/${(await api.rerun(run.id)).id}`)}>
              ↻ Run again
            </button>
            <button
              className="btn ghost danger"
              onClick={async () => {
                if (!confirm('Delete this run?')) return
                await api.deleteRun(run.id)
                go('/runs')
              }}
            >
              Delete
            </button>
          </>
        )}
      </div>

      <p className="intent-banner" dir="auto">
        <strong>Intent:</strong> {run.scenario.intent}
      </p>
      {run.error && <div className="alert">{run.error}</div>}

      <div className="run-grid">
        <section className="phone">
          <div className="phone-head">
            <span className="avatar">◎</span>
            <div>
              <strong>Ordoor</strong>
              <small>chat with {run.persona.name}</small>
            </div>
          </div>
          <Chat entries={run.transcript} mine="customer" live={live && run.status === 'running'} />
        </section>

        <div className="side">
          {ev ? (
            <section className="card">
              <h3>Evaluation</h3>
              <p>{ev.summary}</p>
              <ul className="checks">
                {ev.checks.map((c, n) => (
                  <li key={n} className={c.passed ? 'ok' : 'ko'}>
                    <span className="mark">{c.passed ? '✓' : '✕'}</span>
                    <div>
                      <strong>{c.name}</strong>
                      <div className="muted small" dir="auto">
                        {c.detail}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
              {ev.issues.length > 0 && (
                <>
                  <h4>Issues for Ordoor</h4>
                  <ul className="issues">
                    {ev.issues.map((i, n) => (
                      <li key={n} dir="auto">
                        {i}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </section>
          ) : (
            run.status === 'evaluating' && <section className="card muted">Judging the conversation…</section>
          )}

          {run.endReason && (
            <section className="card">
              <h3>Ended</h3>
              <p className="small" dir="auto">
                {run.endReason}
              </p>
            </section>
          )}

          {(order || lines.length > 0) && (
            <section className="card">
              <h3>{order ? `Order ${order.ref}` : 'Basket'}</h3>
              {order && (
                <div className="muted small">
                  {order.storeName} · {order.status}
                  {order.settlementState ? ` · settlement ${order.settlementState}` : ''}
                </div>
              )}
              <table className="table compact">
                <tbody>
                  {(order
                    ? order.items.map((i) => ({ name: i.name, qty: `${i.quantity}${i.unit ? ` ${i.unit}` : ''}`, total: i.lineTotal }))
                    : lines.map((l) => ({ name: l.matchedName ?? `(${l.requested})`, qty: `${l.quantity ?? '?'}${l.unit ? ` ${l.unit}` : ''}`, total: l.lineTotal }))
                  ).map((r, n) => (
                    <tr key={n}>
                      <td dir="auto">{r.name}</td>
                      <td className="num">{r.qty}</td>
                      <td className="num">{r.total ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {order && (
                <div className="totals small">
                  <span>Subtotal {order.subtotal ?? '—'}</span>
                  <span>Delivery {order.deliveryFee ?? '—'}</span>
                  <strong>Total {order.total ?? '—'}</strong>
                </div>
              )}
            </section>
          )}

          {run.storeTranscript.length > 0 && (
            <section className="phone small-phone">
              <div className="phone-head store">
                <span className="avatar">🏪</span>
                <div>
                  <strong>Store side</strong>
                  <small>{run.scenario.storeBehaviour || 'not played'}</small>
                </div>
              </div>
              <Chat entries={run.storeTranscript} mine="store_agent" live={false} />
            </section>
          )}

          <section className="card">
            <button className="link" onClick={() => setShowLog((s) => !s)}>
              {showLog ? '▾' : '▸'} Run log ({run.log.length})
            </button>
            {showLog && <pre className="log">{run.log.join('\n')}</pre>}
          </section>
        </div>
      </div>
    </div>
  )
}

function Chat({ entries, mine, live }: { entries: TranscriptEntry[]; mine: TranscriptEntry['side']; live: boolean }) {
  const end = useRef<HTMLDivElement>(null)
  useEffect(() => end.current?.scrollIntoView({ block: 'nearest' }), [entries.length])
  return (
    <div className="chat">
      {entries.length === 0 && <div className="muted center small">No messages yet.</div>}
      {entries.map((e) =>
        e.side === 'system' ? (
          <div key={e.id} className="system-note" dir="auto" title={e.reasoning}>
            {e.text}
          </div>
        ) : (
          <div key={e.id} className={`bubble-row ${e.side === mine ? 'mine' : 'theirs'}`}>
            <div className={`bubble type-${e.type}`}>
              {e.type === 'tap' && <span className="tag">tapped</span>}
              {e.type === 'voice' && <span className="tag">🎤 voice</span>}
              {e.type === 'location_request' && <span className="tag">📍 asks for location</span>}
              <div className="text" dir="auto">
                {e.text}
              </div>
              {e.options && e.options.length > 0 && (
                <div className="options">
                  {e.options.map((o) => (
                    <span key={o.id} className="option" dir="auto" title={o.id}>
                      {o.title}
                    </span>
                  ))}
                </div>
              )}
              <div className="time">{new Date(e.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</div>
            </div>
            {e.reasoning && <div className="reason">💭 {e.reasoning}</div>}
          </div>
        ),
      )}
      {live && (
        <div className="bubble-row theirs">
          <div className="bubble typing">
            <span />
            <span />
            <span />
          </div>
        </div>
      )}
      <div ref={end} />
    </div>
  )
}
