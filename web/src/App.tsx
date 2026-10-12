import { useEffect, useState } from 'react'

import { api, type Health } from './api'
import { PersonasPage } from './components/PersonasPage'
import { RunDetail } from './components/RunDetail'
import { RunsPage } from './components/RunsPage'

/** `#/personas`, `#/personas/<id>`, `#/runs`, `#/runs/<id>`. */
function useHashRoute(): string[] {
  const read = () => window.location.hash.replace(/^#\/?/, '').split('/').filter(Boolean)
  const [parts, setParts] = useState(read)
  useEffect(() => {
    const on = () => setParts(read())
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  return parts
}

export const go = (path: string) => {
  window.location.hash = path
}

export function App() {
  const [section = 'personas', param] = useHashRoute()
  const [health, setHealth] = useState<Health | null>(null)
  const [healthError, setHealthError] = useState<string | null>(null)

  useEffect(() => {
    const load = () =>
      api
        .health()
        .then((h) => {
          setHealth(h)
          setHealthError(null)
        })
        .catch((e: Error) => setHealthError(e.message))
    load()
    const t = setInterval(load, 15_000)
    return () => clearInterval(t)
  }, [])

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">◎</span>
          <span>Ordoor Agent Test</span>
        </div>
        <nav className="tabs">
          <a className={section === 'personas' ? 'active' : ''} href="#/personas">
            Personas & scenarios
          </a>
          <a className={section === 'runs' ? 'active' : ''} href="#/runs">
            Runs
          </a>
        </nav>
        <HealthBadge health={health} error={healthError} />
      </header>
      <main className="content">
        {section === 'runs' && param ? <RunDetail id={param} /> : section === 'runs' ? <RunsPage /> : <PersonasPage selectedId={param} />}
      </main>
    </div>
  )
}

function HealthBadge({ health, error }: { health: Health | null; error: string | null }) {
  if (error) return <span className="health bad" title={error}>Test server unreachable</span>
  if (!health) return <span className="health">Checking…</span>
  const ok = health.ordoor.ok && health.llm.configured
  const title = [
    `Ordoor: ${health.ordoor.baseUrl} — ${health.ordoor.ok ? 'connected' : health.ordoor.error ?? 'not connected'}`,
    `Model: ${health.llm.model}${health.llm.configured ? '' : ' (API key missing)'}`,
    `Concurrency: ${health.runConcurrency}`,
  ].join('\n')
  return (
    <span className={`health ${ok ? 'good' : 'bad'}`} title={title}>
      <span className="dot" /> {health.ordoor.ok ? 'Ordoor connected' : 'Ordoor not connected'} · {health.llm.model}
    </span>
  )
}
