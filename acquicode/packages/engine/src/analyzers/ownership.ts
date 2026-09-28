import { stableId, sortBy } from '../canonical.js';
import type { RepoContext } from '../context.js';
import type { Contributor, ContributorClass, ProvenanceState } from '../model.js';
import { isAutomationBot, matchAiIdentity } from '../provenance/signals.js';
import { rootImportSize } from './history.js';

const FREEMAIL = /^(gmail\.com|googlemail\.com|outlook\.com|hotmail\.[a-z.]+|live\.[a-z.]+|msn\.com|yahoo\.[a-z.]+|ymail\.com|icloud\.com|me\.com|mac\.com|proton\.me|protonmail\.(com|ch)|pm\.me|aol\.com|gmx\.[a-z.]+|mail\.ru|yandex\.[a-z.]+|qq\.com|163\.com|126\.com|fastmail\.(com|fm)|hey\.com|zoho\.com|tutanota\.(com|de)|duck\.com|web\.de|naver\.com|rediffmail\.com)$/i;
const NOREPLY = /@users\.noreply\.(github\.com|gitlab\.com)$|@noreply\.gitlab\.com$/i;
const LOCAL_ONLY = /@(localhost|local|\(none\)|example\.com|[a-z0-9-]+\.local(domain)?)$/i;

interface Raw {
  name: string;
  email: string;
  commits: Set<string>;
  coAuthored: Set<string>;
  added: number;
  deleted: number;
  first: string;
  last: string;
  files: Set<string>;
}

export interface OwnershipResult {
  contributors: Contributor[];
  registerSupplied: boolean;
  historyCoverage: string;
  metrics: Record<string, number | null>;
}

function normName(n: string): string {
  return n.toLowerCase().replace(/\s+/g, ' ').trim();
}

function domainOf(email: string): string {
  const at = email.lastIndexOf('@');
  return at < 0 ? '' : email.slice(at + 1).toLowerCase();
}

