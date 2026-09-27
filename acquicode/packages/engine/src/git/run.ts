import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let isolatedHome: string | null = null;

function home(): string {
  if (!isolatedHome) isolatedHome = mkdtempSync(join(tmpdir(), 'acq-git-home-'));
  return isolatedHome;
}

/**
 * Environment for every git invocation. The repository under analysis is
 * untrusted: no user/system config, no hooks, no fsmonitor, no replace refs
 * (which can silently rewrite history), no credential prompts, C locale.
 */
export function gitEnv(): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin',
    HOME: home(),
    XDG_CONFIG_HOME: home(),
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_TERMINAL_PROMPT: '0',
    GIT_OPTIONAL_LOCKS: '0',
    GIT_NO_REPLACE_OBJECTS: '1',
    GIT_ASKPASS: '/bin/false',
    SSH_ASKPASS: '/bin/false',
    GCM_INTERACTIVE: 'never',
    LC_ALL: 'C',
    LANG: 'C',
  };
}

export const SAFE_CONFIG = [
  '-c', 'core.hooksPath=/dev/null',
  '-c', 'core.fsmonitor=false',
  '-c', 'core.quotePath=false',
  '-c', 'safe.directory=*',
  '-c', 'protocol.file.allow=never',
  '-c', 'protocol.ext.allow=never',
  '-c', 'submodule.recurse=false',
  '-c', 'log.showSignature=false',
  '-c', 'i18n.logOutputEncoding=UTF-8',
];

export class GitError extends Error {
  constructor(
    message: string,
    readonly code: number | null,
    readonly stderr: string,
  ) {
    super(message);
  }
}

export interface RunOptions {
  cwd: string;
  input?: string | Buffer;
  /** Abort if stdout exceeds this many bytes (default 1 GiB). */
  maxBytes?: number;
  allowFailure?: boolean;
  timeoutMs?: number;
}

/** Run git with arguments (never a shell) and collect stdout as a Buffer. */
export function runGit(args: string[], opts: RunOptions): Promise<{ stdout: Buffer; code: number | null; stderr: string }> {
  const maxBytes = opts.maxBytes ?? 1024 * 1024 * 1024;
  return new Promise((resolve, reject) => {
    const child = spawn('git', [...SAFE_CONFIG, ...args], {
      cwd: opts.cwd,
      env: gitEnv(),
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const chunks: Buffer[] = [];
    let size = 0;
    let stderr = '';
    let killed = false;
    const timer = opts.timeoutMs
      ? setTimeout(() => {
          killed = true;
          child.kill('SIGKILL');
        }, opts.timeoutMs)
      : null;
    child.stdout.on('data', (c: Buffer) => {
      size += c.length;
      if (size > maxBytes) {
        killed = true;
        child.kill('SIGKILL');
        return;
      }
      chunks.push(c);
    });
    child.stderr.on('data', (c: Buffer) => {
      if (stderr.length < 64 * 1024) stderr += c.toString('utf8');
    });
    child.on('error', (err) => {
      if (timer) clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      if (killed) {
        reject(new GitError(`git ${args[0]} aborted (output or time limit)`, code, stderr));
        return;
      }
      if (code !== 0 && !opts.allowFailure) {
        reject(new GitError(`git ${args[0]} exited with ${code}: ${stderr.trim().slice(0, 500)}`, code, stderr));
        return;
      }
      resolve({ stdout: Buffer.concat(chunks), code, stderr });
    });
    if (opts.input !== undefined) child.stdin.end(opts.input);
    else child.stdin.end();
  });
}

export async function gitText(args: string[], opts: RunOptions): Promise<string> {
  const { stdout } = await runGit(args, opts);
  return stdout.toString('utf8');
}

export interface BatchObject {
  id: string;
  type: string;
  size: number;
  missing: boolean;
}

/**
 * Stream objects through `git cat-file --batch`. For each requested id the
 * callback receives the object's metadata and either its full content (when
 * `keep(id, size)` returns true) or null, plus a streaming sha256 when requested.
 * Objects are delivered in request order.
 */
export function catFileBatch(
  cwd: string,
  ids: string[],
  onObject: (obj: BatchObject, content: Buffer | null, digest: string | null) => void,
  opts: { keep: (id: string, size: number) => boolean; hash: boolean },
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (ids.length === 0) {
      resolve();
      return;
    }
    const child = spawn('git', [...SAFE_CONFIG, 'cat-file', '--batch'], {
      cwd,
      env: gitEnv(),
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (c: Buffer) => {
      if (stderr.length < 16 * 1024) stderr += c.toString('utf8');
    });

    let idx = 0;
    let pending: Buffer = Buffer.alloc(0);
    // State for the object currently being read.
    let cur: { obj: BatchObject; remaining: number; parts: Buffer[] | null; hasher: ReturnType<typeof createHash> | null } | null =
      null;
    let awaitingNewline = false;

    const finishObject = () => {
      if (!cur) return;
      const content = cur.parts ? Buffer.concat(cur.parts) : null;
      const digest = cur.hasher ? cur.hasher.digest('hex') : null;
      onObject(cur.obj, content, digest);
      cur = null;
      awaitingNewline = true;
    };

    const pump = () => {
      for (;;) {
        if (awaitingNewline) {
          if (pending.length === 0) return;
          // Skip the LF that terminates object content.
          pending = pending.subarray(1);
          awaitingNewline = false;
          idx++;
          continue;
        }
        if (cur) {
          if (pending.length === 0) return;
          const take = Math.min(cur.remaining, pending.length);
          const slice = pending.subarray(0, take);
          if (cur.parts) cur.parts.push(Buffer.from(slice));
          if (cur.hasher) cur.hasher.update(slice);
          cur.remaining -= take;
          pending = pending.subarray(take);
          if (cur.remaining === 0) finishObject();
          continue;
        }
        const nl = pending.indexOf(10);
        if (nl < 0) return;
        const header = pending.subarray(0, nl).toString('utf8');
        pending = pending.subarray(nl + 1);
        const requested = ids[idx] ?? '';
        if (header.endsWith(' missing')) {
          onObject({ id: requested, type: 'missing', size: 0, missing: true }, null, null);
          idx++;
          continue;
        }
        const m = /^([0-9a-f]{40,64}) (\S+) (\d+)$/.exec(header);
        if (!m) {
          child.kill('SIGKILL');
          reject(new GitError(`unexpected cat-file header: ${header.slice(0, 120)}`, null, stderr));
          return;
        }
        const size = Number(m[3]);
        const keep = opts.keep(m[1]!, size);
        cur = {
          obj: { id: m[1]!, type: m[2]!, size, missing: false },
          remaining: size,
          parts: keep ? [] : null,
          hasher: opts.hash ? createHash('sha256') : null,
        };
        if (size === 0) finishObject();
      }
    };

    child.stdout.on('data', (c: Buffer) => {
      pending = pending.length ? Buffer.concat([pending, c]) : c;
      try {
        pump();
      } catch (err) {
        child.kill('SIGKILL');
        reject(err);
      }
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new GitError(`git cat-file exited with ${code}: ${stderr.trim().slice(0, 300)}`, code, stderr));
        return;
      }
      if (idx < ids.length) {
        reject(new GitError(`git cat-file returned ${idx} of ${ids.length} objects`, code, stderr));
        return;
      }
      resolve();
    });
    child.stdin.on('error', () => {
      /* child exited early; reported via close */
    });
    child.stdin.end(ids.join('\n') + '\n');
  });
}
