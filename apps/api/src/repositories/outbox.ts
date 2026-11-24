import { many, type Queryable } from '../db/pool.js';

export interface OutboxJob {
  id: number;
  type: string;
  payload: Record<string, unknown>;
  attempts: number;
  max_attempts: number;
}

/**
 * Enqueues a background job. Call it with the same transaction as the change that caused it,
 * so the job exists if and only if the change committed. A `dedupeKey` makes it idempotent.
 */
export async function enqueueJob(
  db: Queryable,
  type: string,
  payload: Record<string, unknown>,
  opts: { runAt?: Date; dedupeKey?: string; maxAttempts?: number } = {},
): Promise<void> {
  await db.query(
    `INSERT INTO outbox_jobs (type, payload, run_at, dedupe_key, max_attempts)
     VALUES ($1, $2, coalesce($3, now()), $4, coalesce($5, 8))
     ON CONFLICT (dedupe_key) DO NOTHING`,
    [type, JSON.stringify(payload), opts.runAt ?? null, opts.dedupeKey ?? null, opts.maxAttempts ?? null],
  );
}

/** Claims due jobs (FOR UPDATE SKIP LOCKED) and marks them processing. */
export async function claimJobs(db: Queryable, limit: number): Promise<OutboxJob[]> {
  return many<OutboxJob>(
    db,
    `UPDATE outbox_jobs SET status = 'processing', locked_at = now(), attempts = attempts + 1
      WHERE id IN (
        SELECT id FROM outbox_jobs WHERE status = 'pending' AND run_at <= now()
         ORDER BY run_at, id LIMIT $1 FOR UPDATE SKIP LOCKED)
      RETURNING id, type, payload, attempts, max_attempts`,
    [limit],
  );
}

export async function completeJob(db: Queryable, id: number): Promise<void> {
  await db.query(`UPDATE outbox_jobs SET status = 'done', locked_at = NULL, last_error = NULL WHERE id = $1`, [id]);
}

export async function failJob(db: Queryable, job: OutboxJob, error: string, retryInSeconds: number): Promise<void> {
  const dead = job.attempts >= job.max_attempts;
  await db.query(
    `UPDATE outbox_jobs SET status = $2, locked_at = NULL, last_error = $3,
            run_at = now() + make_interval(secs => $4) WHERE id = $1`,
    [job.id, dead ? 'dead' : 'pending', error.slice(0, 2000), retryInSeconds],
  );
}

/** Hands claimed jobs that were never started back to the queue, without counting the attempt. */
export async function releaseJobs(db: Queryable, ids: number[]): Promise<void> {
  if (!ids.length) return;
  await db.query(`UPDATE outbox_jobs SET status = 'pending', locked_at = NULL, attempts = greatest(attempts - 1, 0) WHERE id = ANY($1::bigint[]) AND status = 'processing'`, [ids]);
}

/** Returns jobs stuck in `processing` (e.g. a crashed worker) to `pending`. */
export async function releaseStaleJobs(db: Queryable, olderThanSeconds = 300): Promise<number> {
  const r = await db.query(
    `UPDATE outbox_jobs SET status = 'pending', locked_at = NULL
      WHERE status = 'processing' AND locked_at < now() - make_interval(secs => $1)`,
    [olderThanSeconds],
  );
  return r.rowCount ?? 0;
}
