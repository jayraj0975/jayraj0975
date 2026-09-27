import type { Dossier, Finding } from '../model.js';
import { dossierDigest } from '../analyze.js';
import { sortBy } from '../canonical.js';

export type ChangeKind =
  | 'readiness'
  | 'finding_new'
  | 'finding_resolved'
  | 'question_status'
  | 'dependency_added'
  | 'dependency_removed'
  | 'dependency_changed'
  | 'license_changed'
  | 'advisory_new'
  | 'advisory_resolved'
  | 'ai_evidence'
  | 'ai_tool_new'
  | 'contributor_new'
  | 'repository_moved'
  | 'files';

export interface ChangeEvent {
  kind: ChangeKind;
  severity: 'material' | 'minor' | 'info';
  summary: string;
  refs: string[];
}

export interface DossierDiff {
  from: { digest: string; commits: string[]; readiness: string };
  to: { digest: string; commits: string[]; readiness: string };
  identical: boolean;
  events: ChangeEvent[];
  counts: { material: number; minor: number; info: number };
}

const matOf = (f: Finding): ChangeEvent['severity'] => (f.materiality === 'blocking' || f.materiality === 'material' ? 'material' : f.materiality === 'minor' ? 'minor' : 'info');

/** "What materially changed since the last diligence snapshot?" */
export function diffDossiers(prev: Dossier, next: Dossier): DossierDiff {
  const events: ChangeEvent[] = [];
  const fromDigest = dossierDigest(prev);
  const toDigest = dossierDigest(next);

  if (prev.readiness.level !== next.readiness.level) {
    events.push({ kind: 'readiness', severity: 'material', summary: `Readiness changed from ${prev.readiness.level} to ${next.readiness.level}.`, refs: [] });
  }

  for (const s of next.subjects) {
    const p = prev.subjects.find((x) => x.name === s.name);
    if (p && p.remote && s.remote && p.remote !== s.remote) {
      events.push({ kind: 'repository_moved', severity: 'material', summary: `${s.name} now points to ${s.remote} (was ${p.remote}).`, refs: [] });
    }
  }

  // Findings are matched by fingerprint (stable across snapshots), not by text.
  const activePrev = new Map(prev.findings.filter((f) => !f.suppressed).map((f) => [f.fingerprint, f]));
  const activeNext = new Map(next.findings.filter((f) => !f.suppressed).map((f) => [f.fingerprint, f]));
  for (const [fp, f] of activeNext) {
    if (!activePrev.has(fp)) events.push({ kind: 'finding_new', severity: matOf(f), summary: `New: ${f.title}. ${f.summary}`, refs: [f.id] });
    else {
      const old = activePrev.get(fp)!;
      if (old.materiality !== f.materiality) events.push({ kind: 'finding_new', severity: matOf(f), summary: `${f.title} changed from ${old.materiality} to ${f.materiality}. ${f.summary}`, refs: [f.id] });
    }
  }
  for (const [fp, f] of activePrev) {
    if (!activeNext.has(fp)) events.push({ kind: 'finding_resolved', severity: matOf(f) === 'material' ? 'material' : 'info', summary: `No longer present: ${f.title}.`, refs: [f.id] });
  }

  for (const q of next.questions) {
    const p = prev.questions.find((x) => x.id === q.id);
    if (p && p.status !== q.status) {
      events.push({ kind: 'question_status', severity: q.status === 'BLOCKING' || p.status === 'BLOCKING' || q.status === 'ATTENTION' ? 'material' : 'minor', summary: `${q.question} ${p.status} → ${q.status}.`, refs: [q.id] });
    }
  }

  // Dependencies keyed by repository/component/name.
  const key = (d: Dossier['dependencies'][number]) => `${d.repository ?? ''}|${d.component}|${d.name}`;
  const prevDeps = new Map<string, Dossier['dependencies']>();
  for (const d of prev.dependencies) prevDeps.set(key(d), [...(prevDeps.get(key(d)) ?? []), d]);
  const nextDeps = new Map<string, Dossier['dependencies']>();
  for (const d of next.dependencies) nextDeps.set(key(d), [...(nextDeps.get(key(d)) ?? []), d]);
  const added: string[] = [];
  const removed: string[] = [];
  for (const [k, list] of nextDeps) {
    const old = prevDeps.get(k);
    const d = list[0]!;
    const isProd = d.scope !== 'development';
    if (!old) {
      if (d.direct || isProd) added.push(k);
      if (d.direct) events.push({ kind: 'dependency_added', severity: isProd ? 'minor' : 'info', summary: `Added ${d.direct ? 'direct ' : ''}${isProd ? 'production' : 'development'} dependency ${d.name}${d.version ? `@${d.version}` : ''} (${d.component}).`, refs: d.evidence.slice(0, 1) });
      continue;
    }
    const ov = old.map((x) => x.version ?? '').sort().join(',');
    const nv = list.map((x) => x.version ?? '').sort().join(',');
    if (ov !== nv && d.direct) events.push({ kind: 'dependency_changed', severity: 'info', summary: `${d.name}: ${ov || '?'} → ${nv || '?'}.`, refs: d.evidence.slice(0, 1) });
    const ol = old[0]!.license?.expression ?? null;
    const nl = d.license?.expression ?? null;
    const oc = (old[0]!.license?.categories ?? []).join(',');
    const nc = (d.license?.categories ?? []).join(',');
    if (ol !== nl && nl && ol && oc !== nc) {
      events.push({ kind: 'license_changed', severity: isProd ? 'material' : 'minor', summary: `${d.name} license changed from ${ol} to ${nl}.`, refs: d.license?.evidence.slice(0, 1) ?? [] });
    }
  }
  for (const [k, list] of prevDeps) {
    if (!nextDeps.has(k) && list[0]!.direct) {
      removed.push(k);
      events.push({ kind: 'dependency_removed', severity: 'info', summary: `Removed dependency ${list[0]!.name} (${list[0]!.component}).`, refs: [] });
    }
  }

  const adv = (d: Dossier) => new Map(d.evidence.filter((e) => e.kind === 'advisory.match').map((e) => [e.extract ?? e.id, e]));
  const pa = adv(prev);
  const na = adv(next);
  for (const [k, e] of na) {
    if (!pa.has(k)) {
      const sev = String(e.attributes.severity ?? 'unknown');
      events.push({ kind: 'advisory_new', severity: sev === 'critical' || sev === 'high' || e.attributes.malicious === true ? 'material' : 'minor', summary: `New advisory: ${k} (${sev}).`, refs: [e.id] });
    }
  }
  for (const [k, e] of pa) if (!na.has(k)) events.push({ kind: 'advisory_resolved', severity: 'info', summary: `Advisory no longer applies: ${k}.`, refs: [e.id] });

  // AI evidence: category moves and new tools.
  const pf = new Map(prev.files.map((f) => [`${f.repository ?? ''}|${f.path}`, f]));
  let toDirect = 0;
  let newAiFiles = 0;
  for (const f of next.files) {
    const old = pf.get(`${f.repository ?? ''}|${f.path}`);
    const was = old?.ai?.category ?? 'none';
    const now = f.ai?.category ?? 'none';
    if ((now === 'direct_line' || now === 'direct_commit') && was !== now && was !== 'direct_line') {
      toDirect++;
      if (!old) newAiFiles++;
    }
  }
  if (toDirect) {
    events.push({ kind: 'ai_evidence', severity: toDirect >= 20 ? 'material' : 'minor', summary: `${toDirect} file(s) gained direct AI attribution (${newAiFiles} of them new files). Surviving AI-attributed lines: ${prev.aiDevelopment.lines.aiAttributed ?? 'n/a'} → ${next.aiDevelopment.lines.aiAttributed ?? 'n/a'}.`, refs: [] });
  }
  for (const t of next.aiDevelopment.tools) {
    if (!prev.aiDevelopment.tools.some((x) => x.tool === t.tool)) events.push({ kind: 'ai_tool_new', severity: 'material', summary: `New AI coding tool evidenced: ${t.tool} (${t.signals.join(', ')}).`, refs: [] });
  }

  const prevIds = new Set(prev.ownership.contributors.flatMap((c) => c.identities.map((i) => i.email)));
  for (const c of next.ownership.contributors) {
    if (c.class === 'bot') continue;
    if (!c.identities.some((i) => prevIds.has(i.email))) {
      const external = !['org_domain', 'org_domain_inferred'].includes(c.class);
      events.push({ kind: 'contributor_new', severity: external ? 'material' : 'minor', summary: `New ${c.class === 'ai_agent' ? 'AI agent' : 'contributor'}: ${c.displayName} (${c.class.replace(/_/g, ' ')}, ${c.commits} commits).`, refs: [c.id] });
    }
  }

  const prevHashes = new Map(prev.files.map((f) => [`${f.repository ?? ''}|${f.path}`, f.sha256]));
  let addedF = 0;
  let changedF = 0;
  for (const f of next.files) {
    const h = prevHashes.get(`${f.repository ?? ''}|${f.path}`);
    if (h === undefined) addedF++;
    else if (h !== f.sha256) changedF++;
  }
  const removedF = prev.files.length - (next.files.length - addedF);
  if (addedF || changedF || removedF) events.push({ kind: 'files', severity: 'info', summary: `${addedF} file(s) added, ${changedF} changed, ${Math.max(removedF, 0)} removed.`, refs: [] });

  const order = { material: 0, minor: 1, info: 2 };
  const sorted = sortBy(events, (e) => order[e.severity], (e) => e.kind, (e) => e.summary);
  return {
    from: { digest: fromDigest, commits: prev.subjects.map((s) => s.headCommit ?? s.contentDigest), readiness: prev.readiness.level },
    to: { digest: toDigest, commits: next.subjects.map((s) => s.headCommit ?? s.contentDigest), readiness: next.readiness.level },
    identical: fromDigest === toDigest,
    events: sorted,
    counts: {
      material: sorted.filter((e) => e.severity === 'material').length,
      minor: sorted.filter((e) => e.severity === 'minor').length,
      info: sorted.filter((e) => e.severity === 'info').length,
    },
  };
}
