import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { config, stripeConfigured } from './config';
import { appReady, githubCreds, loginReady } from './github-config';

/**
 * Public facts about this deployment: who operates it, how to reach them, and
 * which third parties it actually uses. Everything is derived from
 * configuration, so the website never shows an address or a subprocessor that
 * does not exist for this deployment.
 */
export interface Site {
  url: string;
  host: string;
  operator: string;
  operatorNamed: boolean;
  supportEmail: string | null;
  securityEmail: string | null;
}

export function site(): Site {
  const c = config();
  const u = new URL(c.APP_URL);
  // Contact addresses come only from configuration: a derived support@<host> may not exist
  // (and never does on a hosting provider's shared domain).
  return {
    url: u.origin,
    host: u.hostname,
    operator: c.LEGAL_ENTITY ?? 'the operator of this AcquiCode deployment',
    operatorNamed: !!c.LEGAL_ENTITY,
    supportEmail: c.CONTACT_EMAIL ?? null,
    securityEmail: c.SECURITY_EMAIL ?? c.CONTACT_EMAIL ?? null,
  };
}

export interface Subprocessor {
  name: string;
  purpose: string;
  data: string;
  when: string;
}

/** Third parties that receive data from this deployment, given its configuration. */
export async function subprocessors(): Promise<Subprocessor[]> {
  const c = config();
  const list: Subprocessor[] = [];
  if (c.HOSTING_PROVIDER) {
    list.push({ name: c.HOSTING_PROVIDER, purpose: 'Hosting the application, database and storage', data: 'All service data, encrypted at rest by the application', when: 'Always' });
  }
  const gh = await githubCreds().catch(() => null);
  if (!gh || loginReady(gh) || appReady(gh)) {
    list.push({ name: 'GitHub, Inc.', purpose: 'Sign-in; reading repositories you connect through the GitHub App', data: 'Your GitHub identity; repository contents fetched with short-lived read-only tokens', when: 'Always, when GitHub is used' });
  }
  list.push({ name: 'GitLab (gitlab.com or your self-managed instance)', purpose: 'Reading GitLab projects you connect', data: 'Repository contents fetched with your project access token', when: 'Only for GitLab projects you connect' });
  if (c.STORAGE_DRIVER === 's3') {
    const where = c.S3_ENDPOINT ? new URL(c.S3_ENDPOINT).hostname : `Amazon S3 (${c.S3_REGION})`;
    list.push({ name: where, purpose: 'Storing dossiers and pending uploads', data: 'Encrypted objects only; keys never leave the application', when: 'Always' });
  }
  if (stripeConfigured()) {
    list.push({ name: 'Stripe, Inc.', purpose: 'Payments', data: 'Organisation id, plan and billing details you enter at checkout; card data goes to Stripe directly', when: 'When you buy a plan' });
  }
  list.push({ name: 'OSV.dev (Google)', purpose: 'Known-vulnerability lookup', data: 'Names and versions of public open-source packages only; never private packages or code', when: 'Only if dependency checks are enabled for your organisation' });
  list.push({ name: 'npm registry and PyPI', purpose: 'License and release-date lookup', data: 'Names of public open-source packages only', when: 'Only if dependency checks are enabled for your organisation' });
  return list;
}

/** SHA-256 of the CLI bundle this deployment serves at /cli/acquicode.mjs, or null when the build did not include it. */
export async function cliChecksum(): Promise<string | null> {
  try {
    const sum = (await readFile(join(process.cwd(), 'public/cli/acquicode.mjs.sha256'), 'utf8')).split(/\s+/)[0] ?? '';
    return /^[0-9a-f]{64}$/.test(sum) ? sum : null;
  } catch {
    return null;
  }
}
