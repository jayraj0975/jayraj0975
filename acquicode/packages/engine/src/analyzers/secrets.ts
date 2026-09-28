import type { RepoContext } from '../context.js';
import type { Materiality, ProvenanceState } from '../model.js';
import { sha256Hex } from '../canonical.js';
import { catFileBatch } from '../git/run.js';
import { LineIndex, looksBinary, shannonEntropy } from '../util/text.js';
import { basename } from '../util/paths.js';
import { isTestPath } from './classify.js';

interface SecretRule {
  id: string;
  name: string;
  re: RegExp;
  /** Capture group holding the secret value. */
  group: number;
  /** Provider-format tokens are OBSERVED; contextual/entropy matches are INFERRED. */
  confidence: 'provider' | 'contextual';
  minEntropy?: number;
}

/** Patterns avoid nested quantifiers so adversarial files cannot cause catastrophic backtracking. */
export const SECRET_RULES: SecretRule[] = [
  { id: 'aws-access-key', name: 'AWS access key ID', re: /\b((?:AKIA|ASIA|ABIA|ACCA)[0-9A-Z]{16})\b/g, group: 1, confidence: 'provider' },
  { id: 'aws-secret-key', name: 'AWS secret access key', re: /aws_?secret_?(?:access_?)?key["']?\s*[:=]\s*["']([A-Za-z0-9/+=]{40})["']/gi, group: 1, confidence: 'provider' },
  { id: 'github-token', name: 'GitHub token', re: /\b(gh[pousr]_[A-Za-z0-9]{36,255})\b/g, group: 1, confidence: 'provider' },
  { id: 'github-pat', name: 'GitHub fine-grained token', re: /\b(github_pat_[A-Za-z0-9_]{50,255})\b/g, group: 1, confidence: 'provider' },
  { id: 'gitlab-token', name: 'GitLab token', re: /\b(glpat-[A-Za-z0-9_-]{20,64})\b/g, group: 1, confidence: 'provider' },
  { id: 'slack-token', name: 'Slack token', re: /\b(xox[abposr]-[A-Za-z0-9-]{10,200})\b/g, group: 1, confidence: 'provider' },
  { id: 'slack-webhook', name: 'Slack webhook URL', re: /(https:\/\/hooks\.slack\.com\/services\/T[A-Z0-9]{6,12}\/B[A-Z0-9]{6,12}\/[A-Za-z0-9]{20,32})/g, group: 1, confidence: 'provider' },
  { id: 'stripe-live-key', name: 'Stripe live key', re: /\b((?:sk|rk)_live_[A-Za-z0-9]{20,120})\b/g, group: 1, confidence: 'provider' },
  { id: 'google-api-key', name: 'Google API key', re: /\b(AIza[0-9A-Za-z_-]{35})\b/g, group: 1, confidence: 'provider' },
  { id: 'private-key', name: 'Private key', re: /(-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY(?: BLOCK)?-----)/g, group: 1, confidence: 'provider' },
  { id: 'openai-key', name: 'OpenAI API key', re: /\b(sk-(?:proj|svcacct|admin)-[A-Za-z0-9_-]{40,200})\b/g, group: 1, confidence: 'provider' },
  { id: 'openai-key-legacy', name: 'OpenAI API key', re: /\b(sk-[A-Za-z0-9]{20}T3BlbkFJ[A-Za-z0-9]{20})\b/g, group: 1, confidence: 'provider' },
  { id: 'anthropic-key', name: 'Anthropic API key', re: /\b(sk-ant-(?:api|admin)\d{2}-[A-Za-z0-9_-]{80,120})\b/g, group: 1, confidence: 'provider' },
  { id: 'sendgrid-key', name: 'SendGrid API key', re: /\b(SG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43})\b/g, group: 1, confidence: 'provider' },
  { id: 'npm-token', name: 'npm access token', re: /\b(npm_[A-Za-z0-9]{36})\b/g, group: 1, confidence: 'provider' },
  { id: 'pypi-token', name: 'PyPI upload token', re: /\b(pypi-AgEIcHlwaS5vcmc[A-Za-z0-9_-]{50,300})\b/g, group: 1, confidence: 'provider' },
  { id: 'database-url', name: 'Database URL with password', re: /\b((?:postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?|redis|rediss|amqps?):\/\/[^\s:@/'"`]{1,64}:([^\s@/'"`]{3,128})@[^\s/'"`]{1,255})/g, group: 2, confidence: 'contextual' },
  { id: 'generic-secret', name: 'Hard-coded credential', re: /\b(?:password|passwd|pwd|secret|api[_-]?key|apikey|access[_-]?token|auth[_-]?token|client[_-]?secret)["']?\s*[:=]\s*["']([^"'\s]{12,200})["']/gi, group: 1, confidence: 'contextual', minEntropy: 3.5 },
];

const PLACEHOLDER = /(example|sample|dummy|placeholder|changeme|change_me|your[-_]|<[^>]*>|\$\{|\{\{|xxxx|\*\*\*\*|test|fake|redacted|foobar|lorem|not-a-real|todo)/i;
const KNOWN_EXAMPLES = new Set(['AKIAIOSFODNN7EXAMPLE', 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY']);

/** Mask provider-format secret values in free text (commit subjects, extracts, summaries). */
export function redactSecrets(text: string): string {
  let out = text;
  for (const rule of SECRET_RULES) {
    if (rule.confidence !== 'provider' || rule.id === 'private-key') continue;
    rule.re.lastIndex = 0;
    out = out.replace(rule.re, (match: string, ...groups: unknown[]) => {
      const value = groups[rule.group - 1];
      if (typeof value !== 'string' || !value) return match;
      return match.replace(value, `${value.slice(0, 4)}…[redacted]`);
    });
  }
  return out;
}

export interface SecretMatch {
  rule: SecretRule;
  fingerprint: string;
  preview: string;
  line: number;
  placeholder: boolean;
}

export function findSecrets(text: string, path: string): SecretMatch[] {
  const out: SecretMatch[] = [];
  let idx: LineIndex | null = null;
  for (const rule of SECRET_RULES) {
    rule.re.lastIndex = 0;
    let count = 0;
    for (const m of text.matchAll(rule.re)) {
      if (++count > 200) break;
      const value = m[rule.group];
      if (!value) continue;
      if (rule.minEntropy && shannonEntropy(value) < rule.minEntropy) continue;
      if (rule.id === 'database-url' && /^(password|pass|secret|postgres|root|user|admin|\$\{?\w*\}?)$/i.test(value)) continue;
      idx ??= new LineIndex(text);
      const placeholder = KNOWN_EXAMPLES.has(value) || PLACEHOLDER.test(value) || (rule.confidence === 'contextual' && /localhost|127\.0\.0\.1/.test(m[0]));
      out.push({
        rule,
        fingerprint: sha256Hex(`${rule.id}:${value}`).slice(0, 16),
        preview: rule.id === 'private-key' ? value : `${value.slice(0, 4)}… (${value.length} chars)`,
        line: idx.lineOf(m.index ?? 0),
        placeholder: placeholder || isTestPath(path) || /(^|\/)(examples?|samples?|docs?)\//i.test(path),
      });
    }
  }
  return out;
}

function classify(m: SecretMatch): { state: ProvenanceState; materiality: Materiality } {
  if (m.placeholder) return { state: 'INFERRED', materiality: 'minor' };
  if (m.rule.confidence === 'provider') return { state: 'OBSERVED', materiality: 'blocking' };
  return { state: 'INFERRED', materiality: 'material' };
}

const ENV_FILE = /^\.env(\.[A-Za-z0-9_-]+)?$/;
const ENV_TEMPLATE = /\.(example|sample|template|dist|defaults?)$/i;

export async function analyzeSecrets(ctx: RepoContext): Promise<{ headMatches: number; historyOnly: number; blobsScanned: number; truncated: boolean; performed: boolean }> {
  const { evidence, findings } = ctx;
  const headFingerprints = new Set<string>();
  let headMatches = 0;

  for (const f of ctx.files) {
    const text = ctx.text.get(f.path);
    if (text === undefined) continue;
    const matches = findSecrets(text, f.path);
    for (const m of matches) {
      headFingerprints.add(m.fingerprint);
      headMatches++;
      const { state, materiality } = classify(m);
      const ev = evidence.add({
        kind: 'secret.match',
        detector: `secrets.${m.rule.id}@1`,
        state,
        locator: { path: f.path, line: m.line },
        extract: `${m.rule.name}: ${m.preview}`,
        attributes: { fingerprint: m.fingerprint, rule: m.rule.id, likelyTestData: m.placeholder },
      });
      findings.add({
        rule: 'SEC-001',
        state,
        materiality,
        title: m.placeholder ? 'Credential-like value in test or example code' : undefined,
        summary: `${m.rule.name} in ${f.path} line ${m.line}${m.placeholder ? ' (test, example or placeholder value; confirm it is not live)' : ''}. The value is not reproduced here; fingerprint ${m.fingerprint}.`,
        evidence: [ev],
        fingerprint: `${m.rule.id}:${m.fingerprint}`,
      });
    }
    const b = basename(f.path);
    if (ENV_FILE.test(b) && !ENV_TEMPLATE.test(b)) {
      const ev = evidence.add({ kind: 'file.env', detector: 'secrets.env_file@1', state: 'OBSERVED', locator: { path: f.path }, attributes: { size: f.size } });
      findings.add({ rule: 'SEC-003', state: 'OBSERVED', summary: `Environment file ${f.path} is committed.`, evidence: [ev], fingerprint: f.path });
    }
  }

  const want = ctx.options.scanHistoryForSecrets ?? true;
  const git = ctx.source.git;
  const commit = ctx.source.commit;
  if (!want || !git || !commit) return { headMatches, historyOnly: 0, blobsScanned: 0, truncated: false, performed: false };

  const headBlobs = new Set(ctx.files.map((f) => f.blob).filter((b): b is string => !!b));
  const { blobs, truncated } = await git.historyBlobs(commit, ctx.limits.maxHistoryBlobs);
  const candidates = blobs.filter((b) => !headBlobs.has(b.id));
  const pathOf = new Map(candidates.map((b) => [b.id, b.path]));
  let scanned = 0;
  let historyOnly = 0;
  const reported = new Set<string>();
  await catFileBatch(
    git.dir,
    candidates.map((b) => b.id),
    (obj, content) => {
      if (!content || looksBinary(content)) return;
      scanned++;
      const path = pathOf.get(obj.id) ?? '';
      for (const m of findSecrets(content.toString('utf8'), path)) {
        if (headFingerprints.has(m.fingerprint) || reported.has(m.fingerprint)) continue;
        reported.add(m.fingerprint);
        historyOnly++;
        const { state } = classify(m);
        const ev = evidence.add({
          kind: 'secret.history_match',
          detector: `secrets.${m.rule.id}@1`,
          state,
          locator: { path, source: `blob:${obj.id}` },
          extract: `${m.rule.name}: ${m.preview}`,
          attributes: { fingerprint: m.fingerprint, rule: m.rule.id, likelyTestData: m.placeholder },
        });
        findings.add({
          rule: 'SEC-002',
          state,
          materiality: m.placeholder ? 'minor' : 'material',
          summary: `${m.rule.name} existed in an earlier version of ${path} and is no longer in the current code. It remains retrievable from history; confirm it was rotated. Fingerprint ${m.fingerprint}.`,
          evidence: [ev],
          fingerprint: `${m.rule.id}:${m.fingerprint}`,
        });
      }
    },
    { keep: (_id, size) => size <= ctx.limits.maxHistoryBlobBytes, hash: false },
  );
  return { headMatches, historyOnly, blobsScanned: scanned, truncated, performed: true };
}
