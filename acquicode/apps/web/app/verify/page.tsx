import { Footer, TopBar } from '@/components/ui';
import { currentUser } from '@/lib/session';
import { platformPublicKeys } from '@/lib/signing';
import { verifyState } from '@/lib/crypto';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Verify a dossier' };

interface Result {
  digest: string;
  signatureValid: boolean | null;
  dossierMatches: boolean | null;
  keyid: string | null;
  signer: 'platform' | 'platform-retired' | 'supplied' | null;
  level: string | null;
  claimedLevel: string | null;
  producer: string | null;
  producedAt: string | null;
  readiness: string;
  subjects: string[];
  problems: string[];
}

export default async function Verify({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const user = await currentUser();
  let result: Result | null = null;
  const signed = typeof params.r === 'string' ? verifyState<{ result: string }>(params.r) : null;
  if (signed) {
    try {
      result = JSON.parse(signed.result) as Result;
    } catch {
      result = null;
    }
  }
  const error = typeof params.error === 'string' ? params.error : null;
  const keys = platformPublicKeys();
  const key = keys.find((k) => k.status === 'current') ?? null;
  return (
    <>
      <TopBar signedIn={!!user} current="verify" />
      <main className="wrap narrow" style={{ paddingTop: '2rem' }}>
        <h1>Verify a dossier</h1>
        <p className="muted">Check that a dossier was signed by the key you trust and has not been altered since. Nothing you upload here is stored.</p>
        {error ? <div className="notice error">{error.slice(0, 300)}</div> : null}
        {result ? (
          <div className="card" role="status">
            <h3>{result.signatureValid && result.dossierMatches ? 'Signature valid and dossier unaltered' : result.signatureValid === null ? 'Digest computed (no envelope supplied)' : 'Verification failed'}</h3>
            <dl className="kv">
              <dt>Dossier digest</dt><dd><code>{result.digest}</code></dd>
              <dt>Subjects</dt><dd>{result.subjects.join(', ')}</dd>
              <dt>Readiness in dossier</dt><dd>{result.readiness}</dd>
              <dt>Signature</dt><dd>{result.signatureValid === null ? 'not checked' : result.signatureValid ? `valid (${result.keyid})` : 'INVALID'}</dd>
              <dt>Signed by</dt><dd>{result.signer === 'platform' ? 'this platform’s current key' : result.signer === 'platform-retired' ? 'a retired key of this platform (published at /.well-known/acquicode-keys.json)' : result.signer === 'supplied' ? 'the key you supplied (not this platform)' : '—'}</dd>
              <dt>Dossier matches signed digest</dt><dd>{result.dossierMatches === null ? 'not checked' : result.dossierMatches ? 'yes' : 'NO'}</dd>
              <dt>Attestation</dt><dd>{result.level ? `${result.level} by ${result.producer} at ${result.producedAt}` : '—'}{result.claimedLevel && result.claimedLevel !== result.level ? ` (claimed ${result.claimedLevel})` : ''}</dd>
            </dl>
            {result.problems.length ? <ul>{result.problems.map((p) => <li key={p}>{p}</li>)}</ul> : null}
            <p className="small muted">A valid signature shows who produced the dossier and that it is unchanged. To confirm it describes the code, re-run the analyzer on the same commits and compare digests: <code>acquicode verify dossier.json --reproduce &lt;repo&gt;</code>.</p>
          </div>
        ) : null}
        <form action="/api/verify" method="post" encType="multipart/form-data" className="card" style={{ marginTop: '1.5rem' }}>
          <div className="field">
            <label htmlFor="dossier">Dossier (dossier.json)</label>
            <input id="dossier" name="dossier" type="file" accept="application/json,.json" required />
          </div>
          <div className="field">
            <label htmlFor="envelope">Signed manifest (dossier.dsse.json), optional</label>
            <input id="envelope" name="envelope" type="file" accept="application/json,.json" />
          </div>
          <div className="field">
            <label htmlFor="key">Public key (PEM), optional</label>
            <textarea id="key" name="key" placeholder={key ? 'Optional: the signer’s key, for self-attested dossiers' : '-----BEGIN PUBLIC KEY-----'} style={{ minHeight: '6rem' }} />
            <p className="hint">{key ? <>This platform&apos;s keys ({keys.length === 1 ? key.keyid : `${keys.length} keys, current ${key.keyid}`}) are always checked; paste another key only for self-attested dossiers.</> : 'This deployment has no platform signing key; paste the signer’s public key.'}</p>
          </div>
          <button className="btn primary" type="submit">Verify</button>
        </form>
      </main>
      <Footer />
    </>
  );
}
