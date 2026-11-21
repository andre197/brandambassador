import '../load-env.js';
import { createPool } from '../db/pool.js';
import { migrate } from '../db/migrate.js';

const url = process.argv.includes('--test') ? process.env.DATABASE_URL_TEST : process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}
const pool = createPool(url, 1);
try {
  const applied = await migrate(pool, (m) => console.log(m));
  console.log(applied.length ? `${applied.length} migration(s) applied` : 'database is up to date');
} catch (err) {
  console.error((err as Error).message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
