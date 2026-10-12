/**
 * The app's own PostgreSQL database (`DATABASE_URL`) — personas, scenarios and runs. Never Ordoor's:
 * Ordoor is reached only through its HTTP API.
 *
 * The schema AND its data are created on start by the numbered files in `server/migrations/`
 * (`001_schema.sql`, `002_…`): each runs once, in a transaction, recorded in `schema_migrations`.
 * Add a new file at the end — never edit one that ran. `npm run db:export-data` writes the next one
 * from what the database holds now (personas, scenarios, runs).
 *
 * `Db` is the little this app needs from a driver, so the tests can run the same SQL on PGlite
 * (Postgres in-process) instead of a server.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import pg from 'pg'

import { config } from './config.js'

export interface Db {
  query<R = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: R[]; rowCount: number }>
  /** Several statements, no parameters. */
  exec(sql: string): Promise<void>
  transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T>
  close(): Promise<void>
}

// ── Migrations ───────────────────────────────────────────────────────────────────────────────────

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), 'migrations')

export interface Migration {
  version: number
  name: string
  sql: string
}

/** `server/migrations/NNN_name.sql`, in order. A gap or a repeated number is refused. */
export function loadMigrations(dir = MIGRATIONS_DIR): Migration[] {
  const migrations = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .map((file) => {
      const m = file.match(/^(\d+)_(.+)\.sql$/)
      if (!m) throw new Error(`Migration file name must be NNN_name.sql: ${file}`)
      return { version: Number(m[1]), name: m[2]!.replace(/_/g, ' '), sql: readFileSync(join(dir, file), 'utf8') }
    })
    .sort((a, b) => a.version - b.version)
  migrations.forEach((m, i) => {
    if (m.version !== i + 1) throw new Error(`Migrations must be numbered 1, 2, 3… without gaps; found ${m.version} at position ${i + 1}`)
  })
  return migrations
}

export async function migrate(db: Db): Promise<number[]> {
  await db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version    integer PRIMARY KEY,
    name       text NOT NULL,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`)
  const done = new Set((await db.query<{ version: number }>('SELECT version FROM schema_migrations')).rows.map((r) => r.version))
  const applied: number[] = []
  for (const m of loadMigrations()) {
    if (done.has(m.version)) continue
    await db.transaction(async (tx) => {
      await tx.exec(m.sql)
      await tx.query('INSERT INTO schema_migrations (version, name) VALUES ($1, $2)', [m.version, m.name])
    })
    applied.push(m.version)
  }
  return applied
}

// ── Drivers ──────────────────────────────────────────────────────────────────────────────────────

function fromPgClient(client: pg.Pool | pg.PoolClient): Omit<Db, 'transaction' | 'close'> {
  return {
    async query<R>(sql: string, params: unknown[] = []) {
      const res = await client.query(sql, params)
      return { rows: res.rows as R[], rowCount: res.rowCount ?? 0 }
    },
    async exec(sql: string) {
      await client.query(sql)
    },
  }
}

export function pgDb(connectionString: string): Db {
  const pool = new pg.Pool({ connectionString, max: 10 })
  pool.on('error', (err) => console.error('postgres pool error:', err.message))
  return {
    ...fromPgClient(pool),
    async transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        const tx: Db = {
          ...fromPgClient(client),
          transaction: (inner) => inner(tx),
          close: async () => undefined,
        }
        const result = await fn(tx)
        await client.query('COMMIT')
        return result
      } catch (err) {
        await client.query('ROLLBACK').catch(() => undefined)
        throw err
      } finally {
        client.release()
      }
    },
    close: () => pool.end(),
  }
}

let current: Db | null = null

/** The app's database — opened on first use from `DATABASE_URL`. */
export function db(): Db {
  if (!current) {
    if (!config.databaseUrl) throw new Error('DATABASE_URL is not set — the agent-test app needs its own PostgreSQL database (see .env.example).')
    current = pgDb(config.databaseUrl)
  }
  return current
}

/** Use another database — the tests' PGlite. */
export function useDb(next: Db): void {
  current = next
}

/** A JSON value as a `jsonb` parameter. Always stringified: the driver turns a JS array into a Postgres array. */
export const json = (value: unknown): string => JSON.stringify(value ?? null)
