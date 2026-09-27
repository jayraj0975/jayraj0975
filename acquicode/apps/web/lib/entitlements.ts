import type { Tx } from './db';
import { HttpError } from './errors';
import { planFor, type Plan } from './plans';

export async function effectivePlan(c: Tx, orgId: string): Promise<Plan> {
  const r = await c.query<{ plan: string; plan_expires_at: Date | null }>('SELECT plan, plan_expires_at FROM orgs WHERE id = $1', [orgId]);
  const o = r.rows[0];
  if (!o) return planFor('free');
  if (o.plan_expires_at && new Date(o.plan_expires_at).getTime() < Date.now()) return planFor('free');
  return planFor(o.plan);
}

export async function assertCanAddRepository(c: Tx, orgId: string, adding = 1): Promise<void> {
  const plan = await effectivePlan(c, orgId);
  const r = await c.query<{ n: string }>('SELECT count(*)::text AS n FROM repositories');
  if (Number(r.rows[0]!.n) + adding > plan.limits.repositories) {
    throw new HttpError(402, `The ${plan.name} plan allows ${plan.limits.repositories} repositor${plan.limits.repositories === 1 ? 'y' : 'ies'}. Upgrade in Settings → Billing.`);
  }
}

export async function assertCanScan(c: Tx, orgId: string): Promise<void> {
  const plan = await effectivePlan(c, orgId);
  const r = await c.query<{ n: string }>("SELECT count(*)::text AS n FROM scans WHERE created_at > now() - interval '30 days' AND trigger <> 'cli'");
  if (Number(r.rows[0]!.n) >= plan.limits.hostedScansPerMonth) {
    throw new HttpError(402, `The ${plan.name} plan includes ${plan.limits.hostedScansPerMonth} hosted scans per 30 days. Upgrade, or run the CLI (unlimited, local).`);
  }
}

export async function assertFeature(c: Tx, orgId: string, feature: 'shareLinks' | 'monitoring'): Promise<void> {
  const plan = await effectivePlan(c, orgId);
  if (!plan.limits[feature]) throw new HttpError(402, `${feature === 'shareLinks' ? 'Share links' : 'Continuous monitoring'} require a paid plan (Readiness, Custody or Acquirer).`);
}
