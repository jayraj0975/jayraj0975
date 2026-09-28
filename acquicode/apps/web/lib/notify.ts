import { createHmac, randomUUID } from 'node:crypto';
import { config } from './config';
import { decrypt, safeEqual } from './crypto';
import { withOrg, type Tx } from './db';
import { enqueue } from './jobs';
import { requestPublic } from './net';

/**
 * Outbound notifications. Events are emitted inside the tenant transaction that
 * caused them and delivered by the worker as ordinary jobs (retried with
 * backoff). Payloads carry names, levels, counts and links: never code, file
 * contents, secrets or evidence extracts.
 */
export const NOTIFY_EVENTS = ['scan.completed', 'scan.failed', 'dossier.changed', 'request.received'] as const;
export type NotifyEvent = (typeof NOTIFY_EVENTS)[number] | 'test';

export const EVENT_LABELS: Record<(typeof NOTIFY_EVENTS)[number], string> = {
  'scan.completed': 'A dossier is ready',
  'scan.failed': 'An analysis failed',
  'dossier.changed': 'Material change since the previous snapshot',
  'request.received': 'A requested dossier was delivered',
};

export interface NotifyPayload {
  event: NotifyEvent;
  id: string;
  occurredAt: string;
  organisation: { id: string; name: string };
  message: string;
  url: string | null;
  repository?: { id: string; name: string };
  scan?: { id: string; readiness: string | null };
  changes?: { material: number; readinessFrom: string | null; readinessTo: string | null; highlights: string[] };
  request?: { id: string; target: string };
}

export type NotifyData = Omit<NotifyPayload, 'event' | 'id' | 'occurredAt'>;

/** Queue one delivery per endpoint in this organisation subscribed to the event. Must run inside withOrg(orgId). */
export async function emit(c: Tx, orgId: string, event: Exclude<NotifyEvent, 'test'>, data: NotifyData): Promise<number> {
  const eps = await c.query<{ id: string }>('SELECT id FROM notification_endpoints WHERE $1 = ANY(events)', [event]);
  for (const ep of eps.rows) await enqueueDelivery(c, orgId, ep.id, event, data);
  return eps.rowCount ?? 0;
}

export async function enqueueDelivery(c: Tx, orgId: string, endpointId: string, event: NotifyEvent, data: NotifyData): Promise<void> {
  const payload: NotifyPayload = { event, id: randomUUID(), occurredAt: new Date().toISOString(), ...data };
  await enqueue(c, orgId, 'notify', { endpointId, payload });
}

function slackEscape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function slackText(p: NotifyPayload): string {
  const lines = [`*AcquiCode* · ${slackEscape(p.message)}`];
  for (const h of p.changes?.highlights ?? []) lines.push(`• ${slackEscape(h)}`);
  if (p.url) lines.push(`<${p.url}|Open in AcquiCode>`);
  return lines.join('\n');
}

export interface Delivery {
  url: string;
  headers: Record<string, string>;
  body: string;
}

/** The exact HTTP request for an endpoint. Signed as `t=<unix>,v1=<hex HMAC-SHA256 of "t.body">`. */
export function buildDelivery(ep: { url: string; format: 'json' | 'slack'; secret: string }, p: NotifyPayload, now = Date.now()): Delivery {
  const body = ep.format === 'slack' ? JSON.stringify({ text: slackText(p) }) : JSON.stringify(p);
  const t = Math.floor(now / 1000);
  const sig = createHmac('sha256', ep.secret).update(`${t}.${body}`).digest('hex');
  return {
    url: ep.url,
    body,
    headers: {
      'content-type': 'application/json',
      'user-agent': 'AcquiCode-Webhooks/1',
      'x-acquicode-event': p.event,
      'x-acquicode-delivery': p.id,
      'x-acquicode-signature': `t=${t},v1=${sig}`,
    },
  };
}

/** For receivers (and tests): verify a delivery's signature with a five-minute tolerance. */
export function verifyDelivery(body: string, header: string | null, secret: string, now = Math.floor(Date.now() / 1000)): boolean {
  if (!header) return false;
  const parts = Object.fromEntries(header.split(',').map((kv) => kv.split('=') as [string, string]));
  const t = Number(parts.t);
  if (!Number.isFinite(t) || Math.abs(now - t) > 300 || !parts.v1) return false;
  return safeEqual(parts.v1, createHmac('sha256', secret).update(`${t}.${body}`).digest('hex'));
}

export function endpointSecret(sealed: string, endpointId: string): string {
  return decrypt(sealed, `notify:${endpointId}`).toString('utf8');
}

export function endpointUrl(sealed: string, endpointId: string): string {
  return decrypt(sealed, `notify-url:${endpointId}`).toString('utf8');
}

/** "hooks.slack.com/services/T0…" style hint: enough to recognise, not enough to use. */
export function urlHint(url: string): string {
  const u = new URL(url);
  const first = u.pathname.split('/').filter(Boolean)[0];
  return `${u.host}${first ? `/${first}/…` : '/…'}`;
}

/**
 * Worker: send one delivery and record the outcome on the endpoint. The HTTP call happens
 * outside any database transaction. Throws after recording a failure, so the job is retried.
 */
export async function deliver(orgId: string, endpointId: string, payload: NotifyPayload): Promise<void> {
  const ep = await withOrg(orgId, async (c) =>
    (await c.query<{ id: string; url_enc: string; format: 'json' | 'slack'; secret_enc: string }>('SELECT id, url_enc, format, secret_enc FROM notification_endpoints WHERE id = $1', [endpointId])).rows[0],
  );
  if (!ep) return; // endpoint removed since the event: nothing to do
  const d = buildDelivery({ url: endpointUrl(ep.url_enc, ep.id), format: ep.format, secret: endpointSecret(ep.secret_enc, ep.id) }, payload);
  let ok = false;
  let reason: string;
  try {
    const r = await requestPublic('POST', d.url, d.headers, d.body, 10_000, 64_000);
    ok = r.status >= 200 && r.status < 300;
    reason = `HTTP ${r.status}`;
  } catch (err) {
    reason = (err instanceof Error ? err.message : String(err)).slice(0, 200);
  }
  await withOrg(orgId, (c) =>
    c.query(
      `UPDATE notification_endpoints SET last_attempt_at = now(), last_status = $2, consecutive_failures = ${ok ? '0' : 'consecutive_failures + 1'} WHERE id = $1`,
      [ep.id, `${ok ? 'delivered' : 'failed'} ${payload.event} (${reason})`],
    ),
  );
  if (!ok) throw new Error(`notification delivery failed: ${reason}`);
}

export function appLink(path: string): string {
  return new URL(path, config().APP_URL).toString();
}
