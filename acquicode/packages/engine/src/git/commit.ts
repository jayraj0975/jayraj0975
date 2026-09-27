export interface Person {
  name: string;
  email: string;
  /** ISO-8601 with the original UTC offset. */
  date: string;
}

export interface RawCommit {
  id: string;
  tree: string;
  parents: string[];
  author: Person;
  committer: Person;
  signed: boolean;
  message: string;
  subject: string;
  body: string;
  trailers: Array<[string, string]>;
}

const PERSON = /^(.*?)\s*<([^>]*)>\s+(-?\d+)\s+([+-]\d{4})$/;

export function parsePerson(value: string): Person {
  const m = PERSON.exec(value.trim());
  if (!m) return { name: value.trim(), email: '', date: '1970-01-01T00:00:00Z' };
  const seconds = Number(m[3]);
  const tz = m[4]!;
  return { name: m[1]!.trim(), email: m[2]!.trim(), date: isoWithOffset(seconds, tz) };
}

function isoWithOffset(epochSeconds: number, tz: string): string {
  const sign = tz.startsWith('-') ? -1 : 1;
  const hours = Number(tz.slice(1, 3));
  const minutes = Number(tz.slice(3, 5));
  const offsetMs = sign * (hours * 60 + minutes) * 60_000;
  if (!Number.isFinite(epochSeconds) || Math.abs(epochSeconds) > 1e12) return '1970-01-01T00:00:00Z';
  const local = new Date(epochSeconds * 1000 + offsetMs);
  const iso = local.toISOString().replace(/\.\d{3}Z$/, '');
  if (hours === 0 && minutes === 0) return `${iso}Z`;
  return `${iso}${tz.slice(0, 3)}:${tz.slice(3, 5)}`;
}

/** Parse a raw commit object as returned by `git cat-file commit`. */
export function parseRawCommit(id: string, content: Buffer): RawCommit {
  const text = content.toString('utf8');
  const sep = text.indexOf('\n\n');
  const headerText = sep >= 0 ? text.slice(0, sep) : text;
  const message = sep >= 0 ? text.slice(sep + 2) : '';
  let tree = '';
  const parents: string[] = [];
  let author: Person = { name: '', email: '', date: '1970-01-01T00:00:00Z' };
  let committer: Person = author;
  let signed = false;
  for (const line of headerText.split('\n')) {
    if (line.startsWith(' ')) continue; // continuation of a multi-line header (gpgsig, mergetag)
    const sp = line.indexOf(' ');
    const key = sp < 0 ? line : line.slice(0, sp);
    const value = sp < 0 ? '' : line.slice(sp + 1);
    switch (key) {
      case 'tree':
        tree = value.trim();
        break;
      case 'parent':
        parents.push(value.trim());
        break;
      case 'author':
        author = parsePerson(value);
        break;
      case 'committer':
        committer = parsePerson(value);
        break;
      case 'gpgsig':
      case 'gpgsig-sha256':
        signed = true;
        break;
      default:
        break;
    }
  }
  const trimmed = message.replace(/\s+$/, '');
  const nl = trimmed.indexOf('\n');
  const subject = (nl < 0 ? trimmed : trimmed.slice(0, nl)).trim();
  const body = nl < 0 ? '' : trimmed.slice(nl + 1).trim();
  return { id, tree, parents, author, committer, signed, message: trimmed, subject, body, trailers: parseTrailers(trimmed) };
}

const TRAILER_LINE = /^([A-Za-z0-9][A-Za-z0-9-]{0,63}):[ \t]*(.*)$/;

/**
 * Trailers are "Key: value" lines in the final paragraph of a message. Like
 * `git interpret-trailers`, a paragraph counts as a trailer block when at least
 * one line is a recognised trailer and at least 25% of its lines are trailers;
 * the first line of the message is never a trailer.
 */
export function parseTrailers(message: string): Array<[string, string]> {
  const paragraphs = message.split(/\n[ \t]*\n/);
  if (paragraphs.length < 2) return [];
  const last = paragraphs[paragraphs.length - 1]!.split('\n');
  const found: Array<[string, string]> = [];
  let trailerLines = 0;
  for (const raw of last) {
    const line = raw.replace(/\r$/, '');
    if (/^[ \t]/.test(line) && found.length) {
      const prev = found[found.length - 1]!;
      prev[1] = `${prev[1]} ${line.trim()}`.trim();
      continue;
    }
    const m = TRAILER_LINE.exec(line);
    if (m) {
      found.push([m[1]!, m[2]!.trim()]);
      trailerLines++;
    }
  }
  const nonEmpty = last.filter((l) => l.trim()).length;
  if (trailerLines === 0 || trailerLines * 4 < nonEmpty) return [];
  return found;
}

/**
 * Pull/merge request reference from typical merge or squash-merge messages:
 * GitHub "Merge pull request #12 from ...", squash "Title (#12)", GitLab
 * "See merge request group/project!12".
 */
export function pullRequestFromMessage(subject: string, body: string): number | null {
  const merge = /^Merge pull request #(\d+) from /.exec(subject);
  if (merge) return Number(merge[1]);
  const squash = /\(#(\d+)\)\s*$/.exec(subject);
  if (squash) return Number(squash[1]);
  const gitlab = /See merge request [^\s!]+!(\d+)/.exec(body);
  if (gitlab) return Number(gitlab[1]);
  return null;
}
