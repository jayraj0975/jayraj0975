import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

export interface Author {
  name: string;
  email: string;
}

export const ALICE: Author = { name: 'Alice Example', email: 'alice@acme.test' };

/** A throwaway git repository with deterministic commits. */
export class TestRepo {
  readonly dir: string;
  private tick = 0;

  constructor(prefix = 'acq-test-') {
    this.dir = mkdtempSync(join(tmpdir(), prefix));
    this.git(['init', '-q', '-b', 'main']);
  }

  git(args: string[], author: Author = ALICE, date?: string): string {
    const d = date ?? new Date(Date.UTC(2025, 0, 1) + this.tick * 3_600_000).toISOString();
    return execFileSync('git', ['-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], {
      cwd: this.dir,
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: author.name,
        GIT_AUTHOR_EMAIL: author.email,
        GIT_AUTHOR_DATE: d,
        GIT_COMMITTER_NAME: author.name,
        GIT_COMMITTER_EMAIL: author.email,
        GIT_COMMITTER_DATE: d,
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_CONFIG_GLOBAL: '/dev/null',
        HOME: this.dir,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
      .toString()
      .trim();
  }

  write(path: string, content: string | Buffer): this {
    const abs = join(this.dir, path);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
    return this;
  }

  symlink(path: string, target: string): this {
    const abs = join(this.dir, path);
    mkdirSync(dirname(abs), { recursive: true });
    symlinkSync(target, abs);
    return this;
  }

  remove(path: string): this {
    rmSync(join(this.dir, path), { force: true, recursive: true });
    return this;
  }

  commit(message: string, author: Author = ALICE, date?: string): string {
    this.tick++;
    this.git(['add', '-A']);
    this.git(['commit', '-q', '--allow-empty', '-m', message], author, date);
    return this.git(['rev-parse', 'HEAD']);
  }

  cleanup(): void {
    rmSync(this.dir, { recursive: true, force: true });
  }
}

export function tempDir(prefix = 'acq-dir-'): string {
  return mkdtempSync(join(tmpdir(), prefix));
}
