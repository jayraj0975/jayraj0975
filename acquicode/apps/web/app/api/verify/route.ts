import { dossierDigest, verifyEnvelope, type Dossier, type DsseEnvelope } from '@acquicode/engine';
import { clientIp, handler, redirectTo } from '@/lib/http';
import { rateLimitIp } from '@/lib/ratelimit';
import { platformKey } from '@/lib/signing';

export const dynamic = 'force-dynamic';

/** Stateless verification: nothing uploaded here is stored. */
export const POST = handler(async (req: Request) => {
  await rateLimitIp('verify', clientIp(req), 30, 600);
  const fail = (msg: string) => redirectTo(`/verify?error=${encodeURIComponent(msg)}`);
  if (Number(req.headers.get('content-length') ?? '0') > 60 * 1024 * 1024) return fail('Files are too large to verify here; use the CLI.');
  const form = await req.formData();
  const df = form.get('dossier');
  const ef = form.get('envelope');
  const keyText = String(form.get('key') ?? '').trim();
  if (!(df instanceof File) || !df.size) return fail('Choose a dossier.json file.');
  let dossier: Dossier;
  let envelope: DsseEnvelope | null = null;
  try {
    dossier = JSON.parse(await df.text()) as Dossier;
    if (dossier.schema !== 'acquicode.dossier/1') return fail('That is not an AcquiCode dossier.');
  } catch {
    return fail('The dossier is not valid JSON.');
  }
  if (ef instanceof File && ef.size) {
    try {
      envelope = JSON.parse(await ef.text()) as DsseEnvelope;
    } catch {
      return fail('The signed manifest is not valid JSON.');
    }
  }
  const digest = dossierDigest(dossier);
  const result = {
    digest,
    signatureValid: null as boolean | null,
    dossierMatches: null as boolean | null,
    keyid: null as string | null,
    level: null as string | null,
    producer: null as string | null,
    producedAt: null as string | null,
    readiness: dossier.readiness?.level ?? 'unknown',
    subjects: (dossier.subjects ?? []).map((s) => `${s.name}${s.headCommit ? `@${s.headCommit.slice(0, 12)}` : ''}`).slice(0, 20),
    problems: [] as string[],
  };
  if (envelope) {
    const keys = keyText ? [keyText] : platformKey() ? [platformKey()!.publicKeyPem] : [];
    if (!keys.length) return fail('No public key: paste the signer’s key.');
    const r = verifyEnvelope(envelope, keys, dossier);
    result.signatureValid = r.signatureValid;
    result.dossierMatches = r.dossierMatches;
    result.keyid = r.keyid;
    result.problems = r.problems.slice(0, 10);
    if (r.statement) {
      result.level = r.statement.predicate?.attestation?.level ?? null;
      result.producer = r.statement.predicate?.attestation?.producer ?? null;
      result.producedAt = r.statement.predicate?.attestation?.producedAt ?? null;
    }
  }
  return redirectTo(`/verify?r=${Buffer.from(JSON.stringify(result)).toString('base64url')}`);
});
