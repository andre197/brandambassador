import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { MIGRATIONS_DIR } from '../paths.js';
import type { Pool } from './pool.js';

export { MIGRATIONS_DIR };
const LOCK_ID = 7_450_221; // arbitrary constant for pg_advisory_lock

/**
 * Forward-only SQL migrations. Each `NNNN_name.sql` file runs once, in its own transaction,
 * under an advisory lock so concurrent deploys cannot race.
 */
export async function migrate(pool: Pool, log: (msg: string) => void = () => undefined, dir = MIGRATIONS_DIR): Promise<string[]> {
  const client = await pool.connect();
  const applied: string[] = [];
  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_ID]);
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
    const done = new Set((await client.query<{ version: string }>('SELECT version FROM schema_migrations')).rows.map((r) => r.version));
    const files = (await readdir(dir)).filter((f) => /^\d{4}_[\w-]+\.sql$/.test(f)).sort();
    for (const file of files) {
      if (done.has(file)) continue;
      const sql = await readFile(path.join(dir, file), 'utf8');
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [file]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        const version = await client
          .query<{ server_version: string }>('SHOW server_version')
          .then((r) => r.rows[0]?.server_version)
          .catch(() => 'unknown');
        throw new Error(`Migration ${file} failed on PostgreSQL ${version}: ${(err as Error).message}`);
      }
      applied.push(file);
      log(`applied ${file}`);
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_ID]).catch(() => undefined);
    client.release();
  }
  return applied;
}
