/**
 * Meridian Systems: a deliberately messy synthetic company, rebuilt from this
 * script on demand. Every author, date and file is fixed, so commit SHAs and
 * the resulting dossier digest are identical on every machine.
 *
 * What it contains, and what the analyzer is expected to find:
 * - human code, AI-assisted code (Claude Code trailers, a Copilot agent commit,
 *   aider, a Cursor co-author), git-ai line-level notes, Agent Trace records
 *   (valid, forged, out-of-range, and one that contradicts git-ai)
 * - a declaration that billing code is human-written, later contradicted
 * - generated files, a minified bundle, a committed binary and model weights
 * - imported snippets (Stack Overflow link, third-party copyright, GPL SPDX header)
 * - copyleft (AGPL, GPL) and source-available dependencies, an unknown license
 * - lockfile drift, an unpinned Python service with an extra index, a private
 *   package fetched over HTTP, a typosquat-like name, install scripts
 * - a live-looking AWS key in code, a GitHub token only in history, a committed
 *   .env file, a test placeholder password (suppressed with a reason)
 * - a vulnerable CI workflow and an unpinned Dockerfile
 * - contractors on personal/agency/no-reply addresses, an IP register with a gap
 *   and a late signature
 *
 * Secrets are assembled at runtime so no provider-format token appears in this
 * source file.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { sha256Hex, stableId } from '../canonical.js';

interface Person {
  name: string;
  email: string;
}

const ANA: Person = { name: 'Ana Ortiz', email: 'ana@meridian.io' };
const BEN: Person = { name: 'Ben Kaplan', email: 'ben@meridian.io' };
const CHRIS: Person = { name: 'Chris Dale', email: 'chris.dale@gmail.com' };
const PRIYA: Person = { name: 'Priya Natarajan', email: 'priya@quickdev-agency.com' };
const OCTO: Person = { name: 'octodev', email: '4412345+octodev@users.noreply.github.com' };
const COPILOT: Person = { name: 'Copilot', email: '198982749+Copilot@users.noreply.github.com' };
const DEPENDABOT: Person = { name: 'dependabot[bot]', email: '49699333+dependabot[bot]@users.noreply.github.com' };

const CLAUDE_TRAILER = 'Co-Authored-By: Claude <noreply@anthropic.com>';
const CLAUDE_BODY = '🤖 Generated with [Claude Code](https://claude.com/claude-code)';

export interface MeridianBuild {
  dir: string;
  commits: Record<string, string>;
}

const lines = (n: number, f: (i: number) => string) => Array.from({ length: n }, (_, i) => f(i + 1)).join('\n') + '\n';

export function buildMeridian(dir: string): MeridianBuild {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const env = (who: Person, date: string, committer: Person = who) => ({
    ...process.env,
    GIT_AUTHOR_NAME: who.name,
    GIT_AUTHOR_EMAIL: who.email,
    GIT_AUTHOR_DATE: date,
    GIT_COMMITTER_NAME: committer.name,
    GIT_COMMITTER_EMAIL: committer.email,
    GIT_COMMITTER_DATE: date,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
    HOME: dir,
  });
  const git = (args: string[], e: NodeJS.ProcessEnv = env(ANA, '2024-01-01T00:00:00Z')) =>
    execFileSync('git', ['-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], { cwd: dir, env: e, stdio: ['pipe', 'pipe', 'pipe'] }).toString().trim();
  const write = (path: string, content: string | Buffer) => {
    const abs = join(dir, path);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  };
  const remove = (path: string) => rmSync(join(dir, path), { force: true });
  const commits: Record<string, string> = {};
  const commit = (key: string, who: Person, date: string, message: string, committer?: Person) => {
    git(['add', '-A']);
    git(['commit', '-q', '--allow-empty', '-m', message], env(who, date, committer));
    commits[key] = git(['rev-parse', 'HEAD']);
    return commits[key]!;
  };

  git(['init', '-q', '-b', 'main']);
  git(['remote', 'add', 'origin', 'https://github.com/meridian-systems/meridian-platform.git']);

  // ---- 1. Initial human scaffold (Ana, 2023)
  write('README.md', '# Meridian Platform\n\nBilling and search APIs for Meridian Systems.\n\n## Development\n\n`npm ci && npm test`\n');
  write('package.json', JSON.stringify({
    name: 'meridian-platform',
    version: '1.4.0',
    private: true,
    license: 'UNLICENSED',
    engines: { node: '>=20' },
    scripts: { build: 'tsc', test: 'vitest run' },
    dependencies: { express: '^4.18.2', lodash: '^4.17.20' },
    devDependencies: { typescript: '^5.4.0' },
  }, null, 2) + '\n');
  write('package-lock.json', lockfile({
    express: { version: '4.18.2', license: 'MIT' },
    lodash: { version: '4.17.20', license: 'MIT' },
    typescript: { version: '5.4.5', license: 'Apache-2.0', dev: true },
  }, { express: '^4.18.2', lodash: '^4.17.20' }, { typescript: '^5.4.0' }));
  write('src/server.ts', lines(30, (i) => (i === 1 ? "import express from 'express';" : `// server setup step ${i}`)));
  write('src/billing/invoice.ts', lines(60, (i) => `export const invoiceRule${i} = (amount: number) => amount * ${i};`));
  write('src/billing/tax.ts', lines(40, (i) => `export const taxBand${i} = ${i * 0.01};`));
  commit('scaffold', ANA, '2023-02-01T10:00:00Z', 'Initial scaffold: server and billing');

  // ---- 2. Ben joins before his agreement is signed (register says 2024-06-01)
  write('src/users/profile.ts', lines(35, (i) => `export function profileField${i}() { return ${i}; }`));
  write('test/billing.test.ts', "import { invoiceRule1 } from '../src/billing/invoice';\n// placeholder credential used only by tests\nconst password = \"test-password-123\";\nexport const t = invoiceRule1(2) === 2 && password.length > 0;\n");
  commit('ben_first', BEN, '2023-09-12T09:30:00Z', 'Add user profiles and first test');

  // ---- 3. Contractor on a personal address copies snippets
  write('src/utils/retry.ts', [
    '// Retry with exponential backoff.',
    '// Based on https://stackoverflow.com/questions/38213668/promise-retry-design-patterns',
    'export async function retry<T>(fn: () => Promise<T>, n = 3): Promise<T> {',
    '  try { return await fn(); } catch (e) { if (n <= 0) throw e; return retry(fn, n - 1); }',
    '}',
    '',
  ].join('\n'));
  write('src/lib/geo.ts', [
    '/*',
    ' * Copyright (c) 2014 GeoCorp Ltd. All rights reserved.',
    ' * Haversine helpers.',
    ' */',
    'export const EARTH_RADIUS_KM = 6371;',
    '',
  ].join('\n'));
  write('src/lib/parse.ts', '// SPDX-License-Identifier: GPL-2.0-only\n// Adapted from https://github.com/example/csv-lite/blob/main/parse.c\nexport const parseCsv = (s: string) => s.split(",");\n');
  commit('contractor', CHRIS, '2024-02-03T14:00:00Z', 'Add retry, geo and CSV helpers');

  // ---- 4. A secret committed and later removed (history only)
  const ghToken = 'gh' + 'p_' + 'MeridianHistoricalToken0123456789abc';
  write('scripts/deploy.sh', `#!/bin/sh\nexport GITHUB_TOKEN=${ghToken}\ncurl -fsSL https://get.example-cdn.io/install.sh | sh\n`);
  commit('secret_added', BEN, '2024-03-10T08:00:00Z', 'Add deploy script');
  write('scripts/deploy.sh', '#!/bin/sh\n# token now comes from the CI secret store\ncurl -fsSL https://get.example-cdn.io/install.sh | sh\n');
  commit('secret_removed', BEN, '2024-03-11T08:00:00Z', 'Remove token from deploy script');

  // ---- 5. AI tools are adopted: Claude Code config, Cursor rules
  write('CLAUDE.md', '# Project guidance for Claude Code\n\nUse TypeScript strict mode. Run tests before committing.\n');
  write('.cursor/rules/style.mdc', '---\ndescription: Style\n---\nPrefer small pure functions.\n');
  commit('agent_config', ANA, '2024-07-01T12:00:00Z', 'Add AI assistant configuration');

  // ---- 6. Claude Code writes the summariser (with git-ai line attribution)
  write('src/ai/summarize.ts', lines(50, (i) =>
    i === 1 ? "const ENDPOINT = 'https://api.openai.com/v1/chat/completions';" : i === 2 ? "const MODEL = 'gpt-4o-2024-08-06';" : `export const summaryStep${i} = (t: string) => t.slice(0, ${i});`,
  ));
  const summarizeCommit = commit('claude_summarize', ANA, '2024-07-15T16:20:00Z', `Add document summariser\n\n${CLAUDE_BODY}\n\n${CLAUDE_TRAILER}`);

  // ---- 7. Claude also edits the billing code that the company later declares human-written
  write('src/billing/invoice.ts', lines(60, (i) => (i <= 20 ? `export const invoiceRule${i} = (amount: number) => Math.round(amount * ${i} * 100) / 100;` : `export const invoiceRule${i} = (amount: number) => amount * ${i};`)));
  commit('claude_billing', ANA, '2024-08-02T11:00:00Z', `Round invoice rules to cents\n\n${CLAUDE_BODY}\n\n${CLAUDE_TRAILER}`);

  // ---- 8. Copilot coding agent authors a search module via a pull request (squash-merged)
  write('src/search/index.ts', lines(45, (i) => `export const searchIndexPart${i} = ${i};`));
  const searchCommit = commit('copilot_search', COPILOT, '2024-09-05T13:00:00Z', `Add search index (#42)\n\nCo-authored-by: Ben Kaplan <ben@meridian.io>`, OCTO);

  // ---- 9. aider change and a Cursor co-authored change
  write('src/users/profile.ts', lines(40, (i) => `export function profileField${i}() { return ${i}; }`));
  commit('aider', BEN, '2024-09-20T10:00:00Z', 'aider: extend profile fields');
  write('src/ai/helpers.ts', '// This file was generated by ChatGPT and reviewed by the team.\nexport const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));\n');
  write('src/users/avatar.ts', lines(25, (i) => `export const avatarSize${i} = ${i * 8};`));
  commit('cursor', PRIYA, '2024-10-01T09:00:00Z', 'Add avatar sizes\n\nCo-authored-by: Cursor Agent <cursoragent@cursor.com>');

  // ---- 10. Large unattributed change after AI adoption (inference only)
  for (let f = 1; f <= 10; f++) write(`src/reports/report${f}.ts`, lines(95, (i) => `export const report${f}Metric${i} = ${f * i};`));
  commit('bulk', BEN, '2024-10-15T17:45:00Z', 'Add reporting module');

  // ---- 11. Dependencies grow: copyleft, source-available, private over HTTP, drift, typosquat
  write('package.json', JSON.stringify({
    name: 'meridian-platform',
    version: '1.5.0',
    private: true,
    license: 'UNLICENSED',
    engines: { node: '>=20' },
    scripts: { build: 'tsc', test: 'vitest run' },
    dependencies: {
      express: '^4.18.2',
      lodash: '^4.17.20',
      openai: '^4.52.0',
      'pdf-render-kit': '^2.1.0',
      'graph-weaver': '^1.3.0',
      'meridian-auth': '^0.9.0',
      bcrypt: '^5.1.1',
      loadash: '^1.0.0',
      zod: '^3.23.0',
    },
    devDependencies: { typescript: '^5.4.0' },
  }, null, 2) + '\n');
  write('package-lock.json', lockfile({
    express: { version: '4.18.2', license: 'MIT' },
    lodash: { version: '4.17.20', license: 'MIT' },
    openai: { version: '4.52.7', license: 'Apache-2.0' },
    'pdf-render-kit': { version: '2.1.0', license: 'AGPL-3.0-only' },
    'graph-weaver': { version: '1.3.2', license: 'BUSL-1.1' },
    'meridian-auth': { version: '0.9.4', resolved: 'http://npm.internal.meridian.io/meridian-auth/-/meridian-auth-0.9.4.tgz', noIntegrity: true },
    bcrypt: { version: '5.1.1', license: 'MIT', install: true },
    loadash: { version: '1.0.0' },
    'readable-stream': { version: '2.3.8', license: 'MIT' },
    'gpl-helpers': { version: '0.4.0', license: 'GPL-3.0-or-later' },
    typescript: { version: '5.4.5', license: 'Apache-2.0', dev: true },
  }, { express: '^4.18.2', lodash: '^4.17.20', openai: '^4.52.0', 'pdf-render-kit': '^2.1.0', 'graph-weaver': '^1.3.0', 'meridian-auth': '^0.9.0', bcrypt: '^5.1.1', loadash: '^1.0.0' }, { typescript: '^5.4.0' }));
  commit('deps', ANA, '2024-11-04T10:00:00Z', 'Add PDF export, graph and auth dependencies');
  write('package-lock.json', lockfile({
    express: { version: '4.18.2', license: 'MIT' },
    lodash: { version: '4.17.20', license: 'MIT' },
    openai: { version: '4.52.7', license: 'Apache-2.0' },
    'pdf-render-kit': { version: '2.1.0', license: 'AGPL-3.0-only' },
    'graph-weaver': { version: '1.3.2', license: 'BUSL-1.1' },
    'meridian-auth': { version: '0.9.4', resolved: 'http://npm.internal.meridian.io/meridian-auth/-/meridian-auth-0.9.4.tgz', noIntegrity: true },
    bcrypt: { version: '5.1.1', license: 'MIT', install: true },
    loadash: { version: '1.0.0' },
    'readable-stream': { version: '2.3.8', license: 'MIT' },
    'gpl-helpers': { version: '0.4.0', license: 'GPL-3.0-or-later' },
    typescript: { version: '5.4.5', license: 'Apache-2.0', dev: true },
  }, { express: '^4.18.2', lodash: '^4.17.20', openai: '^4.52.0', 'pdf-render-kit': '^2.1.0', 'graph-weaver': '^1.3.0', 'meridian-auth': '^0.9.0', bcrypt: '^5.1.1', loadash: '^1.0.0' }, { typescript: '^5.4.0' }, true));
  commit('dependabot', DEPENDABOT, '2024-11-20T03:00:00Z', 'Bump lockfile metadata');

  // ---- 12. Python ML service: unpinned, with a private extra index
  write('ml/requirements.txt', '--extra-index-url https://pypi.meridian.internal/simple\nnumpy>=1.26\nscikit-learn\nmeridian-features==0.3.1\n');
  write('ml/train.py', 'import numpy as np\n\ndef train():\n    return np.zeros(3)\n');
  write('models/churn.onnx', Buffer.concat([Buffer.from([0x08, 0x07, 0x12, 0x00]), Buffer.alloc(256, 7)]));
  commit('ml', PRIYA, '2025-01-08T15:00:00Z', 'Add churn model training service');

  // ---- 13. Generated code, build output, a binary, vendored code
  write('src/generated/schema.ts', '// Code generated by openapi-codegen. DO NOT EDIT.\nexport interface Invoice { id: string }\n');
  write('dist/bundle.min.js', 'var a=1;' + 'function f(n){return n*2}'.repeat(200) + '\n');
  write('bin/legacy-export.exe', Buffer.concat([Buffer.from('MZ'), Buffer.alloc(510, 0)]));
  write('vendor/tinycrypt/sha.c', '/* sha helpers */\nint sha(void){return 0;}\n');
  write('third_party/fastjson/LICENSE', 'MIT License\n\nCopyright (c) 2019 FastJSON Authors\n\nPermission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction. The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.\n');
  write('third_party/fastjson/fastjson.c', 'int parse(void){return 1;}\n');
  write('.gitattributes', 'src/generated/** linguist-generated\n');
  commit('artifacts', OCTO, '2025-02-14T12:00:00Z', 'Add generated schema, vendored libraries and legacy exporter');

  // ---- 14. Secrets in current code and an env file
  const awsKey = 'AKIA' + 'MERIDIANFIXTURE7';
  const stripeKey = 'sk_' + 'live_' + 'meridian0fixture0key000';
  write('src/config.ts', `export const config = {\n  region: 'eu-west-1',\n  awsAccessKeyId: '${awsKey}',\n};\n`);
  write('config/.env.production', `STRIPE_KEY=${stripeKey}\nDATABASE_URL=postgres://meridian:Pr0dPassw0rd9@db.meridian.io:5432/app\n`);
  commit('secrets', CHRIS, '2025-03-01T09:00:00Z', 'Add production configuration');

  // ---- 15. CI and container
  write('.github/workflows/ci.yml', [
    'name: ci',
    'on:',
    '  pull_request_target:',
    '    types: [opened, synchronize]',
    'permissions: write-all',
    'jobs:',
    '  test:',
    '    runs-on: ubuntu-latest',
    '    steps:',
    '      - uses: actions/checkout@v4',
    '        with:',
    '          ref: ${{ github.event.pull_request.head.sha }}',
    '      - uses: some-org/deploy-action@v2',
    '      - name: Greet',
    '        run: |',
    '          echo "Testing ${{ github.event.pull_request.title }}"',
    '          curl -sL https://get.example-cdn.io/setup.sh | bash',
    '',
  ].join('\n'));
  write('Dockerfile', 'FROM node:latest AS build\nWORKDIR /app\nCOPY . .\nRUN npm ci && npm run build\n\nFROM python:3.12-slim\nCOPY --from=build /app/dist /app\n');
  commit('ci', BEN, '2025-04-02T10:00:00Z', 'Add CI workflow and container build');

  // ---- 16. Agent Trace records committed alongside the code: one valid, one forged, one out of range,
  //          one contradicting git-ai on the summariser.
  const traces = [
    { version: '0.1.0', id: '11111111-1111-4111-8111-111111111111', timestamp: '2024-09-05T13:05:00Z', vcs: { type: 'git', revision: searchCommit }, tool: { name: 'cursor', version: '2.4.0' }, files: [{ path: 'src/search/index.ts', conversations: [{ contributor: { type: 'ai', model_id: 'anthropic/claude-sonnet-4-20250514' }, ranges: [{ start_line: 1, end_line: 45 }] }] }] },
    { version: '0.1.0', id: '22222222-2222-4222-8222-222222222222', timestamp: '2025-04-01T00:00:00Z', vcs: { type: 'git', revision: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef' }, tool: { name: 'cursor' }, files: [{ path: 'src/billing/tax.ts', conversations: [{ contributor: { type: 'ai' }, ranges: [{ start_line: 1, end_line: 40 }] }] }] },
    { version: '0.1.0', id: '33333333-3333-4333-8333-333333333333', timestamp: '2024-07-15T16:30:00Z', vcs: { type: 'git', revision: summarizeCommit }, tool: { name: 'cursor' }, files: [{ path: 'src/ai/summarize.ts', conversations: [{ contributor: { type: 'ai' }, ranges: [{ start_line: 45, end_line: 400 }] }] }] },
    { version: '0.1.0', id: '44444444-4444-4444-8444-444444444444', timestamp: '2024-07-15T16:40:00Z', vcs: { type: 'git', revision: summarizeCommit }, tool: { name: 'cursor' }, files: [{ path: 'src/ai/summarize.ts', conversations: [{ contributor: { type: 'human' }, ranges: [{ start_line: 1, end_line: 10 }] }] }] },
  ];
  write('.agent-trace/traces.jsonl', traces.map((t) => JSON.stringify(t)).join('\n') + '\n');

  // ---- 17. Declarations and IP register (company-asserted)
  write('acquicode.yml', [
    'company:',
    '  names: ["Meridian Systems, Inc.", "Meridian Systems"]',
    '  domains: ["meridian.io"]',
    'distribution: on_prem',
    'ai_usage: some',
    'ai_tools:',
    '  - tool: claude-code',
    '    plan: enterprise',
    '    indemnity: true',
    '    from: 2024-07-01',
    '    evidence: "Anthropic commercial agreement dated 2024-06-20"',
    'origins:',
    '  - paths: ["src/billing/**"]',
    '    origin: human',
    '    statement: "Billing rules were written by hand by the core team"',
    '    declared_on: 2024-06-30',
    '    by: "Ana Ortiz, CTO"',
    'contributors:',
    '  - email: ana@meridian.io',
    '    name: Ana Ortiz',
    '    agreement: founder_assignment',
    '    signed_on: 2023-01-15',
    '  - email: ben@meridian.io',
    '    name: Ben Kaplan',
    '    agreement: employee_piia',
    '    signed_on: 2024-06-01',
    '  - email: chris.dale@gmail.com',
    '    name: Chris Dale',
    '    agreement: none',
    'suppressions:',
    '  - rule: SEC-001',
    `    fingerprint: ${stableId('fp', 'SEC-001', '', `generic-secret:${sha256Hex('generic-secret:test-password-123').slice(0, 16)}`)}`,
    '    reason: "Test-only password used by the billing unit test; not a real credential."',
    '    by: "security@meridian.io"',
    '',
  ].join('\n'));
  commit('traces', ANA, '2025-04-10T12:00:00Z', 'Record agent traces and company declarations');

  // ---- git-ai notes on the summariser commit: lines 1-40 AI (claude), 41-50 human
  const note = [
    'src/ai/summarize.ts',
    '  s_a1b2c3d4e5f607::t_0a0b0c0d0e0f01 1-40',
    '  h_31dce776f88375 41-50',
    '---',
    JSON.stringify({
      schema_version: 'authorship/3.0.0',
      git_ai_version: '1.4.5',
      base_commit_sha: summarizeCommit,
      prompts: {},
      humans: { h_31dce776f88375: { author: 'Ana Ortiz <ana@meridian.io>' } },
      sessions: { s_a1b2c3d4e5f607: { agent_id: { tool: 'claude', id: 'sess-0001', model: 'claude-sonnet-4-20250514' }, human_author: 'ana@meridian.io' } },
    }, null, 2),
    '',
  ].join('\n');
  git(['notes', '--ref=ai', 'add', '-m', note, summarizeCommit], env(ANA, '2024-07-15T16:21:00Z'));

  return { dir, commits };
}

function lockfile(
  pkgs: Record<string, { version: string; license?: string; dev?: boolean; resolved?: string; noIntegrity?: boolean; install?: boolean }>,
  deps: Record<string, string>,
  devDeps: Record<string, string>,
  bumped = false,
): string {
  const packages: Record<string, unknown> = {
    '': { name: 'meridian-platform', version: bumped ? '1.5.1' : '1.5.0', license: 'UNLICENSED', dependencies: deps, devDependencies: devDeps },
  };
  for (const [name, p] of Object.entries(pkgs)) {
    const e: Record<string, unknown> = {
      version: p.version,
      resolved: p.resolved ?? `https://registry.npmjs.org/${name}/-/${name}-${p.version}.tgz`,
    };
    if (!p.noIntegrity) e.integrity = `sha512-${Buffer.from(`${name}@${p.version}`).toString('base64')}`;
    if (p.dev) e.dev = true;
    if (p.license) e.license = p.license;
    if (p.install) e.hasInstallScript = true;
    packages[`node_modules/${name}`] = e;
  }
  return JSON.stringify({ name: 'meridian-platform', version: '1.5.0', lockfileVersion: 3, requires: true, packages }, null, 2) + '\n';
}

