import { describe, expect, it } from 'vitest';
import { canonicalJson, stableId } from '../src/canonical.js';
import { capAt, combineAll, combineAny, isSupported, strength } from '../src/states.js';
import { PROVENANCE_STATES, type ProvenanceState } from '../src/model.js';
import { effectiveCategories, normalizeLicense, parseExpression, render } from '../src/licenses/spdx.js';
import { copyrightNotices, identifyLicenseText } from '../src/licenses/identify.js';
import { cvss3BaseScore } from '../src/enrich/cvss.js';
import { parseTrailers, pullRequestFromMessage, parsePerson } from '../src/git/commit.js';
import { commitSignals, fileHeaderAiMarker, isAutomationBot, matchAiIdentity } from '../src/provenance/signals.js';
import { parseAgentTrace, parseGitAiNote } from '../src/provenance/formats.js';
import { findSecrets, redactSecrets } from '../src/analyzers/secrets.js';
import { globToRegExp, isSafeRelativePath } from '../src/util/paths.js';
import { generatedHeaderMarker, looksMinified, parseGitattributes, vendoredRoot } from '../src/analyzers/classify.js';
import { editDistance } from '../src/analyzers/popular.js';
import { insideRunBlock } from '../src/analyzers/ci.js';
import { DeclarationError, parseDeclarations, parseRegisterCsv } from '../src/declarations.js';
import { normalizeOsv } from '../src/enrich/providers.js';

describe('canonical JSON', () => {
  it('is independent of key order and drops undefined', () => {
    expect(canonicalJson({ b: 1, a: { d: [1, { z: 1, y: 2 }], c: undefined } })).toBe('{"a":{"d":[1,{"y":2,"z":1}]},"b":1}');
    expect(canonicalJson({ a: 1, b: 2 })).toBe(canonicalJson({ b: 2, a: 1 }));
  });
  it('rejects non-finite numbers', () => {
    expect(() => canonicalJson({ a: Number.NaN })).toThrow();
  });
  it('produces stable content-addressed ids', () => {
    expect(stableId('ev', { a: 1 }, 'x')).toBe(stableId('ev', { a: 1 }, 'x'));
    expect(stableId('ev', { a: 1 })).not.toBe(stableId('ev', { a: 2 }));
    expect(stableId('ev', 'x')).toMatch(/^ev_[0-9a-f]{16}$/);
  });
});

describe('provenance state lattice', () => {
  const all = [...PROVENANCE_STATES];
  const pick = (seed: number, n: number): ProvenanceState[] => Array.from({ length: n }, (_, i) => all[(seed * 7 + i * 13) % all.length]!);

  it('conjunction is never stronger than its weakest input (exhaustive over pairs and triples)', () => {
    for (const a of all) for (const b of all) for (const c of all) {
      const r = combineAll([a, b, c]);
      expect(strength(r)).toBeLessThanOrEqual(Math.min(strength(a), strength(b), strength(c)));
    }
  });
  it('a derivation from several facts is at most DERIVED', () => {
    expect(combineAll(['VERIFIED', 'OBSERVED'])).toBe('DERIVED');
    expect(combineAll(['VERIFIED', 'VERIFIED'])).toBe('DERIVED');
    expect(combineAll(['OBSERVED'])).toBe('OBSERVED');
  });
  it('absence of evidence is UNKNOWN, never a positive state', () => {
    expect(combineAll([])).toBe('UNKNOWN');
    expect(combineAny([])).toBe('UNKNOWN');
    expect(combineAny(['UNKNOWN', 'UNKNOWN'])).toBe('UNKNOWN');
  });
  it('contradictions surface ahead of gaps', () => {
    expect(combineAll(['OBSERVED', 'UNKNOWN', 'CONFLICTING'])).toBe('CONFLICTING');
    expect(combineAny(['UNKNOWN', 'CONFLICTING'])).toBe('CONFLICTING');
  });
  it('disjunction never manufactures a state stronger than its best input', () => {
    for (let s = 0; s < 200; s++) {
      const input = pick(s, 1 + (s % 5));
      const r = combineAny(input);
      expect(strength(r)).toBeLessThanOrEqual(Math.max(...input.map(strength)));
    }
    expect(combineAny(['INFERRED', 'INFERRED', 'INFERRED'])).toBe('INFERRED');
  });
  it('capAt limits support but leaves non-support states alone', () => {
    expect(capAt('VERIFIED', 'USER_ASSERTED')).toBe('USER_ASSERTED');
    expect(capAt('INFERRED', 'USER_ASSERTED')).toBe('INFERRED');
    expect(capAt('CONFLICTING', 'USER_ASSERTED')).toBe('CONFLICTING');
    expect(isSupported('STALE')).toBe(false);
  });
});

