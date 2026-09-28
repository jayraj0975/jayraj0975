import { config } from '@/lib/config';
import { verifyStripeSignature } from '@/lib/billing';
import { isUuid, q, q1, withOrg } from '@/lib/db';
import { handler, HttpError } from '@/lib/http';
import { PLANS } from '@/lib/plans';
import { audit } from '@/lib/audit';

export const dynamic = 'force-dynamic';

export const POST = handler(async (req: Request) => {
  const secret = config().STRIPE_WEBHOOK_SECRET;
  if (!secret) throw new HttpError(404, 'Billing is not configured');
  const payload = await req.text();
  if (!verifyStripeSignature(payload, req.headers.get('stripe-signature'), secret)) throw new HttpError(400, 'Invalid signature');
  const event = JSON.parse(payload) as { id: string; type: string; data: { object: Record<string, unknown> } };
  const fresh = await q1("INSERT INTO webhook_deliveries (source, delivery_id) VALUES ('stripe', $1) ON CONFLICT DO NOTHING RETURNING 1", [event.id]);
  if (!fresh) return Response.json({ received: true, duplicate: true });
  const obj = event.data.object;
  const meta = (obj.metadata ?? {}) as Record<string, string>;
  const orgId = meta.org;
  const plan = PLANS.find((p) => p.id === meta.plan);
  if (!isUuid(orgId) || !plan) return Response.json({ received: true });
  if (event.type === 'checkout.session.completed' && obj.payment_status !== 'unpaid') {
    const expires = plan.checkout?.mode === 'payment' ? "now() + interval '90 days'" : 'NULL';
    await q(`UPDATE orgs SET plan = $2, plan_expires_at = ${expires}, stripe_customer_id = COALESCE($3, stripe_customer_id) WHERE id = $1`, [orgId, plan.id, typeof obj.customer === 'string' ? obj.customer : null]);
    await withOrg(orgId, (c) => audit(c, orgId, { type: 'webhook', id: `stripe:${event.id}` }, 'billing.plan_changed', { type: 'org', id: orgId }, { plan: plan.id }));
  } else if (event.type === 'customer.subscription.deleted') {
    await q("UPDATE orgs SET plan = 'free', plan_expires_at = NULL WHERE id = $1 AND plan = $2", [orgId, plan.id]);
    await withOrg(orgId, (c) => audit(c, orgId, { type: 'webhook', id: `stripe:${event.id}` }, 'billing.subscription_ended', { type: 'org', id: orgId }, { plan: plan.id }));
  }
  return Response.json({ received: true });
});
