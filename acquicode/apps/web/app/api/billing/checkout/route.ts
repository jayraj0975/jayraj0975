import { NextResponse } from 'next/server';
import { config, stripeConfigured } from '@/lib/config';
import { assertSameOrigin, formHandler, HttpError } from '@/lib/http';
import { requireApiContext } from '@/lib/session';
import { PLANS } from '@/lib/plans';

export const dynamic = 'force-dynamic';

/** Creates a Stripe Checkout session with inline price data (no dashboard setup needed). */
export const POST = formHandler(async (req: Request) => {
  assertSameOrigin(req);
  const ctx = await requireApiContext('admin');
  if (!stripeConfigured()) throw new HttpError(503, 'Billing is not configured on this deployment.');
  const form = await req.formData();
  const plan = PLANS.find((p) => p.id === String(form.get('plan')));
  if (!plan?.checkout) throw new HttpError(400, 'That plan cannot be bought online');
  const app = config().APP_URL;
  const body = new URLSearchParams({
    mode: plan.checkout.mode,
    'line_items[0][quantity]': '1',
    'line_items[0][price_data][currency]': 'usd',
    'line_items[0][price_data][unit_amount]': String(plan.checkout.amountCents),
    'line_items[0][price_data][product_data][name]': `AcquiCode ${plan.name}`,
    success_url: `${app}/app/settings?notice=${encodeURIComponent('Payment received. Your plan updates as soon as Stripe confirms it.')}#billing`,
    cancel_url: `${app}/app/settings#billing`,
    client_reference_id: ctx.org.id,
    'metadata[org]': ctx.org.id,
    'metadata[plan]': plan.id,
  });
  if (plan.checkout.mode === 'subscription') {
    body.set('line_items[0][price_data][recurring][interval]', plan.checkout.interval ?? 'month');
    body.set('subscription_data[metadata][org]', ctx.org.id);
    body.set('subscription_data[metadata][plan]', plan.id);
  }
  const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: { authorization: `Bearer ${config().STRIPE_SECRET_KEY}`, 'content-type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(20_000),
  });
  const session = (await res.json()) as { url?: string; error?: { message?: string } };
  if (!res.ok || !session.url) throw new HttpError(502, `Stripe: ${session.error?.message ?? res.status}`);
  return NextResponse.redirect(session.url, 303);
});
