import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { rmSync } from 'node:fs';
import { buildMeridian, type MeridianBuild } from './fixtures/meridian/build.js';
import { analyze, dossierDigest } from '../src/analyze.js';
import { GitSource } from '../src/source.js';
import { checkInvariants } from '../src/invariants.js';
import { renderDossierHtml } from '../src/dossier/html.js';
import { toCycloneDx } from '../src/dossier/cyclonedx.js';
import { buildStatement, generateSigningKey, signStatement, verifyEnvelope } from '../src/dossier/sign.js';
import { diffDossiers } from '../src/dossier/diff.js';
import type { Dossier } from '../src/model.js';
import { tempDir } from './helpers.js';
import { replayProviders } from '../src/enrich/providers.js';
import type { RegistryProvider, VulnerabilityProvider } from '../src/enrich/types.js';

let build: MeridianBuild;
let dossier: Dossier;

beforeAll(async () => {
  build = buildMeridian(tempDir('meridian-'));
  dossier = await analyze([{ source: await GitSource.open(build.dir) }], { title: 'Meridian Systems' });
});

afterAll(() => rmSync(build.dir, { recursive: true, force: true }));

const rules = (d: Dossier) => new Set(d.findings.filter((f) => !f.suppressed).map((f) => f.rule));
const finding = (d: Dossier, rule: string) => d.findings.filter((f) => f.rule === rule);

