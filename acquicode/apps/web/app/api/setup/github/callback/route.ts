import { cookies } from 'next/headers';
import { config } from '@/lib/config';
import { verifyState } from '@/lib/crypto';
import { githubCreds, manifestConversion, storeManifestApp } from '@/lib/github-config';
import { formHandler, redirectTo } from '@/lib/http';
import { log } from '@/lib/log';
import { SETUP_COOKIE, setupUnlocked } from '@/lib/setup';

export const dynamic = 'force-dynamic';

/**
 * GitHub redirects here after the operator creates the App from our manifest. The
 * one-time code is exchanged for the App's id, private key, client secret and
 * webhook secret, which are stored encrypted. Only the browser that unlocked setup,
 * holding a state we issued, can complete this; and only once.
 */
export const GET = formHandler(async (req: Request) => {
  const url = new URL(req.url);
  if (!setupUnlocked((await cookies()).get(SETUP_COOKIE)?.value)) return redirectTo('/setup?error=Setup is locked. Enter the setup token again, then create the App.');
  if (verifyState<{ purpose: string }>(url.searchParams.get('state'))?.purpose !== 'gh-manifest') return redirectTo('/setup?error=The GitHub link expired. Start again.');
  const code = url.searchParams.get('code') ?? '';
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(code)) return redirectTo('/setup?error=GitHub did not return a code.');
  if ((await githubCreds()).source !== 'none') return redirectTo('/setup?error=GitHub is already connected to this deployment.');

  const res = await fetch(`${config().GITHUB_API_URL}/app-manifests/${code}/conversions`, {
    method: 'POST',
    headers: { accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'user-agent': 'acquicode' },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) return redirectTo(`/setup?error=${encodeURIComponent(`GitHub refused the code (HTTP ${res.status}). Codes are valid for one hour and one use; start again.`)}`);
  const parsed = manifestConversion.safeParse(await res.json());
  if (!parsed.success) return redirectTo('/setup?error=GitHub returned an App without the expected credentials.');
  if (!(await storeManifestApp(parsed.data))) return redirectTo('/setup?error=GitHub is already connected to this deployment.');
  log().info({ app: parsed.data.slug, id: parsed.data.id }, 'GitHub App created through setup');
  return redirectTo('/setup?notice=GitHub App created. Sign in with GitHub to create your organisation.');
});