export function analyzeOwnership(ctx: RepoContext): OwnershipResult {
  const { history, evidence, findings, unknowns, declarations } = ctx;
  const registerSupplied = !!declarations?.contributors;

  if (!history) {
    unknowns.add('ownership', 'Who wrote the code and under what agreements', 'The source has no git history, so contributors cannot be identified.', 'Analyse the git repository, or supply a contributor register.');
    return { contributors: [], registerSupplied, historyCoverage: 'none (no git history)', metrics: {} };
  }

  // ---- collect identities (authors and human co-authors)
  const byEmail = new Map<string, Raw>();
  const touch = (name: string, email: string, commit: string, date: string, co: boolean) => {
    const key = (email || `name:${normName(name)}`).toLowerCase();
    let r = byEmail.get(key);
    if (!r) {
      r = { name, email: email.toLowerCase(), commits: new Set(), coAuthored: new Set(), added: 0, deleted: 0, first: date, last: date, files: new Set() };
      byEmail.set(key, r);
    }
    (co ? r.coAuthored : r.commits).add(commit);
    if (date < r.first) r.first = date;
    if (date > r.last) {
      r.last = date;
      r.name = name || r.name;
    }
    return r;
  };
  for (const c of history.commits) {
    const r = touch(c.author.name, c.author.email, c.id, c.author.date, false);
    for (const ch of c.changes) {
      r.added += ch.added ?? 0;
      r.deleted += ch.deleted ?? 0;
      r.files.add(ch.path);
    }
    for (const [k, v] of c.trailers) {
      if (k.toLowerCase() !== 'co-authored-by') continue;
      const m = /^(.*?)\s*<([^>]*)>\s*$/.exec(v);
      if (!m || matchAiIdentity(m[1]!, m[2]!)) continue;
      touch(m[1]!.trim(), m[2]!.trim(), c.id, c.author.date, true);
    }
  }

  // ---- merge identities that share a full name (an inference)
  const clusters: Array<{ members: Raw[]; merged: boolean }> = [];
  const byName = new Map<string, number>();
  for (const r of sortBy([...byEmail.values()], (x) => x.email, (x) => x.name)) {
    const n = normName(r.name);
    const mergeable = n.split(' ').length >= 2 && !/^(root|admin|ubuntu|user|unknown|dev|developer|github|gitlab)$/.test(n);
    const existing = mergeable ? byName.get(n) : undefined;
    if (existing !== undefined) {
      clusters[existing]!.members.push(r);
      clusters[existing]!.merged = true;
    } else {
      if (mergeable) byName.set(n, clusters.length);
      clusters.push({ members: [r], merged: false });
    }
  }

  // ---- organisation domain: declared, else inferred from the dominant non-personal domain
  const declaredDomains = declarations?.company.domains ?? [];
  let inferredDomain: string | null = null;
  if (!declaredDomains.length) {
    const counts = new Map<string, number>();
    let humanCommits = 0;
    for (const r of byEmail.values()) {
      const d = domainOf(r.email);
      if (!d || FREEMAIL.test(d) || NOREPLY.test(r.email) || isAutomationBot(r.name, r.email) || matchAiIdentity(r.name, r.email)) continue;
      counts.set(d, (counts.get(d) ?? 0) + r.commits.size);
    }
    for (const r of byEmail.values()) if (!isAutomationBot(r.name, r.email) && !matchAiIdentity(r.name, r.email)) humanCommits += r.commits.size;
    const top = sortBy([...counts.entries()], (e) => -e[1], (e) => e[0])[0];
    if (top && top[1] / Math.max(humanCommits, 1) >= 0.3) inferredDomain = top[0];
  }

  const classify = (r: Raw): { cls: ContributorClass; state: ProvenanceState } => {
    if (matchAiIdentity(r.name, r.email)) return { cls: 'ai_agent', state: 'OBSERVED' };
    if (isAutomationBot(r.name, r.email)) return { cls: 'bot', state: 'OBSERVED' };
    const d = domainOf(r.email);
    if (!d || LOCAL_ONLY.test(r.email)) return { cls: 'unknown', state: 'OBSERVED' };
    if (NOREPLY.test(r.email)) return { cls: 'forge_noreply', state: 'OBSERVED' };
    if (declaredDomains.some((dd) => d === dd || d.endsWith(`.${dd}`))) return { cls: 'org_domain', state: 'USER_ASSERTED' };
    if (FREEMAIL.test(d)) return { cls: 'personal_email', state: 'OBSERVED' };
    if (inferredDomain && (d === inferredDomain || d.endsWith(`.${inferredDomain}`))) return { cls: 'org_domain_inferred', state: 'INFERRED' };
    return { cls: 'external_domain', state: declaredDomains.length ? 'DERIVED' : 'INFERRED' };
  };
  const rank: Record<ContributorClass, number> = { org_domain: 0, org_domain_inferred: 1, external_domain: 2, personal_email: 3, forge_noreply: 4, unknown: 5, ai_agent: 6, bot: 7 };

  const contributors: Contributor[] = clusters.map(({ members, merged }) => {
    const commits = new Set<string>();
    const files = new Set<string>();
    let added = 0;
    let deleted = 0;
    let first = members[0]!.first;
    let last = members[0]!.last;
    for (const m of members) {
      for (const c of m.commits) commits.add(c);
      for (const c of m.coAuthored) commits.add(c);
      for (const f of m.files) files.add(f);
      added += m.added;
      deleted += m.deleted;
      if (m.first < first) first = m.first;
      if (m.last > last) last = m.last;
    }
    const classes = members.map(classify);
    const best = sortBy(classes, (c) => rank[c.cls])[0]!;
    const display = sortBy(members, (m) => -m.commits.size, (m) => m.email)[0]!.name || members[0]!.email;
    const contributor: Contributor = {
      id: stableId('ctb', members.map((m) => m.email || m.name).sort()),
      displayName: display,
      identities: sortBy(members.map((m) => ({ name: m.name, email: m.email })), (i) => i.email, (i) => i.name),
      class: best.cls,
      classState: best.state,
      commits: commits.size,
      linesAdded: added,
      linesDeleted: deleted,
      firstCommitAt: first,
      lastCommitAt: last,
      filesTouched: files.size,
      mergeState: merged ? 'INFERRED' : 'OBSERVED',
      repositories: [ctx.repoName],
    };
    return contributor;
  });

  // ---- IP register
  const humans = contributors.filter((c) => c.class !== 'bot' && c.class !== 'ai_agent');
  if (declarations?.contributors) {
    const register = declarations.contributors;
    for (const c of humans) {
      const emails = c.identities.map((i) => i.email);
      const names = c.identities.map((i) => normName(i.name));
      let entry = register.find((e) => e.email && emails.includes(e.email));
      let matchedBy: 'email' | 'name' = 'email';
      if (!entry) {
        entry = register.find((e) => e.name && names.includes(normName(e.name)));
        matchedBy = 'name';
      }
      if (entry) {
        c.agreement = { type: entry.agreement, state: matchedBy === 'email' ? 'USER_ASSERTED' : 'INFERRED', matchedBy };
        if (entry.signedOn) c.agreement.signedOn = entry.signedOn;
        if (entry.entity) c.agreement.entity = entry.entity;
      }
    }
    const regEv = evidence.add({ kind: 'declaration.ip_register', detector: 'ownership.register@1', state: 'USER_ASSERTED', locator: { source: declarations.source }, extract: `${register.length} register entries`, attributes: { entries: register.length } });
    const missing = humans.filter((c) => !c.agreement || c.agreement.type === 'none' || c.agreement.type === 'unknown');
    if (missing.length) {
      const commitsMissing = missing.reduce((s, c) => s + c.commits, 0);
      findings.add({
        rule: 'OWN-001',
        state: 'USER_ASSERTED',
        summary: `${missing.length} of ${humans.length} human contributors (${commitsMissing} commits) have no IP agreement in the supplied register: ${sortBy(missing, (c) => -c.commits).slice(0, 8).map((c) => `${c.displayName} <${c.identities[0]?.email ?? ''}> (${c.commits})`).join(', ')}.`,
        evidence: [regEv],
        fingerprint: 'missing-agreements',
      });
    }
    const late = humans.filter((c) => c.agreement?.signedOn && c.firstCommitAt.slice(0, 10) < c.agreement.signedOn && c.agreement.type !== 'none');
    if (late.length) {
      findings.add({
        rule: 'OWN-002',
        state: 'USER_ASSERTED',
        summary: `${late.length} contributor(s) committed before their recorded agreement date: ${late.slice(0, 6).map((c) => `${c.displayName} (first commit ${c.firstCommitAt.slice(0, 10)}, signed ${c.agreement!.signedOn})`).join('; ')}. Confirm the agreements assign prior work.`,
        evidence: [regEv],
        fingerprint: 'late-agreements',
      });
    }
    const byName = humans.filter((c) => c.agreement?.matchedBy === 'name');
    if (byName.length) {
      unknowns.add('ownership', `Whether ${byName.length} register entr${byName.length === 1 ? 'y' : 'ies'} matched by name only refer to the same people`, 'Register entries without the commit email were matched on name, which is an inference.', 'Add the commit email addresses to the register.', false);
    }
  } else {
    const nonOrg = humans.filter((c) => c.class !== 'org_domain' && c.class !== 'org_domain_inferred');
    if (nonOrg.length) {
      findings.add({
        rule: 'OWN-003',
        state: humans.some((c) => c.classState === 'INFERRED') ? 'INFERRED' : 'DERIVED',
        summary: `${nonOrg.length} of ${humans.length} human contributors committed with personal, forge no-reply, external or unidentifiable email addresses (${sortBy(nonOrg, (c) => -c.commits).slice(0, 6).map((c) => `${c.displayName} (${c.class.replace(/_/g, ' ')}, ${c.commits} commits)`).join(', ')}). Buyers usually request IP assignment agreements for every contributor.`,
        evidence: [],
        fingerprint: 'non-org-contributors',
      });
    }
    unknowns.add(
      'ownership',
      `IP assignment status of ${humans.length} human contributor${humans.length === 1 ? '' : 's'}`,
      'Agreements are held outside the repository and no contributor register was supplied.',
      'Supply the IP register (email, agreement type, signing date) via acquicode.yml or upload.',
    );
  }
  if (!declaredDomains.length && inferredDomain) {
    unknowns.add('ownership', `Whether ${inferredDomain} is the company's email domain`, 'Company domains were not declared; the dominant non-personal domain in history was assumed.', 'Declare company.domains in acquicode.yml.', false);
  }

  // ---- history coverage
  let coverage = `${history.commits.length} commits from ${history.commits.at(-1)?.author.date.slice(0, 10) ?? '?'} to ${history.commits[0]?.author.date.slice(0, 10) ?? '?'}`;
  if (history.shallow || history.truncated) {
    coverage += history.shallow ? ' (shallow clone: earlier history missing)' : ` (truncated at ${history.commits.length} of ${history.total})`;
    findings.add({
      rule: 'OWN-009',
      state: 'OBSERVED',
      summary: history.shallow ? 'The repository is a shallow clone; commits before the shallow boundary are missing, so contributor and provenance findings cover only part of the history.' : `Only ${history.commits.length} of ${history.total} commits were analysed (limit reached).`,
      evidence: [],
      fingerprint: history.shallow ? 'shallow' : 'truncated',
    });
    unknowns.add('ownership', 'Contributors and provenance before the analysed history window', history.shallow ? 'Shallow clone.' : 'Commit limit reached.', 'Analyse a full clone (git fetch --unshallow) or raise the commit limit.');
  }
  const root = rootImportSize(history);
  if (root && (root.lines >= 5000 || root.files >= 200)) {
    const ev = evidence.add({ kind: 'commit.bulk_import', detector: 'ownership.bulk_import@1', state: 'OBSERVED', locator: { commit: root.commit.id }, extract: root.commit.subject, attributes: { files: root.files, lines: root.lines } });
    findings.add({
      rule: 'OWN-008',
      state: 'OBSERVED',
      summary: `History begins with commit ${root.commit.id.slice(0, 12)} ("${root.commit.subject.slice(0, 60)}") by ${root.commit.author.name}, adding ${root.lines} lines across ${root.files} files at once. Authorship before ${root.commit.author.date.slice(0, 10)} is not recorded in this repository.`,
      evidence: [ev],
      fingerprint: 'bulk-import',
    });
    unknowns.add('provenance', `Origin of the code imported in the first commit (${root.files} files)`, 'The code arrived in one commit with no earlier history.', 'Provide the prior repository or an explanation of where the code came from.');
  }
  if (history.roots.length > 1) {
    evidence.add({ kind: 'history.multiple_roots', detector: 'ownership.roots@1', state: 'OBSERVED', locator: { commit: history.head }, attributes: { roots: history.roots.length } });
  }

  // ---- submodules
  const subs = ctx.files.filter((f) => f.contentSkipped === 'submodule');
  if (subs.length) {
    findings.add({
      rule: 'OWN-010',
      state: 'OBSERVED',
      summary: `${subs.length} git submodule(s) point to code maintained elsewhere (${subs.slice(0, 4).map((s) => s.path).join(', ')}); their contents, ownership and licenses were not analysed.`,
      evidence: subs.map((s) => evidence.add({ kind: 'repo.submodule', detector: 'ownership.submodule@1', state: 'OBSERVED', locator: { path: s.path }, extract: s.sha256.slice(0, 12), attributes: {} })),
      fingerprint: 'submodules',
    });
    unknowns.add('ownership', `Contents of ${subs.length} submodule(s)`, 'Submodules are separate repositories.', 'Analyse each submodule repository.');
  }

  // ---- concentration (relative to the head commit's date, so the result is reproducible)
  const headDate = history.commits[0]?.committer.date ?? null;
  const metrics: Record<string, number | null> = {
    contributorsHuman: humans.length,
    contributorsOrg: humans.filter((c) => c.class === 'org_domain' || c.class === 'org_domain_inferred').length,
    contributorsNonOrg: humans.filter((c) => c.class !== 'org_domain' && c.class !== 'org_domain_inferred').length,
    contributorsAiAgents: contributors.filter((c) => c.class === 'ai_agent').length,
    contributorsWithAgreement: registerSupplied ? humans.filter((c) => c.agreement && c.agreement.type !== 'none' && c.agreement.type !== 'unknown').length : null,
    commits: history.commits.length,
  };
  if (headDate) {
    const cutoff = new Date(Date.parse(headDate) - 365 * 86_400_000).toISOString();
    const recent = new Map<string, number>();
    const ownerByEmail = new Map<string, string>();
    for (const k of contributors) for (const i of k.identities) ownerByEmail.set(i.email, k.id);
    let recentTotal = 0;
    for (const c of history.commits) {
      if (c.author.date < cutoff) continue;
      if (matchAiIdentity(c.author.name, c.author.email) || isAutomationBot(c.author.name, c.author.email)) continue;
      const owner = ownerByEmail.get(c.author.email.toLowerCase());
      if (!owner) continue;
      recent.set(owner, (recent.get(owner) ?? 0) + 1);
      recentTotal++;
    }
    const shares = sortBy([...recent.entries()], (e) => -e[1], (e) => e[0]);
    let acc = 0;
    let busFactor = 0;
    for (const [, n] of shares) {
      acc += n;
      busFactor++;
      if (acc >= recentTotal / 2) break;
    }
    metrics.commitsLast365d = recentTotal;
    metrics.busFactor = recentTotal ? busFactor : null;
    metrics.topContributorShare = recentTotal ? Math.round((shares[0]![1] / recentTotal) * 1000) / 1000 : null;
    const top = shares[0];
    if (top && recentTotal >= 20 && top[1] / recentTotal > 0.6) {
      const who = contributors.find((c) => c.id === top[0])!;
      findings.add({
        rule: 'MNT-001',
        state: 'DERIVED',
        summary: `${who.displayName} authored ${Math.round((top[1] / recentTotal) * 100)}% of the ${recentTotal} human commits in the 12 months before the analysed commit.`,
        evidence: [],
        fingerprint: 'key-person',
      });
    }
    const asOf = ctx.options.asOf ?? null;
    if (asOf && Date.parse(asOf) - Date.parse(headDate) > 365 * 86_400_000) {
      findings.add({ rule: 'MNT-007', state: 'OBSERVED', summary: `The analysed commit is dated ${headDate.slice(0, 10)}, more than a year before ${asOf.slice(0, 10)}.`, evidence: [], fingerprint: 'stale' });
    }
  }

  return { contributors: sortBy(contributors, (c) => -c.commits, (c) => c.id), registerSupplied, historyCoverage: coverage, metrics };
}
