/**
 * Persistence — the app's own PostgreSQL database (`server/db.ts`): personas, scenarios and runs.
 * Their starting rows are a migration (`server/migrations/002_…`), never code run at start-up.
 */
import { randomUUID } from 'node:crypto'

import { db, json, migrate } from './db.js'
import type { Evaluation, Persona, Run, Scenario } from './types.js'

export class ValidationError extends Error {}

export const newId = (prefix: string): string => `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 12)}`
const iso = (d: Date | string | null | undefined): string | undefined => (d == null ? undefined : new Date(d).toISOString())

// ── Start-up ─────────────────────────────────────────────────────────────────────────────────────

/**
 * Bring the database up to date. The tables AND the starting data (personas, scenarios, runs) are
 * migrations (`server/migrations/`), so an empty database comes out of this exactly as the last
 * exported one was.
 */
export async function initStore(): Promise<{ migrations: number[] }> {
  return { migrations: await migrate(db()) }
}

// ── Personas ─────────────────────────────────────────────────────────────────────────────────────

interface PersonaRow {
  id: string
  name: string
  phone: string
  location: Persona['location']
  character: string
  language: string
  traits: string[]
  sends_voice_notes: boolean
  created_at: Date
  updated_at: Date
}

const toPersona = (r: PersonaRow): Persona => ({
  id: r.id,
  name: r.name,
  phone: r.phone,
  location: r.location,
  character: r.character,
  language: r.language,
  traits: r.traits,
  sendsVoiceNotes: r.sends_voice_notes,
  createdAt: iso(r.created_at)!,
  updatedAt: iso(r.updated_at)!,
})


export async function listPersonas(): Promise<Persona[]> {
  return (await db().query<PersonaRow>('SELECT * FROM personas ORDER BY created_at, name')).rows.map(toPersona)
}

export async function getPersona(id: string): Promise<Persona | undefined> {
  const row = (await db().query<PersonaRow>('SELECT * FROM personas WHERE id = $1', [id])).rows[0]
  return row ? toPersona(row) : undefined
}

export async function savePersona(input: Omit<Persona, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }): Promise<Persona> {
  const clash = (await db().query<{ name: string }>('SELECT name FROM personas WHERE phone = $1 AND id <> $2', [input.phone, input.id ?? ''])).rows[0]
  if (clash) throw new ValidationError(`The number ${input.phone} already belongs to ${clash.name}. Each persona needs its own number.`)
  const params = [input.name, input.phone, json(input.location), input.character, input.language, input.traits, input.sendsVoiceNotes]
  const row = input.id
    ? (
        await db().query<PersonaRow>(
          `UPDATE personas SET name = $2, phone = $3, location = $4::jsonb, character = $5, language = $6, traits = $7,
             sends_voice_notes = $8, updated_at = now() WHERE id = $1 RETURNING *`,
          [input.id, ...params],
        )
      ).rows[0]
    : (
        await db().query<PersonaRow>(
          `INSERT INTO personas (id, name, phone, location, character, language, traits, sends_voice_notes)
           VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8) RETURNING *`,
          [newId('per'), ...params],
        )
      ).rows[0]
  if (!row) throw new ValidationError('Unknown persona')
  return toPersona(row)
}

/** Its scenarios go with it; its runs stay, with their copy of it. */
export async function deletePersona(id: string): Promise<boolean> {
  return (await db().query('DELETE FROM personas WHERE id = $1', [id])).rowCount > 0
}

// ── Scenarios ────────────────────────────────────────────────────────────────────────────────────

interface ScenarioRow {
  id: string
  persona_id: string
  title: string
  intent: string
  expected_items: Scenario['expectedItems']
  expected_outcome: Scenario['expectedOutcome']
  store_behaviour: string
  max_turns: number
  reset_before_run: boolean
  notes: string | null
  created_at: Date
  updated_at: Date
}

const toScenario = (r: ScenarioRow): Scenario => ({
  id: r.id,
  personaId: r.persona_id,
  title: r.title,
  intent: r.intent,
  expectedItems: r.expected_items,
  expectedOutcome: r.expected_outcome,
  storeBehaviour: r.store_behaviour,
  maxTurns: r.max_turns,
  resetBeforeRun: r.reset_before_run,
  ...(r.notes ? { notes: r.notes } : {}),
  createdAt: iso(r.created_at)!,
  updatedAt: iso(r.updated_at)!,
})