describe('SPDX handling', () => {
  it('parses expressions with precedence and exceptions', () => {
    const n = parseExpression('MIT OR (Apache-2.0 AND BSD-3-Clause)');
    expect(n).not.toBeNull();
    expect(render(n!)).toBe('MIT OR (Apache-2.0 AND BSD-3-Clause)');
    expect(parseExpression('GPL-2.0-only WITH Classpath-exception-2.0')).toMatchObject({ exception: 'Classpath-exception-2.0' });
    expect(parseExpression('MIT AND')).toBeNull();
    expect(parseExpression('(MIT')).toBeNull();
  });
  it('dual licenses offer the least restrictive branch; conjunctions carry all obligations', () => {
    expect(effectiveCategories(parseExpression('GPL-3.0-only OR MIT'))).toEqual(['permissive']);
    expect(effectiveCategories(parseExpression('GPL-3.0-only AND MIT')).sort()).toEqual(['permissive', 'strong_copyleft']);
    expect(effectiveCategories(parseExpression('GPL-2.0-only WITH Classpath-exception-2.0'))).toEqual(['weak_copyleft']);
  });
  it('separates exact SPDX, aliases (inferred) and unrecognised strings', () => {
    expect(normalizeLicense('MIT')).toMatchObject({ expression: 'MIT', exact: true });
    expect(normalizeLicense('Apache 2.0')).toMatchObject({ expression: 'Apache-2.0', exact: false });
    expect(normalizeLicense('UNLICENSED')).toMatchObject({ proprietary: true });
    expect(normalizeLicense('SEE LICENSE IN LICENSE.txt')).toMatchObject({ seeFile: 'LICENSE.txt' });
    expect(normalizeLicense('Do Whatever You Like v7')?.expression).toMatch(/^LicenseRef-Unrecognised/);
    expect(normalizeLicense('MIT/Apache-2.0').expression).toBe('MIT OR Apache-2.0');
    expect(normalizeLicense(null).expression).toBeNull();
  });
});

describe('license text identification', () => {
  const MIT = `MIT License\n\nCopyright (c) 2020 Someone\n\nPermission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction...\n\nThe above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.`;
  it('identifies MIT as KNOWN', () => {
    expect(identifyLicenseText(MIT)).toMatchObject({ id: 'MIT', certainty: 'KNOWN', custom: false });
  });
  it('flags a modified MIT as custom and only LIKELY', () => {
    const r = identifyLicenseText(MIT + '\n\nThe Software may not be used for any competing product.');
    expect(r.id).toBe('MIT');
    expect(r.certainty).toBe('LIKELY');
    expect(r.custom).toBe(true);
  });
  it('does not confuse LGPL with GPL, and recognises GPL-3.0 despite its AGPL cross-reference', () => {
    expect(identifyLicenseText('GNU LESSER GENERAL PUBLIC LICENSE Version 3, 29 June 2007 ... GNU General Public License').id).toBe('LGPL-3.0');
    expect(identifyLicenseText('GNU GENERAL PUBLIC LICENSE Version 3, 29 June 2007 ... 13. Use with the GNU Affero General Public License.').id).toBe('GPL-3.0');
    expect(identifyLicenseText('GNU AFFERO GENERAL PUBLIC LICENSE Version 3, 19 November 2007').id).toBe('AGPL-3.0');
  });
  it('recognises proprietary notices and unknown custom text', () => {
    expect(identifyLicenseText('Copyright 2024 Acme. All rights reserved. Unauthorized copying of this file is strictly prohibited.')).toMatchObject({ id: null, proprietary: true });
    expect(identifyLicenseText('You get a license to use this code if you buy me a coffee.')).toMatchObject({ id: null, certainty: 'UNKNOWN', custom: true });
  });
  it('extracts copyright holders and skips template text', () => {
    expect(copyrightNotices('/*\n * Copyright (c) 2014-2019 GeoCorp Ltd. All rights reserved.\n */')[0]).toMatchObject({ holder: 'GeoCorp Ltd', line: 2 });
    expect(copyrightNotices('The above copyright notice and this permission notice')).toHaveLength(0);
  });
});

