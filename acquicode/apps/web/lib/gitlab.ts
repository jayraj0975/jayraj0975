import { isIP } from 'node:net';
import { HttpError } from './errors';
import { getPublicJson, isInternalName, isPublicAddress } from './net';

/**
 * GitLab projects are connected with a project access token (read_repository,
 * read_api). The token is encrypted at rest and only decrypted by the worker
 * for the duration of a clone.
 */
export interface GitlabProject {
  host: string;
  path: string;
  cloneUrl: string;
  defaultBranch: string | null;
  id: number;
}

export function parseGitlabUrl(input: string): { host: string; hostname: string; port: number; path: string } {
  let u: URL;
  try {
    u = new URL(input.trim());
  } catch {
    throw new HttpError(400, 'Enter the project URL, e.g. https://gitlab.com/group/project');
  }
  if (u.protocol !== 'https:') throw new HttpError(400, 'GitLab URL must use https');
  if (u.username || u.password) throw new HttpError(400, 'Do not put credentials in the URL');
  if (isPrivateHost(u.hostname)) throw new HttpError(400, 'That host is not allowed');
  const path = u.pathname.replace(/\/-\/.*$/, '').replace(/^\/+|\/+$/g, '').replace(/\.git$/, '');
  if (!PROJECT_PATH.test(path)) throw new HttpError(400, 'Unrecognised GitLab project path');
  return { host: u.host, hostname: u.hostname, port: u.port ? Number(u.port) : 443, path };
}

const PROJECT_PATH = /^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)+$/;

/** Literal names and addresses that are never allowed. Resolution-time checks live in lib/net.ts. */
export function isPrivateHost(host: string): boolean {
  const bare = host.replace(/^\[|\]$/g, '');
  if (isIP(bare)) return !isPublicAddress(bare);
  return isInternalName(bare);
}

export async function fetchGitlabProject(url: string, token: string): Promise<GitlabProject> {
  const { host, path } = parseGitlabUrl(url);
  const res = await getPublicJson(`https://${host}/api/v4/projects/${encodeURIComponent(path)}`, { 'private-token': token, 'user-agent': 'acquicode', accept: 'application/json' });
  if (res.status === 401 || res.status === 403) throw new HttpError(400, 'GitLab rejected the token (needs read_repository and read_api)');
  if (res.status === 404) throw new HttpError(400, 'GitLab project not found or not visible to this token');
  if (res.status < 200 || res.status >= 300) throw new HttpError(502, `GitLab returned ${res.status}`);
  const p = res.body as { id?: unknown; path_with_namespace?: unknown; default_branch?: unknown } | null;
  if (!p || typeof p.id !== 'number' || typeof p.path_with_namespace !== 'string' || !PROJECT_PATH.test(p.path_with_namespace)) throw new HttpError(502, 'Unexpected response from GitLab');
  // The clone URL is built from the host the customer entered, never taken from the response:
  // a hostile server could otherwise point the clone (and the token) somewhere else.
  return { host, path: p.path_with_namespace, cloneUrl: `https://${host}/${p.path_with_namespace}.git`, defaultBranch: typeof p.default_branch === 'string' ? p.default_branch : null, id: p.id };
}
