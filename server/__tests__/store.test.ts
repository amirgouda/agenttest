/**
 * The database layer on real Postgres (PGlite): the migrations — tables AND data — the rules the
 * tables keep, and the export that writes the next data migration.
 */
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { beforeEach, describe, expect, it } from 'vitest'

import { db, loadMigrations, migrate, useDb } from '../db.js'
import { exportDataSql } from '../scripts/export-data-migration.js'
import {
  ValidationError,
  claimRun,
  deletePersona,
  failInterruptedRuns,
  getPersona,
  getRun,
  getScenario,
  initStore,
  listPersonas,
  listRunSummaries,
  listScenarios,
  queuedRuns,
  savePersona,
  saveRun,
} from '../store.js'
import type { Run } from '../types.js'
import { pgliteDb } from './pglite.js'

const count = async (table: string) => (await db().query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table}`)).rows[0]!.n

beforeEach(async () => {
  useDb(await pgliteDb())
})

describe('the migrations carry the data', () => {
  it('an empty database comes out with the tables, the personas, the scenarios and the runs', async () => {
    expect(await initStore()).toEqual({ migrations: [1, 2] })
    expect(await count('personas')).toBe(4)
    expect(await count('scenarios')).toBe(6)
    expect(await count('runs')).toBe(3)
    expect((await listPersonas()).map((p) => p.phone).sort()).toEqual(['201000000101', '201000000102', '201000000103', '201000000104'])
    expect((await getScenario('scn_milk_2l'))?.expectedItems).toEqual([{ description: 'full fat milk', quantity: 2, unit: 'litre' }])
    // The generated columns are filled from the imported evaluation.
    const { rows } = await db().query<{ verdict: string | null }>("SELECT verdict FROM runs WHERE status = 'completed'")
    expect(rows.map((r) => r.verdict)).toEqual(['pass', 'pass'])
    // And nothing runs twice.
    expect(await initStore()).toEqual({ migrations: [] })
  })

  it('the data migration changes nothing on a database that already has its rows', async () => {
    await initStore()
    await savePersona({ ...(await strippedPersona('per_karim')), id: 'per_karim', name: 'Karim (edited)' })
    const data = loadMigrations().find((m) => m.version === 2)!
    await db().exec(data.sql)
    expect(await count('personas')).toBe(4)
    expect((await getPersona('per_karim'))?.name).toBe('Karim (edited)')
  })

  it('export → a fresh database → export again is the same SQL (Arabic, quotes and JSON intact)', async () => {
    await initStore()
    await savePersona({ ...(await strippedPersona('per_sara')), id: 'per_sara', character: `She says "it's fine" — قالت «ماشي»` })
    const first = await exportDataSql()

    useDb(await pgliteDb())
    await db().exec(loadMigrations()[0]!.sql)
    await db().exec(first.sql)
    const second = await exportDataSql()
    expect(second.sql).toBe(first.sql)
    expect(second.counts).toEqual({ personas: 4, scenarios: 6, runs: 3 })
    expect((await getPersona('per_sara'))?.character).toBe(`She says "it's fine" — قالت «ماشي»`)
  })

  it('migration files must be numbered without gaps', () => {
    const dir = mkdtempSync(join(tmpdir(), 'migrations-'))
    writeFileSync(join(dir, '001_a.sql'), 'SELECT 1;')
    writeFileSync(join(dir, '003_c.sql'), 'SELECT 1;')
    expect(() => loadMigrations(dir)).toThrow(/without gaps/)
  })
})

async function strippedPersona(id: string) {
  const { id: _id, createdAt: _c, updatedAt: _u, ...rest } = (await getPersona(id))!
  return rest
}

describe('the rules the tables keep', () => {
  beforeEach(async () => {
    await initStore()
  })

  const run = async (over: Partial<Run> = {}): Promise<Run> => {
    const persona = (await getPersona('per_om_ahmed'))!
    const scenario = (await getScenario('scn_milk_2l'))!
    return {
      id: 'run_1',
      personaId: persona.id,
      scenarioId: scenario.id,
      persona,
      scenario,
      status: 'queued',
      createdAt: '2026-10-12T10:00:00.000Z',
      customerTurns: 0,
      transcript: [],
      storeTranscript: [],
      log: [],
      ...over,
    }
  }

  it('one number per persona', async () => {
    const om = await strippedPersona('per_om_ahmed')
    await expect(savePersona({ ...om, name: 'Copy' })).rejects.toBeInstanceOf(ValidationError)
    // Saving a persona under its own number is not a clash.
    expect((await savePersona({ ...om, id: 'per_om_ahmed', name: 'Om Ahmed 2' })).name).toBe('Om Ahmed 2')
  })

  it('deleting a persona takes its scenarios but keeps its runs, with their copy of it', async () => {
    await saveRun(await run({ status: 'completed' }))
    expect(await deletePersona('per_om_ahmed')).toBe(true)
    expect(await listScenarios('per_om_ahmed')).toEqual([])
    const kept = await getRun('run_1')
    expect(kept?.personaId).toBe('per_om_ahmed')
    expect(kept?.persona.name).toBe('Om Ahmed')
  })

  it('a run round-trips, and the list carries the verdict without the transcript', async () => {
    const transcript = [{ id: 'm1', side: 'customer' as const, type: 'text', text: 'عايزة لبن', at: '2026-10-12T10:00:01.000Z' }]
    await saveRun(await run({ status: 'completed', createdAt: '2030-01-01T00:00:00.000Z', transcript, evaluation: { verdict: 'partial', score: 55, summary: 'meh', checks: [], issues: ['x'] } }))
    expect((await getRun('run_1'))?.transcript).toEqual(transcript)
    const [summary] = await listRunSummaries()
    expect(summary).toMatchObject({ id: 'run_1', messageCount: 1, evaluation: { verdict: 'partial', score: 55, summary: 'meh' } })
    expect(summary).not.toHaveProperty('transcript')
  })

  it('a queued run is claimed once; a restart fails only what was mid-way', async () => {
    await saveRun(await run({ id: 'run_q' }))
    await saveRun(await run({ id: 'run_r', status: 'running' }))
    expect((await queuedRuns()).map((r) => r.id)).toEqual(['run_q'])
    expect((await claimRun('run_q'))?.status).toBe('running')
    expect(await claimRun('run_q')).toBeUndefined()
    expect(await failInterruptedRuns()).toBe(2)
    expect((await getRun('run_r'))?.error).toMatch(/restarted/)
  })
})