describe('Meridian Systems regression fixture', () => {
  it('is BLOCKED for the right reasons and only on observed evidence', () => {
    expect(dossier.readiness.level).toBe('BLOCKED');
    const blocking = dossier.findings.filter((f) => f.materiality === 'blocking' && !f.suppressed);
    expect(blocking.map((f) => f.rule).sort()).toEqual(['LIC-010', 'LIC-010', 'SEC-001', 'SEC-001']);
    for (const f of blocking) expect(f.state).toBe('OBSERVED');
    expect(checkInvariants(dossier)).toEqual([]);
  });

  it('detects every planted issue', () => {
    const expected = [
      'OWN-001', 'OWN-002', 'OWN-004', 'OWN-005', 'OWN-006', 'OWN-007', 'OWN-011',
      'AI-001', 'AI-002', 'AI-003', 'AI-004', 'AI-005', 'AI-006', 'AI-008', 'AI-011', 'AI-012',
      'LIC-010', 'LIC-012', 'LIC-013',
      'SEC-001', 'SEC-002', 'SEC-003', 'SEC-020', 'SEC-021', 'SEC-022', 'SEC-023', 'SEC-024', 'SEC-030', 'SEC-031', 'SEC-033', 'SEC-034',
      'REP-001', 'REP-002', 'REP-004', 'REP-006', 'REP-007', 'REP-008',
      'MNT-002', 'AID-001', 'AID-002', 'EVQ-002',
    ];
    const found = rules(dossier);
    for (const r of expected) expect(found, `missing ${r}`).toContain(r);
  });

  it('separates AI evidence classes and never reports an AI percentage', () => {
    const a = dossier.aiDevelopment;
    expect(a.files.direct_line).toBe(2);
    expect(a.files.direct_commit).toBe(4);
    expect(a.files.inference).toBe(10);
    expect(a.files.direct_line + a.files.direct_commit + a.files.corroborating + a.files.inference + a.files.none).toBe(a.filesConsidered);
    expect(a.lines.aiAttributed).toBe(75);
    expect(a.lines.humanAttributed).toBe(10);
    expect(a.tools.map((t) => t.tool)).toEqual(['aider', 'chatgpt', 'claude-code', 'cursor', 'github-copilot']);
    expect(a.tools.find((t) => t.tool === 'claude-code')?.declared).toMatchObject({ plan: 'enterprise', indemnity: true });
    const text = JSON.stringify(dossier.summary);
    expect(text).not.toMatch(/\d+(\.\d+)?\s?% of (the )?code/i);
    expect(text).toMatch(/not an estimate of how much code AI wrote/);
  });

  it('marks retroactive, forged and contradictory attribution correctly', () => {
    const search = dossier.files.find((f) => f.path === 'src/search/index.ts')!;
    expect(search.ai?.category).toBe('direct_line');
    expect(search.ai?.state).toBe('USER_ASSERTED'); // trace committed months after the revision
    expect(dossier.files.find((f) => f.path === 'src/ai/summarize.ts')!.ai?.state).toBe('CONFLICTING');
    expect(dossier.files.find((f) => f.path === 'src/billing/invoice.ts')!.ai?.state).toBe('CONFLICTING');
    expect(dossier.aiDevelopment.unverifiable).toBe(2);
    for (const r of dossier.files.filter((f) => f.path.startsWith('src/reports/'))) expect(r.ai).toMatchObject({ category: 'inference', state: 'INFERRED' });
    expect(dossier.files.find((f) => f.path === 'src/billing/tax.ts')!.ai).toMatchObject({ category: 'none', state: 'UNKNOWN' });
  });

  it('applies the company suppression but keeps it visible', () => {
    const suppressed = dossier.findings.filter((f) => f.suppressed);
    expect(suppressed).toHaveLength(1);
    expect(suppressed[0]).toMatchObject({ rule: 'SEC-001', materiality: 'minor', suppressed: { state: 'USER_ASSERTED', by: 'security@meridian.io' } });
  });

  it('keeps unknowns unknown when enrichment is off', () => {
    expect(dossier.questions.find((q) => q.id === 'Q-SEC-2')?.status).toBe('UNKNOWN');
    expect(dossier.unknowns.some((u) => /Known vulnerabilities/.test(u.statement))).toBe(true);
    expect(dossier.coverage.enrichment.every((e) => !e.performed)).toBe(true);
  });

  it('never leaks secret values into the dossier or its renderings', () => {
    const aws = 'AKIA' + 'MERIDIANFIXTURE7';
    const stripe = 'sk_' + 'live_' + 'meridian0fixture0key000';
    const gh = 'gh' + 'p_' + 'MeridianHistoricalToken0123456789abc';
    const html = renderDossierHtml(dossier);
    const json = JSON.stringify(dossier);
    for (const s of [aws, stripe, gh, 'Pr0dPassw0rd9']) {
      expect(json).not.toContain(s);
      expect(html).not.toContain(s);
    }
  });

  it('is deterministic: same commits, same analyzer, same digest', async () => {
    const again = await analyze([{ source: await GitSource.open(build.dir) }], { title: 'Meridian Systems' });
    expect(dossierDigest(again)).toBe(dossierDigest(dossier));
    const rebuilt = buildMeridian(tempDir('meridian-b-'));
    try {
      expect(rebuilt.commits).toEqual(build.commits);
      const other = await analyze([{ source: await GitSource.open(rebuilt.dir) }], { title: 'Meridian Systems' });
      // Only the checkout location differs, and it is not part of the dossier.
      expect(dossierDigest(other)).toBe(dossierDigest(dossier));
    } finally {
      rmSync(rebuilt.dir, { recursive: true, force: true });
    }
  });

  it('exports CycloneDX with explicit completeness', () => {
    const bom = toCycloneDx(dossier) as { specVersion: string; components: Array<{ name: string; purl?: string; licenses?: unknown }>; compositions: Array<{ aggregate: string }> };
    expect(bom.specVersion).toBe('1.6');
    expect(bom.components.find((c) => c.name === 'express')?.purl).toBe('pkg:npm/express@4.18.2');
    expect(bom.compositions.map((c) => c.aggregate).sort()).toEqual(['complete', 'incomplete', 'unknown']);
  });

  it('signs and verifies, and detects tampering', () => {
    const key = generateSigningKey();
    const env = signStatement(buildStatement(dossier, { level: 'SELF_ATTESTED', producer: 'test', producedAt: '2026-01-01T00:00:00Z' }), key.privateKey);
    expect(verifyEnvelope(env, [key.publicKey], dossier)).toMatchObject({ signatureValid: true, dossierMatches: true, problems: [] });
    const tampered: Dossier = JSON.parse(JSON.stringify(dossier));
    tampered.readiness.level = 'READY';
    expect(verifyEnvelope(env, [key.publicKey], tampered).dossierMatches).toBe(false);
    const other = generateSigningKey();
    expect(verifyEnvelope(env, [other.publicKey], dossier).signatureValid).toBe(false);
    const forgedPayload = { ...env, payload: Buffer.from(Buffer.from(env.payload, 'base64').toString().replace('SELF_ATTESTED', 'PLATFORM_ATTESTED')).toString('base64') };
    expect(verifyEnvelope(forgedPayload, [key.publicKey], dossier).signatureValid).toBe(false);
  });

  it('reports what changed between snapshots', async () => {
    const earlier = await analyze([{ source: await GitSource.open(build.dir, { ref: build.commits.ml! }) }], { title: 'Meridian Systems' });
    const diff = diffDossiers(earlier, dossier);
    expect(diff.identical).toBe(false);
    const kinds = new Set(diff.events.map((e) => e.kind));
    expect(kinds).toContain('finding_new');
    expect(diff.events.some((e) => e.kind === 'finding_new' && /Credentials in the current code/.test(e.summary))).toBe(true);
    expect(diff.events.some((e) => e.kind === 'contributor_new' || e.kind === 'readiness' || e.kind === 'files')).toBe(true);
    expect(diffDossiers(dossier, dossier).events).toEqual([]);
  });

  it('replays recorded enrichment byte-for-byte', async () => {
    const vulns: VulnerabilityProvider = {
      name: 'fake-osv',
      async query(pkgs) {
        return new Map(pkgs.map((p) => [`${p.ecosystem}:${p.name}@${p.version}`, p.name === 'lodash' ? [{ id: 'GHSA-35jh-r3h4-6jhm', aliases: ['CVE-2021-23337'], summary: 'Command injection', severity: 'high' as const, cvssScore: 7.2, malicious: false, fixedIn: ['4.17.21'], url: 'https://osv.dev/vulnerability/GHSA-35jh-r3h4-6jhm', modified: '2024-01-01T00:00:00Z' }] : []]));
      },
    };
    (vulns as unknown as { queriedAt: string }).queriedAt = '2026-09-01T00:00:00Z';
    const registry: RegistryProvider = {
      name: 'fake-registry',
      async lookup(pkgs) {
        return new Map(pkgs.map((p) => [`${p.ecosystem}:${p.name}`, { exists: true, license: p.name === 'loadash' ? 'MIT' : null, latestVersion: '1.0.0', lastPublishedAt: '2019-01-01T00:00:00Z', maintainers: 1, deprecated: null }]));
      },
    };
    (registry as unknown as { queriedAt: string }).queriedAt = '2026-09-01T00:00:00Z';
    const enriched = await analyze([{ source: await GitSource.open(build.dir) }], { title: 'Meridian Systems', enrichment: { vulnerabilities: vulns, registry } });
    expect(rules(enriched)).toContain('SEC-010');
    expect(rules(enriched)).toContain('MNT-004');
    expect(enriched.questions.find((q) => q.id === 'Q-SEC-2')?.status).toBe('ATTENTION');
    expect(enriched.dependencies.find((d) => d.name === 'loadash')?.license).toMatchObject({ expression: 'MIT', source: 'registry', certainty: 'KNOWN' });
    // Internal packages are never sent to public services.
    expect(Object.keys(enriched.enrichment.vulnerabilities!.results).some((k) => k.includes('meridian-'))).toBe(false);
    const replayed = await analyze([{ source: await GitSource.open(build.dir) }], { title: 'Meridian Systems', enrichment: replayProviders(enriched.enrichment) });
    expect(dossierDigest(replayed)).toBe(dossierDigest(enriched));
  });

  it('renders a self-contained, escaped HTML document', () => {
    const html = renderDossierHtml(dossier, { banner: 'Demo data' });
    expect(html).toMatch(/^<!doctype html>/);
    expect(html).toContain("Content-Security-Policy");
    expect(html).not.toMatch(/<script/i);
    for (const section of ['Executive Summary', 'Repository Inventory', 'Software Ownership Evidence', 'AI Development Evidence', 'Dependency &amp; License Analysis', 'Security Exposure', 'Build &amp; Reproducibility', 'Maintainability', 'Material Unknowns', 'Questions for Management', 'Questions for Counsel', 'Questions for Engineering', 'Evidence Index', 'Signed Manifest']) {
      expect(html).toContain(section);
    }
    // The readiness level always travels with what it does not mean.
    expect(html).toContain('not whether the software is good, secure or free of legal risk');
  });
});
