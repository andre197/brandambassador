import '../src/load-env.js';
import { createPool } from '../src/db/pool.js';
import { migrate } from '../src/db/migrate.js';

/** Rebuilds the test database schema from scratch once per test run. */
export default async function setup(): Promise<void> {
  const url = process.env.DATABASE_URL_TEST;
  if (!url) throw new Error('DATABASE_URL_TEST is not set (see .env.example)');
  if (url === process.env.DATABASE_URL) throw new Error('DATABASE_URL_TEST must differ from DATABASE_URL');
  const pool = createPool(url, 1);
  try {
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await migrate(pool);
  } finally {
    await pool.end();
  }
}
