import { z } from 'zod';

/**
 * All configuration comes from the environment and is validated once. Optional
 * integrations (GitHub App, S3, Stripe, platform signing) are reported as
 * "not configured" in the UI rather than faked.
 */
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_URL: z.string().url().default('http://localhost:3000'),
  DATABASE_URL: z.string().min(1).default('postgres://acquicode_app:app_password@localhost:5432/acquicode_dev'),
  DATABASE_MIGRATION_URL: z.string().optional(),
  APP_DB_ROLE: z.string().default('acquicode_app'),
  DATABASE_SSL: z.enum(['off', 'require', 'verify']).default('off'),

  // Encryption at rest: "kid:base64key,kid2:base64key"; first entry encrypts, all decrypt (rotation).
  DATA_ENCRYPTION_KEYS: z.string().optional(),
  SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(24 * 30).default(24 * 7),

  STORAGE_DRIVER: z.enum(['fs', 's3']).default('fs'),
  STORAGE_DIR: z.string().default('./data/blobs'),
  S3_BUCKET: z.string().optional(),
  S3_REGION: z.string().default('us-east-1'),
  S3_ENDPOINT: z.string().optional(),
  S3_FORCE_PATH_STYLE: z.enum(['true', 'false']).default('false'),

  WORK_DIR: z.string().default('./data/work'),
  MAX_UPLOAD_MB: z.coerce.number().int().min(1).max(2048).default(200),
  SCAN_TIMEOUT_SECONDS: z.coerce.number().int().min(30).max(6 * 3600).default(1800),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(16).default(2),

  GITHUB_APP_ID: z.string().optional(),
  GITHUB_APP_SLUG: z.string().optional(),
  GITHUB_APP_PRIVATE_KEY: z.string().optional(),
  GITHUB_CLIENT_ID: z.string().optional(),
  GITHUB_CLIENT_SECRET: z.string().optional(),
  GITHUB_WEBHOOK_SECRET: z.string().optional(),
  GITHUB_API_URL: z.string().url().default('https://api.github.com'),
  GITHUB_WEB_URL: z.string().url().default('https://github.com'),

  PLATFORM_SIGNING_KEY: z.string().optional(),
  // Public keys (PEM, one after another) that signed platform dossiers in the past. Published with the
  // current key so dossiers signed before a rotation stay verifiable.
  PLATFORM_RETIRED_PUBLIC_KEYS: z.string().optional(),

  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),

  // Public contact details, shown in the footer, legal pages and security.txt. Never derived: unset means not shown.
  CONTACT_EMAIL: z.string().email().optional(),
  SECURITY_EMAIL: z.string().email().optional(),
  // Legal name of the company operating this deployment, used in the Terms and Privacy pages.
  LEGAL_ENTITY: z.string().max(200).optional(),
  // Infrastructure provider that hosts this deployment, listed as a subprocessor (e.g. "Amazon Web Services (eu-west-1)").
  HOSTING_PROVIDER: z.string().max(200).optional(),

  // Enables /setup, where the operator creates the GitHub App from a manifest in one click. At least 24 characters;
  // setup closes for good once an App is stored or GitHub variables are set.
  SETUP_TOKEN: z.string().min(24).optional(),

  ACQUICODE_DEV_LOGIN: z.enum(['0', '1']).default('0'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  // Number of reverse proxies in front of the app that append to X-Forwarded-For. 0 = none: client IPs are recorded as unknown.
  TRUST_PROXY: z.coerce.number().int().min(0).max(5).default(0),
});

export type Config = z.infer<typeof schema>;

let cached: Config | null = null;

export function config(): Config {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid configuration: ${issues}`);
  }
  const c = parsed.data;
  if (c.NODE_ENV === 'production') {
    if (!c.DATA_ENCRYPTION_KEYS) throw new Error('DATA_ENCRYPTION_KEYS is required in production');
    if (c.ACQUICODE_DEV_LOGIN === '1') throw new Error('ACQUICODE_DEV_LOGIN must not be enabled in production');
    const local = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(c.APP_URL);
    if (!c.APP_URL.startsWith('https://') && !local) throw new Error('APP_URL must be https in production (http is allowed only for localhost)');
  }
  if (c.STORAGE_DRIVER === 's3' && !c.S3_BUCKET) throw new Error('S3_BUCKET is required when STORAGE_DRIVER=s3');
  cached = c;
  return c;
}

export function devLoginEnabled(): boolean {
  const c = config();
  return c.ACQUICODE_DEV_LOGIN === '1' && c.NODE_ENV !== 'production';
}

export function stripeConfigured(): boolean {
  const c = config();
  return !!(c.STRIPE_SECRET_KEY && c.STRIPE_WEBHOOK_SECRET);
}

/** Test hook: reset the cache after changing process.env. */
export function resetConfig(): void {
  cached = null;
}
