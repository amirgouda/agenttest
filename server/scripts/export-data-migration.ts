/**
 * Write the next migration from what the database holds NOW — every persona, scenario and run — so a
 * new database built from the migrations starts with the same data.
 *
 *   npm run db:export-data -- [name]          → server/migrations/NNN_<name>.sql
 *
 * Every row is an `INSERT … ON CONFLICT DO NOTHING`: on a database that already has it (the one it was
 * exported from), the migration changes nothing. Generated columns (`runs.verdict`, `runs.score`) are
 * left to the database.
 */
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { db, loadMigrations, migrate } from '../db.js'

type Value = string | number | boolean | Date | null | unknown[] | Record<string, unknown>

/** A SQL literal. Text is quoted with '' doubling; JSON goes in as `jsonb`; never string-built from input otherwise. */
export function literal(value: Value, kind: 'text' | 'jsonb' | 'text[]' | 'timestamptz' | 'plain' = 'plain'): string {
  if (value === null || value === undefined) return 'NULL'
  const quote = (s: string) => `'${s.replace(/'/g, "''")}'`
  switch (kind) {
    case 'jsonb':
      return `${quote(JSON.stringify(value))}::jsonb`
    case 'text[]':
      return (value as string[]).length ? `ARRAY[${(value as string[]).map(quote).join(', ')}]::text[]` : `'{}'::text[]`
    case 'timestamptz':
      return `${quote(new Date(value as string | Date).toISOString())}::timestamptz`
    case 'text':
      return quote(String(value))
    default:
      return typeof value === 'number' || typeof value === 'boolean' ? String(value) : quote(String(value))
  }
}

type Columns = Record<string, Parameters<typeof literal>[1]>

const TABLES: Array<{ table: string; order: string; columns: Columns }> = [
  {
    table: 'personas',
    order: 'created_at, id',
    columns: { id: 'text', name: 'text', phone: 'text', location: 'jsonb', character: 'text', language: 'text', traits: 'text[]', sends_voice_notes: 'plain', created_at: 'timestamptz', updated_at: 'timestamptz' },
  },
  {
    table: 'scenarios',
    order: 'created_at, id',
    columns: {
      id: 'text', persona_id: 'text', title: 'text', intent: 'text', expected_items: 'jsonb', expected_outcome: 'text', store_behaviour: 'text',
      max_turns: 'plain', reset_before_run: 'plain', notes: 'text', created_at: 'timestamptz', updated_at: 'timestamptz',
    },
  },
  {
    table: 'runs',
    order: 'created_at, id',
    columns: {
      id: 'text', batch_id: 'text', persona_id: 'text', scenario_id: 'text', persona: 'jsonb', scenario: 'jsonb', status: 'text',
      created_at: 'timestamptz', started_at: 'timestamptz', finished_at: 'timestamptz', customer_turns: 'plain', end_reason: 'text',
      transcript: 'jsonb', store_transcript: 'jsonb', final_state: 'jsonb', evaluation: 'jsonb', error: 'text', log: 'jsonb',
    },
  },
]

export async function exportDataSql(): Promise<{ sql: string; counts: Record<string, number> }> {
  const parts: string[] = []
  const counts: Record<string, number> = {}
  for (const { table, order, columns } of TABLES) {
    const names = Object.keys(columns)
    const { rows } = await db().query<Record<string, Value>>(`SELECT ${names.join(', ')} FROM ${table} ORDER BY ${order}`)
    counts[table] = rows.length
    parts.push(`-- ${table}: ${rows.length}`)
    for (const row of rows) {
      const values = names.map((n) => literal(row[n] ?? null, columns[n]))
      parts.push(`INSERT INTO ${table} (${names.join(', ')})\nVALUES (${values.join(', ')})\nON CONFLICT DO NOTHING;`)
    }
    parts.push('')
  }
  return { sql: parts.join('\n'), counts }
}

async function main(): Promise<void> {
  const name = (process.argv[2] ?? 'data').replace(/[^a-z0-9_]+/gi, '_').toLowerCase()
  await migrate(db())
  const next = loadMigrations().length + 1
  const { sql, counts } = await exportDataSql()
  const file = join('server', 'migrations', `${String(next).padStart(3, '0')}_${name}.sql`)
  const header = `-- Data: ${Object.entries(counts).map(([t, n]) => `${n} ${t}`).join(', ')} — exported ${new Date().toISOString()} by \`npm run db:export-data\`.
-- Rows that already exist are left as they are (ON CONFLICT DO NOTHING).

`
  writeFileSync(file, header + sql)
  console.log(`wrote ${file} (${Object.entries(counts).map(([t, n]) => `${n} ${t}`).join(', ')})`)
  await db().close()
}

if (process.argv[1]?.endsWith('export-data-migration.ts')) {
  main().catch((err: Error) => {
    console.error(err.message)
    process.exit(1)
  })
}
