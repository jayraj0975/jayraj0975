import { normalizeTool } from './signals.js';

/** A range of lines (1-based, inclusive) attributed to one contributor. */
export interface AttributedRange {
  start: number;
  end: number;
  type: 'ai' | 'human' | 'mixed' | 'unknown';
  tool: string | null;
  model: string | null;
  /** Session / conversation identifier, if recorded. */
  session: string | null;
}

export interface LineRecord {
  format: 'git-ai' | 'agent-trace';
  /** Commit/revision the ranges refer to. */
  revision: string;
  path: string;
  ranges: AttributedRange[];
  /** Where this record came from (note, file path, upload). */
  origin: string;
  recordedAt: string | null;
  schemaVersion: string;
}

export interface ParseProblem {
  origin: string;
  problem: string;
}

const MAX_RANGES = 200_000;

function parseRangeList(spec: string): Array<[number, number]> | null {
  const out: Array<[number, number]> = [];
  for (const part of spec.split(',')) {
    const p = part.trim();
    if (!p) continue;
    const m = /^(\d{1,9})(?:-(\d{1,9}))?$/.exec(p);
    if (!m) return null;
    const a = Number(m[1]);
    const b = m[2] ? Number(m[2]) : a;
    if (a < 1 || b < a) return null;
    out.push([a, b]);
    if (out.length > MAX_RANGES) return null;
  }
  return out;
}

/**
 * Git AI authorship note (standard `authorship/3.x`): an attestation section of
 * file paths with indented "<key> <ranges>" lines, then `---`, then JSON
 * metadata mapping session keys (s_...) to agents and human keys (h_...) to authors.
 */
export function parseGitAiNote(commit: string, text: string, recordedAt: string | null): { records: LineRecord[]; problems: ParseProblem[] } {
  const origin = `refs/notes/ai:${commit}`;
  const problems: ParseProblem[] = [];
  if (text.length > 16 * 1024 * 1024) return { records: [], problems: [{ origin, problem: 'note exceeds 16 MiB' }] };
  const lines = text.split('\n');
  const divider = lines.findIndex((l) => l.trim() === '---');
  if (divider < 0) return { records: [], problems: [{ origin, problem: 'missing --- divider' }] };
  let meta: Record<string, unknown>;
  try {
    meta = JSON.parse(lines.slice(divider + 1).join('\n')) as Record<string, unknown>;
  } catch {
    return { records: [], problems: [{ origin, problem: 'metadata is not valid JSON' }] };
  }
  const schema = typeof meta.schema_version === 'string' ? meta.schema_version : '';
  if (!/^authorship\/[1-9]/.test(schema)) problems.push({ origin, problem: `unrecognised schema_version "${String(meta.schema_version)}"` });
  const base = typeof meta.base_commit_sha === 'string' ? meta.base_commit_sha : null;
  if (base && base !== commit) problems.push({ origin, problem: `base_commit_sha ${base.slice(0, 12)} does not match the commit the note is attached to` });

  const sessions = (meta.sessions && typeof meta.sessions === 'object' ? meta.sessions : {}) as Record<string, { agent_id?: { tool?: unknown; model?: unknown; id?: unknown } }>;
  const prompts = (meta.prompts && typeof meta.prompts === 'object' ? meta.prompts : {}) as Record<string, { agent_id?: { tool?: unknown; model?: unknown; id?: unknown } }>;
  const humans = (meta.humans && typeof meta.humans === 'object' ? meta.humans : {}) as Record<string, unknown>;

  const byPath = new Map<string, AttributedRange[]>();
  let current: string | null = null;
  for (let i = 0; i < divider; i++) {
    const raw = lines[i]!;
    if (!raw.trim()) continue;
    if (!raw.startsWith(' ')) {
      current = raw.trim().replace(/^"(.*)"$/, '$1');
      if (!byPath.has(current)) byPath.set(current, []);
      continue;
    }
    if (!current) {
      problems.push({ origin, problem: `attestation line ${i + 1} has no file` });
      continue;
    }
    const m = /^\s+(\S+)\s+(\S+)\s*$/.exec(raw);
    if (!m) {
      problems.push({ origin, problem: `malformed attestation line ${i + 1}` });
      continue;
    }
    const key = m[1]!;
    const ranges = parseRangeList(m[2]!);
    if (!ranges) {
      problems.push({ origin, problem: `malformed range on line ${i + 1}` });
      continue;
    }
    let type: AttributedRange['type'] = 'unknown';
    let tool: string | null = null;
    let model: string | null = null;
    let session: string | null = null;
    if (key.startsWith('h_')) {
      type = humans[key] !== undefined ? 'human' : 'unknown';
      if (type === 'unknown') problems.push({ origin, problem: `human key ${key} is not defined` });
    } else {
      const sessionKey = key.split('::')[0]!;
      const rec = sessions[sessionKey] ?? prompts[sessionKey] ?? prompts[key];
      if (rec?.agent_id) {
        type = 'ai';
        tool = typeof rec.agent_id.tool === 'string' ? normalizeTool(rec.agent_id.tool) : null;
        model = typeof rec.agent_id.model === 'string' ? rec.agent_id.model.slice(0, 120) : null;
        session = typeof rec.agent_id.id === 'string' ? rec.agent_id.id.slice(0, 120) : sessionKey;
      } else {
        problems.push({ origin, problem: `session key ${key} is not defined` });
      }
    }
    const list = byPath.get(current)!;
    for (const [start, end] of ranges) list.push({ start, end, type, tool, model, session });
  }
  const records: LineRecord[] = [...byPath.entries()].map(([path, ranges]) => ({
    format: 'git-ai',
    revision: commit,
    path,
    ranges,
    origin,
    recordedAt,
    schemaVersion: schema || 'unknown',
  }));
  return { records, problems };
}

