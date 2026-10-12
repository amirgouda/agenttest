import type { Evaluation, RunStatus } from '../api'

export function StatusPill({ status }: { status: RunStatus }) {
  const live = status === 'running' || status === 'evaluating'
  return (
    <span className={`pill status-${status}`}>
      {live && <span className="spinner" />}
      {status}
    </span>
  )
}

export function VerdictPill({ verdict, score }: { verdict: Evaluation['verdict']; score: number }) {
  return (
    <span className={`pill verdict-${verdict}`}>
      {verdict} · {score}
    </span>
  )
}

export function timeAgo(iso: string): string {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.round(s / 60)} min ago`
  if (s < 86400) return `${Math.round(s / 3600)} h ago`
  return new Date(iso).toLocaleDateString()
}
