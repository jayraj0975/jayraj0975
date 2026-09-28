import { NextResponse } from 'next/server';
import { signState, verifyState } from '@/lib/crypto';
import { oauthAuthorizeUrl } from '@/lib/github';
import { formHandler, redirectTo } from '@/lib/http';
import { requireApiContext, hasRole } from '@/lib/session';

export const dynamic = 'force-dynamic';

/**
 * GitHub redirects here after the App is installed or its repository selection
 * changes. The installation_id in this URL is not trusted: the admin is sent
 * through GitHub sign-in, and the OAuth callback binds the installation only if
 * GitHub lists it among the installations that user can access.
 */
export const GET = formHandler(async (req: Request) => {
  const url = new URL(req.url);
  const ctx = await requireApiContext('viewer');
  const state = verifyState<{ purpose: string; org: string; user: string }>(url.searchParams.get('state'));
  const installationId = Number(url.searchParams.get('installation_id'));
  if (!state || state.purpose !== 'install' || state.user !== ctx.user.id) return redirectTo('/app/connect?error=The installation link expired or belongs to another session. Start again from Add source.');
  if (state.org !== ctx.org.id || !hasRole(ctx, 'admin')) return redirectTo('/app/connect?error=Only an admin of this organisation can connect GitHub.');
  if (!Number.isSafeInteger(installationId) || installationId <= 0) return redirectTo('/app/connect?error=GitHub did not return an installation id.');
  const verify = signState({ purpose: 'install-verify', org: ctx.org.id, user: ctx.user.id, installation: installationId }, 600);
  return NextResponse.redirect(await oauthAuthorizeUrl(verify), 303);
});
