import { useEffect, useState } from 'react'

import { go } from '../App'
import { api, type RunSummary } from '../api'
import { StatusPill, VerdictPill, timeAgo } from './pills'

const LIVE = new Set(['queued', 'running', 'evaluating'])

export function RunsPage() {
  const [runs, setRuns] = useState<RunSummary[]>([])
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<'all' | 'pass' | 'partial' | 'fail' | 'live'>('all')

  useEffect(() => {
    let alive = true
    const load = () =>
      api
        .runs()
        .then((r) => alive && setRuns(r))
        .catch((e: Error) => alive && setError(e.message))
    load()
    const t = setInterval(load, 2500)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [])

  const shown = runs.filter((r) =>
    filter === 'all' ? true : filter === 'live' ? LIVE.has(r.status) : r.evaluation?.verdict === filter,
  )
  const finished = runs.filter((r) => r.evaluation)
  const passRate = finished.length ? Math.round((finished.filter((r) => r.evaluation!.verdict === 'pass').length / finished.length) * 100) : null
  const avgScore = finished.length ? Math.round(finished.reduce((a, r) => a + r.evaluation!.score, 0) / finished.length) : null

  return (
    <div className="page">
      <div className="section-head">
        <h1>Runs</h1>
        <div className="row">
          {(['all', 'live', 'pass', 'partial', 'fail'] as const).map((f) => (
            <button key={f} className={`btn small ${filter === f ? '' : 'ghost'}`} onClick={() => setFilter(f)}>
              {f}
            </button>
          ))}
        </div>
      </div>

      <div className="stats">
        <div className="stat">
          <span className="stat-value">{runs.length}</span>
          <span className="stat-label">runs</span>
        </div>
        <div className="stat">
          <span className="stat-value">{runs.filter((r) => LIVE.has(r.status)).length}</span>
          <span className="stat-label">in progress</span>
        </div>
        <div className="stat">
          <span className="stat-value">{passRate === null ? '—' : `${passRate}%`}</span>
          <span className="stat-label">passed</span>
        </div>
        <div className="stat">
          <span className="stat-value">{avgScore ?? '—'}</span>
          <span className="stat-label">average score</span>
        </div>
      </div>

      {error && <div className="alert">{error}</div>}
      {shown.length === 0 ? (
        <div className="empty">No runs{filter !== 'all' ? ` matching “${filter}”` : ''}. Start one from a persona's scenarios.</div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Scenario</th>
                <th>Persona</th>
                <th>Status</th>
                <th>Verdict</th>
                <th className="num">Msgs</th>
                <th>Started</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.id} onClick={() => go(`/runs/${r.id}`)} className="clickable">
                  <td>
                    <strong>{r.scenario.title}</strong>
                    {r.evaluation?.summary && <div className="muted small clamp">{r.evaluation.summary}</div>}
                    {r.error && <div className="error-text small clamp">{r.error}</div>}
                  </td>
                  <td>{r.persona.name}</td>
                  <td>
                    <StatusPill status={r.status} />
                  </td>
                  <td>{r.evaluation ? <VerdictPill verdict={r.evaluation.verdict} score={r.evaluation.score} /> : <span className="muted">—</span>}</td>
                  <td className="num">{r.customerTurns}</td>
                  <td className="muted small">{timeAgo(r.startedAt ?? r.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