export async function listScenarios(personaId?: string): Promise<Scenario[]> {
  const { rows } = personaId
    ? await db().query<ScenarioRow>('SELECT * FROM scenarios WHERE persona_id = $1 ORDER BY created_at, title', [personaId])
    : await db().query<ScenarioRow>('SELECT * FROM scenarios ORDER BY created_at, title')
  return rows.map(toScenario)
}

export async function getScenario(id: string): Promise<Scenario | undefined> {
  const row = (await db().query<ScenarioRow>('SELECT * FROM scenarios WHERE id = $1', [id])).rows[0]
  return row ? toScenario(row) : undefined
}

export async function saveScenario(input: Omit<Scenario, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }): Promise<Scenario> {
  if (!(await getPersona(input.personaId))) throw new ValidationError('Unknown persona')
  const params = [input.personaId, input.title, input.intent, json(input.expectedItems), input.expectedOutcome, input.storeBehaviour, input.maxTurns, input.resetBeforeRun, input.notes ?? null]
  const row = input.id
    ? (
        await db().query<ScenarioRow>(
          `UPDATE scenarios SET persona_id = $2, title = $3, intent = $4, expected_items = $5::jsonb, expected_outcome = $6,
             store_behaviour = $7, max_turns = $8, reset_before_run = $9, notes = $10, updated_at = now() WHERE id = $1 RETURNING *`,
          [input.id, ...params],
        )
      ).rows[0]
    : (
        await db().query<ScenarioRow>(
          `INSERT INTO scenarios (id, persona_id, title, intent, expected_items, expected_outcome, store_behaviour, max_turns, reset_before_run, notes)
           VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10) RETURNING *`,
          [newId('scn'), ...params],
        )
      ).rows[0]
  if (!row) throw new ValidationError('Unknown scenario')
  return toScenario(row)
}

export async function deleteScenario(id: string): Promise<boolean> {
  return (await db().query('DELETE FROM scenarios WHERE id = $1', [id])).rowCount > 0
}

// ── Runs ─────────────────────────────────────────────────────────────────────────────────────────

interface RunRow {
  id: string
  batch_id: string | null
  persona_id: string | null
  scenario_id: string | null
  persona: Persona
  scenario: Scenario
  status: Run['status']
  created_at: Date
  started_at: Date | null
  finished_at: Date | null
  customer_turns: number
  end_reason: string | null
  transcript: Run['transcript']
  store_transcript: Run['storeTranscript']
  final_state: Run['finalState'] | null
  evaluation: Evaluation | null
  error: string | null
  log: string[]
}

const toRun = (r: RunRow): Run => ({
  id: r.id,
  ...(r.batch_id ? { batchId: r.batch_id } : {}),
  // A deleted persona or scenario leaves its id on the run's copy.
  personaId: r.persona_id ?? r.persona.id,
  scenarioId: r.scenario_id ?? r.scenario.id,
  persona: r.persona,
  scenario: r.scenario,
  status: r.status,
  createdAt: iso(r.created_at)!,
  ...(r.started_at ? { startedAt: iso(r.started_at) } : {}),
  ...(r.finished_at ? { finishedAt: iso(r.finished_at) } : {}),
  customerTurns: r.customer_turns,
  ...(r.end_reason ? { endReason: r.end_reason } : {}),
  transcript: r.transcript,
  storeTranscript: r.store_transcript,
  ...(r.final_state ? { finalState: r.final_state } : {}),
  ...(r.evaluation ? { evaluation: r.evaluation } : {}),
  ...(r.error ? { error: r.error } : {}),
  log: r.log,
})