describe('CVSS 3.x', () => {
  it('matches reference scores', () => {
    expect(cvss3BaseScore('CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H')).toBe(9.8);
    expect(cvss3BaseScore('CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:C/C:H/I:H/A:H')).toBe(10);
    expect(cvss3BaseScore('CVSS:3.1/AV:L/AC:L/PR:L/UI:N/S:U/C:H/I:N/A:N')).toBe(5.5);
    expect(cvss3BaseScore('CVSS:3.0/AV:N/AC:H/PR:N/UI:R/S:U/C:L/I:L/A:N')).toBe(4.2);
    expect(cvss3BaseScore('CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:N')).toBe(0);
    expect(cvss3BaseScore('CVSS:4.0/AV:N')).toBeNull();
    expect(cvss3BaseScore('garbage')).toBeNull();
  });
});

describe('commit metadata', () => {
  it('parses trailers like git interpret-trailers', () => {
    const msg = 'Fix thing\n\nLonger body.\n\nCo-Authored-By: Claude <noreply@anthropic.com>\nSigned-off-by: A <a@b.c>';
    expect(parseTrailers(msg)).toEqual([
      ['Co-Authored-By', 'Claude <noreply@anthropic.com>'],
      ['Signed-off-by', 'A <a@b.c>'],
    ]);
    expect(parseTrailers('Subject only: not a trailer')).toEqual([]);
    expect(parseTrailers('Subject\n\nJust prose that mentions Note: something in passing and continues for a while.\nMore prose here.\nAnd more.\nAnd more again.')).toEqual([]);
  });
  it('finds pull request references', () => {
    expect(pullRequestFromMessage('Merge pull request #12 from a/b', '')).toBe(12);
    expect(pullRequestFromMessage('Add search (#42)', '')).toBe(42);
    expect(pullRequestFromMessage("Merge branch 'x' into 'main'", 'See merge request team/app!7')).toBe(7);
    expect(pullRequestFromMessage('Plain commit', '')).toBeNull();
  });
  it('parses person lines with offsets', () => {
    expect(parsePerson('Ana <a@b.c> 1700000000 +0530')).toEqual({ name: 'Ana', email: 'a@b.c', date: '2023-11-15T03:43:20+05:30' });
    expect(parsePerson('broken')).toMatchObject({ name: 'broken', email: '' });
  });
});

