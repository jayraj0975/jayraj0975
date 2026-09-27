import { hostname } from 'node:os';
import { q, q1, withOrg } from '../lib/db';
import { log, sanitizeError } from '../lib/log';
import { processScan } from './scan';
import { purgeExpired } from '../lib/dossiers';
import { enqueue, queueScan } from '../lib/jobs';
import { config } from '../lib/config';

process.env.ACQUICODE_SERVICE = 'worker';
const WORKER_ID = `${hostname()}:${process.pid}`;
let stopping = false;

interface Job {
  id: string;
  org_id: string | null;
  kind: string;
  payload: Record<string, unknown>;
  attempts: number;
  max_attempts: number;
}

async function claim(): Promise<Job | null> {
  return q1<Job>(
    `UPDATE jobs SET status = 'running', locked_at = now(), locked_by = $1, attempts = attempts + 1
     WHERE id = (SELECT id FROM jobs WHERE status = 'queued' AND run_after <= now() ORDER BY run_after, id FOR UPDATE SKIP LOCKED LIMIT 1)
     RETURNING id, org_id, kind, payload, attempts, max_attempts`,
    [WORKER_ID],
  );
}

async function run(job: Job): Promise<void> {
  switch (job.kind) {
    case 'scan':
      if (!job.org_id) throw new Error('scan job without organisation');
      await processScan(String(job.payload.scanId), job.org_id);
      return;
    case 'purge': {
      const orgs = await q<{ id: string }>('SELECT id FROM orgs');
      for (const o of orgs) await purgeExpired(o.id);
      await q("DELETE FROM sessions WHERE expires_at < now()");
      await q("DELETE FROM rate_limits WHERE window_start < now() - interval '1 day'");
      await q("DELETE FROM webhook_deliveries WHERE received_at < now() - interval '30 days'");
      await q("DELETE FROM jobs WHERE status IN ('done', 'failed') AND finished_at < now() - interval '30 days'");
      return;
    }
    case 'schedule': {
      // Daily re-scan of monitored repositories picks up new advisories even without pushes.
      const repos = await q<{ repository_id: string; org_id: string }>('SELECT repository_id, org_id FROM monitored_repositories()');
      for (const r of repos) await withOrg(r.org_id, (tx) => queueScan(tx, r.org_id, r.repository_id, 'schedule', null));
      return;
    }
    default:
      throw new Error(`unknown job kind ${job.kind}`);
  }
}

async function finish(job: Job, err: unknown): Promise<void> {
  if (!err) {
    await q("UPDATE jobs SET status = 'done', finished_at = now(), locked_at = NULL WHERE id = $1", [job.id]);
    return;
  }
  const message = sanitizeError(err);
  // Scan failures are recorded on the scan; retry only infrastructure-looking failures.
  const retryable = job.kind !== 'scan' || /ECONN|ETIMEDOUT|EAI_AGAIN|502|503|rate limit/i.test(message);
  if (retryable && job.attempts < job.max_attempts) {
    await q("UPDATE jobs SET status = 'queued', locked_at = NULL, last_error = $2, run_after = now() + make_interval(secs => $3) WHERE id = $1", [job.id, message, 30 * 2 ** job.attempts]);
    if (job.kind === 'scan' && job.org_id) {
      await withOrg(job.org_id, (tx) => tx.query("UPDATE scans SET status = 'queued' WHERE id = $1 AND status = 'failed'", [String(job.payload.scanId)]));
    }
  } else {
    await q("UPDATE jobs SET status = 'failed', finished_at = now(), locked_at = NULL, last_error = $2 WHERE id = $1", [job.id, message]);
  }
}

/** Requeue jobs whose worker died mid-run. */
async function recoverStale(): Promise<void> {
  const limit = config().SCAN_TIMEOUT_SECONDS + 900;
  await q("UPDATE jobs SET status = 'queued', locked_at = NULL, last_error = 'worker lost' WHERE status = 'running' AND locked_at < now() - make_interval(secs => $1)", [limit]);
}

/** Make sure the daily maintenance jobs exist. */
async function ensureMaintenance(): Promise<void> {
  for (const kind of ['purge', 'schedule'] as const) {
    const pending = await q1("SELECT 1 FROM jobs WHERE kind = $1 AND status IN ('queued', 'running')", [kind]);
    if (!pending) {
      const client = await (await import('../lib/db')).db().connect();
      try {
        await enqueue(client, null, kind, {}, kind === 'purge' ? 3600 : 86_400);
      } finally {
        client.release();
      }
    }
  }
}

async function loop(slot: number): Promise<void> {
  while (!stopping) {
    let job: Job | null = null;
    try {
      job = await claim();
    } catch (err) {
      log().error({ err: sanitizeError(err) }, 'claim failed');
    }
    if (!job) {
      await new Promise((r) => setTimeout(r, 2000 + slot * 250));
      continue;
    }
    const t0 = Date.now();
    let error: unknown = null;
    try {
      await run(job);
    } catch (err) {
      error = err;
    }
    try {
      await finish(job, error);
    } catch (err) {
      log().error({ err: sanitizeError(err), jobId: job.id }, 'could not record job outcome');
    }
    log()[error ? 'warn' : 'info']({ jobId: job.id, kind: job.kind, ms: Date.now() - t0, ...(error ? { err: sanitizeError(error) } : {}) }, error ? 'job failed' : 'job done');
  }
}

async function main(): Promise<void> {
  const c = config();
  log().info({ worker: WORKER_ID, concurrency: c.WORKER_CONCURRENCY }, 'worker starting');
  await recoverStale();
  await ensureMaintenance();
  const timers = [setInterval(() => void recoverStale().catch(() => undefined), 60_000), setInterval(() => void ensureMaintenance().catch(() => undefined), 3_600_000)];
  const stop = () => {
    stopping = true;
    timers.forEach(clearInterval);
    log().info('worker stopping after current jobs');
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
  await Promise.all(Array.from({ length: c.WORKER_CONCURRENCY }, (_, i) => loop(i)));
  process.exit(0);
}

main().catch((err) => {
  log().fatal({ err: sanitizeError(err) }, 'worker crashed');
  process.exit(1);
});
