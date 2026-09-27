import { Footer, TopBar } from '@/components/ui';
import { currentUser } from '@/lib/session';
import { platformKey } from '@/lib/signing';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Verify a dossier' };

interface Result {
  digest: string;
  signatureValid: boolean | null;
  dossierMatches: boolean | null;
  keyid: string | null;
  level: string | null;
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
  if (typeof params.r === 'string') {
    try {
      result = JSON.parse(Buffer.from(params.r, 'base64url').toString('utf8')) as Result;
    } catch {
      result = null;
    }
  }
  const error = typeof params.error === 'string' ? params.error : null;
  const key = platformKey();
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
              <dt>Dossier matches signed digest</dt><dd>{result.dossierMatches === null ? 'not checked' : result.dossierMatches ? 'yes' : 'NO'}</dd>
              <dt>Attestation</dt><dd>{result.level ? `${result.level} by ${result.producer} at ${result.producedAt}` : '—'}</dd>
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
            <textarea id="key" name="key" placeholder={key ? 'Leave empty to use this platform’s key' : '-----BEGIN PUBLIC KEY-----'} style={{ minHeight: '6rem' }} />
            <p className="hint">{key ? <>Default: the platform key {key.keyid}, published at /.well-known/acquicode-signing-key.pem.</> : 'This deployment has no platform signing key; paste the signer’s public key.'}</p>
          </div>
          <button className="btn primary" type="submit">Verify</button>
        </form>
      </main>
      <Footer />
    </>
  );
}