/**
 * Agent Trace record (RFC 0.1.0): { version, id, timestamp, vcs: {type, revision},
 * tool, files: [{ path, conversations: [{ contributor, ranges }] }] }.
 * Accepts a single record, an array, or JSON Lines.
 */
export function parseAgentTrace(text: string, origin: string): { records: LineRecord[]; problems: ParseProblem[] } {
  const problems: ParseProblem[] = [];
  const records: LineRecord[] = [];
  if (text.length > 32 * 1024 * 1024) return { records, problems: [{ origin, problem: 'trace file exceeds 32 MiB' }] };
  let docs: unknown[] = [];
  const trimmed = text.trim();
  try {
    if (trimmed.startsWith('[')) docs = JSON.parse(trimmed) as unknown[];
    else if (trimmed.startsWith('{') && !trimmed.includes('\n{')) docs = [JSON.parse(trimmed)];
    else docs = trimmed.split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l) as unknown);
  } catch {
    return { records, problems: [{ origin, problem: 'not valid JSON or JSON Lines' }] };
  }
  docs.forEach((doc, i) => {
    const where = docs.length > 1 ? `${origin}#${i + 1}` : origin;
    if (!doc || typeof doc !== 'object') {
      problems.push({ origin: where, problem: 'record is not an object' });
      return;
    }
    const d = doc as Record<string, unknown>;
    const version = typeof d.version === 'string' ? d.version : '';
    if (!/^\d+\.\d+/.test(version)) problems.push({ origin: where, problem: 'missing or invalid version' });
    const vcs = d.vcs as { type?: unknown; revision?: unknown } | undefined;
    const revision = vcs && typeof vcs.revision === 'string' ? vcs.revision.trim().toLowerCase() : '';
    if (!revision || (vcs && vcs.type !== undefined && vcs.type !== 'git')) {
      problems.push({ origin: where, problem: 'record has no git revision; lines cannot be tied to code' });
      return;
    }
    const tool = d.tool && typeof d.tool === 'object' && typeof (d.tool as { name?: unknown }).name === 'string' ? normalizeTool((d.tool as { name: string }).name) : null;
    const timestamp = typeof d.timestamp === 'string' ? d.timestamp : null;
    const files = Array.isArray(d.files) ? d.files : [];
    for (const f of files) {
      if (!f || typeof f !== 'object') continue;
      const file = f as { path?: unknown; conversations?: unknown };
      if (typeof file.path !== 'string') {
        problems.push({ origin: where, problem: 'file entry without path' });
        continue;
      }
      const ranges: AttributedRange[] = [];
      for (const conv of Array.isArray(file.conversations) ? file.conversations : []) {
        const c = conv as { contributor?: { type?: unknown; model_id?: unknown }; ranges?: unknown; url?: unknown };
        const baseType = contributorType(c.contributor?.type);
        const baseModel = typeof c.contributor?.model_id === 'string' ? c.contributor.model_id.slice(0, 120) : null;
        for (const r of Array.isArray(c.ranges) ? c.ranges : []) {
          const rr = r as { start_line?: unknown; end_line?: unknown; contributor?: { type?: unknown; model_id?: unknown } };
          const start = Number(rr.start_line);
          const end = Number(rr.end_line);
          if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start) {
            problems.push({ origin: where, problem: `invalid range in ${file.path}` });
            continue;
          }
          const type = rr.contributor ? contributorType(rr.contributor.type) : baseType;
          const model = rr.contributor && typeof rr.contributor.model_id === 'string' ? rr.contributor.model_id.slice(0, 120) : baseModel;
          ranges.push({ start, end, type, tool, model, session: typeof c.url === 'string' ? c.url.slice(0, 200) : null });
          if (ranges.length > MAX_RANGES) break;
        }
      }
      records.push({
        format: 'agent-trace',
        revision,
        path: file.path.replace(/\\/g, '/').replace(/^\.\//, ''),
        ranges,
        origin: where,
        recordedAt: timestamp,
        schemaVersion: version || 'unknown',
      });
    }
  });
  return { records, problems };
}

function contributorType(v: unknown): AttributedRange['type'] {
  return v === 'ai' || v === 'human' || v === 'mixed' ? v : 'unknown';
}
