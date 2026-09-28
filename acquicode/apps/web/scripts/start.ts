/**
 * Single-container mode for platforms that run one process per service:
 * apply migrations, then run the web server and the worker side by side.
 *
 *   node dist-node/scripts/start.mjs
 *
 * Migrations run only when DATABASE_MIGRATION_URL is set (the owner account the
 * platform provides); with APP_DB_PASSWORD, the least-privilege application role
 * is created on first start. If either process exits, the other is stopped and
 * the container exits with that status, so the platform restarts both together.
 * Output is the children's own structured logs; nothing here prints credentials.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { migrate } from './migrate';

const cwd = process.cwd();

function line(msg: string): void {
  process.stdout.write(`${JSON.stringify({ level: 30, time: new Date().toISOString(), service: 'start', msg })}\n`);
}

async function migrateWithRetry(url: string): Promise<void> {
  const deadline = Date.now() + 120_000;
  for (let attempt = 1; ; attempt++) {
    try {
      const applied = await migrate(url, process.env.APP_DB_ROLE ?? 'acquicode_app', join(cwd, 'db/migrations'), { appPassword: process.env.APP_DB_PASSWORD });
      line(applied.length ? `applied migrations: ${applied.join(', ')}` : 'database is up to date');
      return;
    } catch (err) {
      const message = (err as Error).message.replace(/postgres(ql)?:\/\/[^\s]+/g, 'postgres://[redacted]');
      // Connection problems while the database starts are retried; a failing migration is not.
      const transient = /ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|starting up|Connection terminated|timeout/i.test(message);
      if (!transient || Date.now() > deadline) throw new Error(message);
      line(`database not ready (attempt ${attempt}): ${message}`);
      await new Promise((r) => setTimeout(r, Math.min(10_000, 1000 * attempt)));
    }
  }
}

async function main(): Promise<void> {
  const migrationUrl = process.env.DATABASE_MIGRATION_URL;
  if (migrationUrl) await migrateWithRetry(migrationUrl);
  else line('DATABASE_MIGRATION_URL is not set: skipping migrations');

  const server = existsSync(join(cwd, 'server.js')) ? 'server.js' : '.next/standalone/apps/web/server.js';
  const children: Array<{ name: string; proc: ChildProcess }> = [
    { name: 'web', proc: spawn(process.execPath, [server], { cwd, stdio: 'inherit', env: process.env }) },
    { name: 'worker', proc: spawn(process.execPath, ['dist-node/worker/index.mjs'], { cwd, stdio: 'inherit', env: process.env }) },
  ];

  let stopping = false;
  const stopAll = (signal: NodeJS.Signals) => {
    for (const c of children) if (c.proc.exitCode === null && c.proc.signalCode === null) c.proc.kill(signal);
  };
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.on(signal, () => {
      stopping = true;
      stopAll(signal);
    });
  }
  let remaining = children.length;
  let status = 0;
  for (const c of children) {
    c.proc.on('exit', (code, signal) => {
      remaining--;
      if (!stopping) {
        line(`${c.name} exited (${signal ?? code}); stopping the other process`);
        status = code && code !== 0 ? code : 1;
        stopping = true;
        stopAll('SIGTERM');
        // Give the survivor time to finish in-flight work, then leave regardless.
        setTimeout(() => process.exit(status), 25_000).unref();
      }
      if (remaining === 0) process.exit(status);
    });
  }
}

main().catch((err: Error) => {
  process.stderr.write(`${JSON.stringify({ level: 60, time: new Date().toISOString(), service: 'start', msg: `start failed: ${err.message}` })}\n`);
  process.exit(1);
});
