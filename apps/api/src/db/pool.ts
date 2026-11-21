import pg from 'pg';

// Return int8 (bigint) columns as JS numbers where they fit (counts, identities, order numbers).
pg.types.setTypeParser(20, (v) => {
  const n = Number(v);
  return Number.isSafeInteger(n) ? n : v;
});
// Return `date` columns as ISO strings, not local-time Date objects.
pg.types.setTypeParser(1082, (v) => v);

export type Pool = pg.Pool;
export type PoolClient = pg.PoolClient;

/** Anything that can run a query: the pool or a transaction-bound client. */
export interface Queryable {
  query<R extends pg.QueryResultRow = pg.QueryResultRow>(text: string, values?: unknown[]): Promise<pg.QueryResult<R>>;
}

export function createPool(connectionString: string, max = 10): Pool {
  return new pg.Pool({ connectionString, max, idleTimeoutMillis: 30_000 });
}

/** Runs `fn` inside a transaction. Rolls back on any thrown error. */
export async function withTx<T>(pool: Pool, fn: (tx: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

export async function one<R extends pg.QueryResultRow>(db: Queryable, text: string, values?: unknown[]): Promise<R | null> {
  const r = await db.query<R>(text, values);
  return r.rows[0] ?? null;
}

export async function many<R extends pg.QueryResultRow>(db: Queryable, text: string, values?: unknown[]): Promise<R[]> {
  const r = await db.query<R>(text, values);
  return r.rows;
}