async function upsertRun(run: Run): Promise<void> {
  await db().query(
    `INSERT INTO runs (id, batch_id, persona_id, scenario_id, persona, scenario, status, created_at, started_at, finished_at,
                       customer_turns, end_reason, transcript, store_transcript, final_state, evaluation, error, log)
     VALUES ($1, $2, NULLIF($3, ''), NULLIF($4, ''), $5::jsonb, $6::jsonb, $7, $8, $9, $10, $11, $12, $13::jsonb, $14::jsonb, $15::jsonb, $16::jsonb, $17, $18::jsonb)
     ON CONFLICT (id) DO UPDATE SET
       status = EXCLUDED.status, started_at = EXCLUDED.started_at, finished_at = EXCLUDED.finished_at,
       customer_turns = EXCLUDED.customer_turns, end_reason = EXCLUDED.end_reason, transcript = EXCLUDED.transcript,
       store_transcript = EXCLUDED.store_transcript, final_state = EXCLUDED.final_state, evaluation = EXCLUDED.evaluation,
       error = EXCLUDED.error, log = EXCLUDED.log`,
    [
      run.id,
      run.batchId ?? null,
      run.personaId,
      run.scenarioId,
      json(run.persona),
      json(run.scenario),
      run.status,
      run.createdAt,
      run.startedAt ?? null,
      run.finishedAt ?? null,
      run.customerTurns,
      run.endReason ?? null,
      json(run.transcript),
      json(run.storeTranscript),
      run.finalState ? json(run.finalState) : null,
      run.evaluation ? json(run.evaluation) : null,
      run.error ?? null,
      json(run.log),
    ],
  )
}

export async function saveRun(run: Run): Promise<void> {
  await upsertRun(run)
}

export async function getRun(id: string): Promise<Run | undefined> {
  const row = (await db().query<RunRow>('SELECT * FROM runs WHERE id = $1', [id])).rows[0]
  return row ? toRun(row) : undefined
}

export async function queuedRuns(): Promise<Run[]> {
  return (await db().query<RunRow>("SELECT * FROM runs WHERE status = 'queued' ORDER BY created_at, id")).rows.map(toRun)
}

export type RunSummary = Omit<Run, 'transcript' | 'storeTranscript' | 'log' | 'finalState' | 'evaluation'> & {
  messageCount: number
  evaluation?: Pick<Evaluation, 'verdict' | 'score' | 'summary'>
}

/** The list, without the transcripts — they are read one run at a time. */
export async function listRunSummaries(limit = 500): Promise<RunSummary[]> {
  const { rows } = await db().query<RunRow & { message_count: number; summary: string | null }>(
    `SELECT id, batch_id, persona_id, scenario_id, persona, scenario, status, created_at, started_at, finished_at,
            customer_turns, end_reason, error, verdict, score, evaluation ->> 'summary' AS summary,
            jsonb_array_length(transcript) AS message_count,
            '[]'::jsonb AS transcript, '[]'::jsonb AS store_transcript, '[]'::jsonb AS log, NULL::jsonb AS final_state,
            CASE WHEN evaluation IS NULL THEN NULL
                 ELSE jsonb_build_object('verdict', verdict, 'score', score, 'summary', evaluation ->> 'summary') END AS evaluation
     FROM runs ORDER BY created_at DESC LIMIT $1`,
    [limit],
  )
  return rows.map((r) => {
    const { transcript: _t, storeTranscript: _s, log: _l, finalState: _f, evaluation, ...rest } = toRun(r)
    return { ...rest, messageCount: r.message_count, ...(evaluation ? { evaluation: evaluation as RunSummary['evaluation'] } : {}) }
  })
}

/** Runs a restart interrupted mid-way — nothing is running them any more. Queued ones simply wait. */
export async function failInterruptedRuns(): Promise<number> {
  return (
    await db().query(
      `UPDATE runs SET status = 'failed', finished_at = now(), error = 'The test server restarted while this run was in progress.'
       WHERE status IN ('running', 'evaluating')`,
    )
  ).rowCount
}

/** Take a queued run — in ONE statement, so it is started once even with two servers on one database. */
export async function claimRun(id: string): Promise<Run | undefined> {
  const row = (await db().query<RunRow>(`UPDATE runs SET status = 'running', started_at = now() WHERE id = $1 AND status = 'queued' RETURNING *`, [id])).rows[0]
  return row ? toRun(row) : undefined
}

export async function stopQueuedRun(id: string): Promise<boolean> {
  return (
    await db().query(`UPDATE runs SET status = 'stopped', finished_at = now(), end_reason = 'Stopped before it started.' WHERE id = $1 AND status = 'queued'`, [id])
  ).rowCount > 0
}

export async function deleteRun(id: string): Promise<boolean> {
  return (await db().query('DELETE FROM runs WHERE id = $1', [id])).rowCount > 0
}
