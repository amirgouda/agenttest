/** The app's `Db` on PGlite — real Postgres, in-process, a fresh empty database per call. */
import { PGlite, type Transaction } from '@electric-sql/pglite'

import type { Db } from '../db.js'

type Queryable = Pick<PGlite, 'query' | 'exec'> | Transaction

function wrap(q: Queryable): Omit<Db, 'transaction' | 'close'> {
  return {
    async query<R>(sql: string, params: unknown[] = []) {
      const res = await q.query<R>(sql, params)
      return { rows: res.rows, rowCount: res.affectedRows ?? res.rows.length }
    },
    async exec(sql: string) {
      await q.exec(sql)
    },
  }
}

export async function pgliteDb(): Promise<Db> {
  const pg = new PGlite()
  await pg.waitReady
  const db: Db = {
    ...wrap(pg),
    transaction: async <T,>(fn: (tx: Db) => Promise<T>): Promise<T> =>
      (await pg.transaction(async (tx) => {
        const inner: Db = { ...wrap(tx), transaction: (f) => f(inner), close: async () => undefined }
        return fn(inner)
      })) as T,
    close: () => pg.close(),
  }
  return db
}
