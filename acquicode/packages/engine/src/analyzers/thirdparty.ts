import type { RepoContext } from '../context.js';
import { copyrightNotices } from '../licenses/identify.js';
import { LineIndex } from '../util/text.js';

const STACK_OVERFLOW = /https?:\/\/(?:[a-z]+\.)?(?:stackoverflow\.com|stackexchange\.com|superuser\.com|serverfault\.com|askubuntu\.com)\/(?:questions|q|a)\/\d+[^\s"'`)>]*/gi;
const COPIED_FROM = /\b(?:copied|taken|borrowed|adapted|ported|lifted|stolen)\s+(?:from|verbatim from)\s*:?\s*(https?:\/\/[^\s"'`)>]+)/gi;

function normHolder(s: string): string {
  return s
    .toLowerCase()
    .replace(/\b(inc|llc|ltd|limited|gmbh|corp|corporation|co|plc|s\.a|b\.v|pty)\b\.?/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Third-party code inside first-party files: other owners' copyright notices,
 * Stack Overflow links (CC BY-SA content) and "copied from" comments.
 */
export function analyzeThirdPartyCode(ctx: RepoContext): void {
  const { evidence, findings } = ctx;
  const companyNames = (ctx.declarations?.company.names ?? []).map(normHolder).filter(Boolean);
  // Without declared names, the holder in the root license file is taken as the company (an inference).
  let inferredCompany: string | null = null;
  if (!companyNames.length) {
    for (const name of ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'COPYING']) {
      const t = ctx.text.get(name);
      const n = t ? copyrightNotices(t, 30)[0] : undefined;
      if (n) {
        inferredCompany = normHolder(n.holder);
        break;
      }
    }
  }
  const owners = companyNames.length ? companyNames : inferredCompany ? [inferredCompany] : [];
  const isOwn = (holder: string) => {
    const h = normHolder(holder);
    if (!h) return true;
    if (/\b(the authors?|contributors?|original author)\b/.test(h) && !owners.length) return false;
    return owners.some((o) => o && (h.includes(o) || o.includes(h)));
  };

  const foreign: Array<{ path: string; holder: string; ev: string }> = [];
  const so: Array<{ path: string; ev: string }> = [];
  const copied: Array<{ path: string; ev: string }> = [];
  for (const f of ctx.files) {
    if (f.classes.includes('vendored') || f.classes.includes('generated')) continue;
    if (!f.classes.includes('source') && !f.classes.includes('test')) continue;
    const text = ctx.text.get(f.path);
    if (!text) continue;

    for (const n of copyrightNotices(text)) {
      if (isOwn(n.holder)) continue;
      const ev = evidence.add({
        kind: 'file.copyright_notice',
        detector: 'thirdparty.copyright@1',
        state: 'OBSERVED',
        locator: { path: f.path, line: n.line },
        extract: `Copyright ${n.years ?? ''} ${n.holder}`.replace(/\s+/g, ' '),
        attributes: { holder: n.holder, companyNames: owners.length ? (companyNames.length ? 'declared' : 'inferred') : 'unknown' },
      });
      foreign.push({ path: f.path, holder: n.holder, ev });
    }

    let idx: LineIndex | null = null;
    STACK_OVERFLOW.lastIndex = 0;
    for (const m of text.matchAll(STACK_OVERFLOW)) {
      idx ??= new LineIndex(text);
      so.push({
        path: f.path,
        ev: evidence.add({ kind: 'file.stackoverflow_reference', detector: 'thirdparty.stackoverflow@1', state: 'OBSERVED', locator: { path: f.path, line: idx.lineOf(m.index ?? 0) }, extract: m[0], attributes: {} }),
      });
      if (so.length > 500) break;
    }
    COPIED_FROM.lastIndex = 0;
    for (const m of text.matchAll(COPIED_FROM)) {
      idx ??= new LineIndex(text);
      copied.push({
        path: f.path,
        ev: evidence.add({ kind: 'file.copied_from', detector: 'thirdparty.copied_from@1', state: 'OBSERVED', locator: { path: f.path, line: idx.lineOf(m.index ?? 0) }, extract: m[0], attributes: {} }),
      });
      if (copied.length > 500) break;
    }
  }

  if (foreign.length) {
    const holders = [...new Set(foreign.map((f) => f.holder))];
    findings.add({
      rule: 'OWN-004',
      state: owners.length ? 'OBSERVED' : 'INFERRED',
      summary: `${foreign.length} copyright notice(s) in first-party source name ${holders.length} other holder(s) (${holders.slice(0, 4).join('; ')})${owners.length ? '' : '; the company name was not declared, so "other" is inferred'}. Files: ${[...new Set(foreign.map((f) => f.path))].slice(0, 4).join(', ')}.`,
      evidence: foreign.slice(0, 80).map((f) => f.ev),
      fingerprint: `holders:${holders.sort().slice(0, 20).join('|')}`,
    });
  }
  if (so.length) {
    findings.add({
      rule: 'OWN-005',
      state: 'OBSERVED',
      summary: `${so.length} reference(s) to Stack Overflow / Stack Exchange posts in ${new Set(so.map((s) => s.path)).size} source file(s) (e.g. ${[...new Set(so.map((s) => s.path))].slice(0, 3).join(', ')}). Code copied from those posts is licensed CC BY-SA.`,
      evidence: so.slice(0, 80).map((s) => s.ev),
      fingerprint: 'stackoverflow',
    });
  }
  if (copied.length) {
    findings.add({
      rule: 'OWN-006',
      state: 'OBSERVED',
      summary: `${copied.length} comment(s) say code was copied or adapted from an external URL (e.g. ${[...new Set(copied.map((c) => c.path))].slice(0, 3).join(', ')}).`,
      evidence: copied.slice(0, 80).map((c) => c.ev),
      fingerprint: 'copied-from',
    });
  }
}
