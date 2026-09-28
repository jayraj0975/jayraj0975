import { z } from 'zod';
import { config } from './config';
import { decrypt, encrypt } from './crypto';
import { q, q1 } from './db';

/**
 * Where the GitHub App credentials come from. Environment variables win when any
 * is set (the documented, infrastructure-as-code path). Otherwise the credentials
 * created through /setup from a GitHub App manifest are read from
 * platform_secrets, decrypted, and cached briefly in each process.
 */
export interface GithubCreds {
  source: 'env' | 'setup' | 'none';
  appId: string | null;
  slug: string | null;
  privateKey: string | null;
  clientId: string | null;
  clientSecret: string | null;
  webhookSecret: string | null;
  owner: string | null;
}

const NAME = 'github_app';
const AAD = `platform:${NAME}`;
const NONE: GithubCreds = { source: 'none', appId: null, slug: null, privateKey: null, clientId: null, clientSecret: null, webhookSecret: null, owner: null };

/** What GitHub returns from POST /app-manifests/{code}/conversions (the fields AcquiCode keeps). */
export const manifestConversion = z.object({
  id: z.number().int().positive(),
  slug: z.string().regex(/^[a-z0-9][a-z0-9-]{0,99}$/),
  owner: z.object({ login: z.string().min(1).max(100) }).nullable().optional(),
  client_id: z.string().min(1).max(200),
  client_secret: z.string().min(1).max(500),
  webhook_secret: z.string().min(1).max(500).nullable(),
  pem: z.string().includes('PRIVATE KEY'),
});
export type ManifestConversion = z.infer<typeof manifestConversion>;

let cache: { at: number; creds: GithubCreds } | null = null;

function unescapePem(v: string | undefined): string | null {
  if (!v) return null;
  return v.includes('\\n') ? v.replace(/\\n/g, '\n') : v;
}

function fromEnv(): GithubCreds | null {
  const c = config();
  if (!c.GITHUB_APP_ID && !c.GITHUB_CLIENT_ID && !c.GITHUB_WEBHOOK_SECRET && !c.GITHUB_APP_PRIVATE_KEY) return null;
  return {
    source: 'env',
    appId: c.GITHUB_APP_ID ?? null,
    slug: c.GITHUB_APP_SLUG ?? null,
    privateKey: unescapePem(c.GITHUB_APP_PRIVATE_KEY),
    clientId: c.GITHUB_CLIENT_ID ?? null,
    clientSecret: c.GITHUB_CLIENT_SECRET ?? null,
    webhookSecret: c.GITHUB_WEBHOOK_SECRET ?? null,
    owner: null,
  };
}

export async function githubCreds(): Promise<GithubCreds> {
  const env = fromEnv();
  if (env) return env;
  // A stored App is stable: cache it for a minute. "Not set up yet" is never cached, so every
  // process (and every bundle of this module) sees an App the moment /setup stores it.
  if (cache && Date.now() - cache.at < 60_000) return cache.creds;
  const row = await q1<{ value_enc: string }>('SELECT value_enc FROM platform_secrets WHERE name = $1', [NAME]);
  let creds = NONE;
  if (row) {
    const v = manifestConversion.parse(JSON.parse(decrypt(row.value_enc, AAD).toString('utf8')));
    creds = {
      source: 'setup',
      appId: String(v.id),
      slug: v.slug,
      privateKey: v.pem,
      clientId: v.client_id,
      clientSecret: v.client_secret,
      webhookSecret: v.webhook_secret,
      owner: v.owner?.login ?? null,
    };
  }
  if (creds.source !== 'none') cache = { at: Date.now(), creds };
  return creds;
}

export function resetGithubCreds(): void {
  cache = null;
}

export function appReady(c: GithubCreds): boolean {
  return !!(c.appId && c.privateKey && c.slug);
}

export function loginReady(c: GithubCreds): boolean {
  return !!(c.clientId && c.clientSecret);
}

/** Store the App GitHub created from our manifest. First writer wins; returns false if one is already stored. */
export async function storeManifestApp(app: ManifestConversion): Promise<boolean> {
  const sealed = encrypt(JSON.stringify(manifestConversion.parse(app)), AAD);
  const rows = await q<{ name: string }>('INSERT INTO platform_secrets (name, value_enc) VALUES ($1, $2) ON CONFLICT (name) DO NOTHING RETURNING name', [NAME, sealed]);
  resetGithubCreds();
  return rows.length === 1;
}

/** The manifest GitHub uses to create an App with exactly the permissions and URLs AcquiCode needs. */
export function githubAppManifest(name: string): Record<string, unknown> {
  const app = config().APP_URL.replace(/\/+$/, '');
  return {
    name,
    url: app,
    description: 'Evidence-graded technical diligence for AI-built software. Read-only access to the repositories you choose.',
    public: true,
    hook_attributes: { url: `${app}/api/github/webhook`, active: true },
    redirect_url: `${app}/api/setup/github/callback`,
    callback_urls: [`${app}/api/auth/github/callback`],
    setup_url: `${app}/api/github/setup`,
    setup_on_update: true,
    request_oauth_on_install: false,
    default_permissions: { contents: 'read', metadata: 'read', pull_requests: 'read' },
    default_events: ['push', 'repository'],
  };
}