describe('AI signals', () => {
  const base = { subject: 'x', body: '', trailers: [] as Array<[string, string]>, author: { name: 'Ana', email: 'ana@acme.test' }, committer: { name: 'Ana', email: 'ana@acme.test' } };
  it('recognises agent identities and markers', () => {
    expect(commitSignals({ ...base, trailers: [['Co-Authored-By', 'Claude Opus 4.5 <noreply@anthropic.com>']] })[0]).toMatchObject({ tool: 'claude-code', kind: 'trailer', model: 'Claude Opus 4.5' });
    expect(commitSignals({ ...base, body: '🤖 Generated with [Claude Code](https://claude.com/claude-code)' })[0]).toMatchObject({ tool: 'claude-code', kind: 'body_marker' });
    expect(commitSignals({ ...base, author: { name: 'Copilot', email: '198982749+Copilot@users.noreply.github.com' } })[0]).toMatchObject({ tool: 'github-copilot', kind: 'bot_author' });
    expect(commitSignals({ ...base, subject: 'aider: tweak' })[0]).toMatchObject({ tool: 'aider' });
    expect(commitSignals({ ...base, trailers: [['Co-authored-by', 'Cursor Agent <cursoragent@cursor.com>']] })[0]).toMatchObject({ tool: 'cursor' });
    expect(commitSignals({ ...base, trailers: [['Assisted-by', 'GitHub Copilot']] })[0]).toMatchObject({ tool: 'github-copilot' });
  });
  it('treats the VS Code editor trailer as corroborating, not attribution', () => {
    const vscode = commitSignals({ ...base, trailers: [['Co-authored-by', 'Copilot <copilot@github.com>']] });
    expect(vscode).toHaveLength(1);
    expect(vscode[0]).toMatchObject({ tool: 'github-copilot', reliability: 'editor_inserted' });
    expect(vscode[0]!.caveat).toMatch(/microsoft\/vscode#313064/);
    // The Copilot coding agent's own identity is still direct.
    expect(commitSignals({ ...base, trailers: [['Co-authored-by', 'Copilot <198982749+Copilot@users.noreply.github.com>']] })[0]).toMatchObject({ reliability: 'direct' });
    expect(commitSignals({ ...base, trailers: [['Co-Authored-By', 'Claude <noreply@anthropic.com>']] })[0]).toMatchObject({ reliability: 'direct' });
  });
  it('does not treat human co-authors or automation bots as AI', () => {
    expect(commitSignals({ ...base, trailers: [['Co-authored-by', 'Claude Monet <claude@paint.test>']] })).toEqual([]);
    expect(commitSignals({ ...base, author: { name: 'dependabot[bot]', email: '49699333+dependabot[bot]@users.noreply.github.com' } })).toEqual([]);
    expect(isAutomationBot('renovate[bot]', 'bot@renovateapp.com')).toBe(true);
    expect(matchAiIdentity('Claude', 'claude@example.com')).toBeNull();
  });
  it('reads self-declared AI comments without mistaking code generators', () => {
    expect(fileHeaderAiMarker('// This file was generated by ChatGPT\nconst a = 1;')?.tool).toBe('chatgpt');
    expect(fileHeaderAiMarker('const note = "written by an AI"; // not a header comment')).toBeNull();
    expect(generatedHeaderMarker('// This file was generated by ChatGPT')).toBeNull();
    expect(generatedHeaderMarker('// Code generated by protoc-gen-go. DO NOT EDIT.')).toBeTruthy();
  });
});

describe('attribution formats', () => {
  const sha = 'a'.repeat(40);
  it('parses a git-ai authorship/3.0.0 note', () => {
    const note = `src/a.ts\n  s_0123456789abcd::t_0123456789abcd 1-10,15\n  h_0123456789abcd 11-14\n---\n${JSON.stringify({ schema_version: 'authorship/3.0.0', base_commit_sha: sha, prompts: {}, humans: { h_0123456789abcd: { author: 'A <a@b.c>' } }, sessions: { s_0123456789abcd: { agent_id: { tool: 'claude', id: 'x', model: 'm' } } } })}`;
    const { records, problems } = parseGitAiNote(sha, note, null);
    expect(problems).toEqual([]);
    expect(records[0]!.ranges).toEqual([
      { start: 1, end: 10, type: 'ai', tool: 'claude-code', model: 'm', session: 'x' },
      { start: 15, end: 15, type: 'ai', tool: 'claude-code', model: 'm', session: 'x' },
      { start: 11, end: 14, type: 'human', tool: null, model: null, session: null },
    ]);
  });
  it('reports malformed and forged notes instead of trusting them', () => {
    expect(parseGitAiNote(sha, 'no divider', null).problems[0]!.problem).toMatch(/divider/);
    expect(parseGitAiNote(sha, 'a\n---\n{not json', null).problems[0]!.problem).toMatch(/JSON/);
    const mismatch = parseGitAiNote(sha, `f\n  s_x 1-2\n---\n${JSON.stringify({ schema_version: 'authorship/3.0.0', base_commit_sha: 'b'.repeat(40), prompts: {} })}`, null);
    expect(mismatch.problems.map((p) => p.problem).join(' ')).toMatch(/does not match|not defined/);
    expect(mismatch.records[0]!.ranges[0]!.type).toBe('unknown');
    expect(parseGitAiNote(sha, `f\n  s_x 5-2\n---\n{"schema_version":"authorship/3.0.0","prompts":{}}`, null).problems[0]!.problem).toMatch(/range/);
  });
  it('parses Agent Trace records as object, array or JSON Lines', () => {
    const rec = { version: '0.1.0', id: 'x', timestamp: '2026-01-01T00:00:00Z', vcs: { type: 'git', revision: sha }, tool: { name: 'cursor' }, files: [{ path: 'src/a.ts', conversations: [{ contributor: { type: 'ai', model_id: 'anthropic/x' }, ranges: [{ start_line: 3, end_line: 9 }] }] }] };
    expect(parseAgentTrace(JSON.stringify(rec), 'a').records[0]).toMatchObject({ revision: sha, path: 'src/a.ts', ranges: [{ start: 3, end: 9, type: 'ai', tool: 'cursor' }] });
    expect(parseAgentTrace(JSON.stringify([rec, rec]), 'a').records).toHaveLength(2);
    expect(parseAgentTrace(`${JSON.stringify(rec)}\n${JSON.stringify(rec)}\n`, 'a').records).toHaveLength(2);
    expect(parseAgentTrace('{bad', 'a').problems).toHaveLength(1);
    expect(parseAgentTrace(JSON.stringify({ ...rec, vcs: undefined }), 'a').problems[0]!.problem).toMatch(/no git revision/);
    const bad = parseAgentTrace(JSON.stringify({ ...rec, files: [{ path: 'x', conversations: [{ contributor: { type: 'ai' }, ranges: [{ start_line: 0, end_line: -1 }] }] }] }), 'a');
    expect(bad.problems[0]!.problem).toMatch(/invalid range/);
  });
});

describe('secrets', () => {
  // Built at runtime so no provider-format token appears in this file.
  const aws = 'AKIA' + 'Q7R2S8T4U6V1W3X5';
  const gh = 'gh' + 'p_' + 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8';
  it('finds provider tokens and never returns the raw value', () => {
    const found = findSecrets(`const k = "${aws}";\nconst t = '${gh}';`, 'src/a.ts');
    expect(found.map((f) => f.rule.id).sort()).toEqual(['aws-access-key', 'github-token']);
    for (const f of found) {
      expect(f.preview).not.toContain(aws);
      expect(f.preview).not.toContain(gh);
      expect(f.placeholder).toBe(false);
    }
  });
  it('treats examples, placeholders and test paths as likely test data', () => {
    expect(findSecrets('key = "AKIAIOSFODNN7EXAMPLE"', 'src/a.ts')[0]!.placeholder).toBe(true);
    expect(findSecrets(`const k = "${aws}";`, 'test/fixtures/a.ts')[0]!.placeholder).toBe(true);
    expect(findSecrets('password = "changeme-please-123"', 'src/a.ts')[0]!.placeholder).toBe(true);
  });
  it('skips low-entropy generic matches and localhost URLs', () => {
    expect(findSecrets('password = "aaaaaaaaaaaaaaaa"', 'src/a.ts')).toHaveLength(0);
    expect(findSecrets('DATABASE_URL=postgres://user:password@localhost/db', 'src/a.ts')).toHaveLength(0);
  });
  it('redacts values embedded in free text', () => {
    const r = redactSecrets(`rotate ${aws} now`);
    expect(r).not.toContain(aws);
    expect(r).toContain('AKIA…[redacted]');
  });
  it('is linear-time on adversarial input (no catastrophic backtracking)', () => {
    const evil = 'password = "' + 'a'.repeat(200_000) + '\n' + 'postgres://' + 'x:'.repeat(50_000);
    const t0 = Date.now();
    findSecrets(evil, 'src/evil.ts');
    expect(Date.now() - t0).toBeLessThan(2000);
  });
});

describe('paths, classification, CI helpers', () => {
  it('globs follow gitattributes semantics', () => {
    expect(globToRegExp('src/**').test('src/a/b.ts')).toBe(true);
    expect(globToRegExp('*.min.js').test('deep/dir/x.min.js')).toBe(true);
    expect(globToRegExp('/root.txt').test('sub/root.txt')).toBe(false);
    expect(globToRegExp('src/**/gen/*.ts').test('src/gen/a.ts')).toBe(true);
  });
  it('rejects unsafe relative paths', () => {
    for (const p of ['../x', '/etc/passwd', 'a/../../b', 'C:\\x', 'a\0b', '']) expect(isSafeRelativePath(p)).toBe(false);
    expect(isSafeRelativePath('a/b/c.txt')).toBe(true);
  });
  it('classifies vendored, generated and minified content', () => {
    expect(vendoredRoot('vendor/github.com/x/y/z.go')).toBe('vendor');
    expect(vendoredRoot('a/node_modules/@s/p/i.js')).toBe('a/node_modules');
    expect(vendoredRoot('src/vendor.ts')).toBeNull();
    expect(looksMinified('a.js', 'x'.repeat(5000))).toBe(true);
    expect(parseGitattributes('gen/** linguist-generated\nlib/* linguist-vendored=true').generated[0]!.test('gen/a.ts')).toBe(true);
  });
  it('locates run: blocks in workflow YAML', () => {
    const y = 'steps:\n  - name: a\n    with:\n      x: ${{ github.head_ref }}\n  - run: |\n      echo ${{ github.head_ref }}\n';
    expect(insideRunBlock(y, y.indexOf('${{'))).toBe(false);
    expect(insideRunBlock(y, y.lastIndexOf('${{'))).toBe(true);
  });
  it('edit distance catches near misses', () => {
    expect(editDistance('lodash', 'loadash')).toBe(1);
    expect(editDistance('express', 'exrpess')).toBe(1);
    expect(editDistance('react', 'preact')).toBe(1);
    expect(editDistance('lodash', 'underscore')).toBe(3);
  });
});

describe('declarations', () => {
  it('parses a full declaration file', () => {
    const d = parseDeclarations(
      'company:\n  names: [Acme]\n  domains: [ACME.test]\ndistribution: saas\nai_usage: some\nai_tools:\n  - tool: Claude-Code\n    plan: Enterprise\n    indemnity: true\norigins:\n  - paths: ["src/**"]\n    origin: human\n    declared_on: 2025-01-01\ncontributors:\n  - email: A@acme.test\n    agreement: employee_piia\n    signed_on: 2024-01-01\nsuppressions:\n  - rule: SEC-001\n    fingerprint: fp_x\n    reason: rotated and revoked on 2025-02-01\n',
      'test',
    );
    expect(d.company.domains).toEqual(['acme.test']);
    expect(d.aiTools[0]).toMatchObject({ tool: 'claude-code', plan: 'enterprise', indemnity: true });
    expect(d.contributors?.[0]).toMatchObject({ email: 'a@acme.test', agreement: 'employee_piia' });
    expect(d.digest).toMatch(/^[0-9a-f]{64}$/);
  });
  it('rejects invalid input with a precise message', () => {
    expect(() => parseDeclarations('distribution: everywhere', 't')).toThrow(DeclarationError);
    expect(() => parseDeclarations('origins:\n  - paths: []\n    origin: human', 't')).toThrow(/must not be empty/);
    expect(() => parseDeclarations('suppressions:\n  - rule: X\n    fingerprint: y\n    reason: ok', 't')).toThrow(/explain/);
    expect(() => parseDeclarations('contributors:\n  - agreement: none', 't')).toThrow(/email or a name/);
    expect(() => parseDeclarations('a: [', 't')).toThrow(/YAML/);
    // "Billion laughs": nested aliases must be refused, not expanded.
    const bomb = ['a: &a [x,x,x,x,x,x,x,x,x]', ...'bcdefghi'.split('').map((k, i) => `${k}: &${k} [${Array(9).fill(`*${'abcdefgh'[i]}`).join(',')}]`)].join('\n');
    expect(() => parseDeclarations(bomb, 't')).toThrow(DeclarationError);
  });
  it('parses an IP register CSV with quoting', () => {
    const r = parseRegisterCsv('email,name,agreement,signed_on\n"a@x.test","Doe, Jane",employee_piia,2024-01-02\n\nb@x.test,,none,\n');
    expect(r).toEqual([
      { email: 'a@x.test', name: 'Doe, Jane', agreement: 'employee_piia', signedOn: '2024-01-02' },
      { email: 'b@x.test', agreement: 'none' },
    ]);
  });
});

describe('OSV normalisation', () => {
  it('derives severity from CVSS vectors, database severity and malicious ids', () => {
    expect(normalizeOsv({ id: 'GHSA-1', severity: [{ type: 'CVSS_V3', score: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H' }], affected: [{ ranges: [{ events: [{ introduced: '0' }, { fixed: '1.2.3' }] }] }] })).toMatchObject({ severity: 'critical', cvssScore: 9.8, fixedIn: ['1.2.3'], malicious: false });
    expect(normalizeOsv({ id: 'GHSA-2', database_specific: { severity: 'MODERATE' } }).severity).toBe('medium');
    expect(normalizeOsv({ id: 'MAL-2025-1' }).malicious).toBe(true);
  });
});
