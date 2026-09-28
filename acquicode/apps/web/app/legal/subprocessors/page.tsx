import { LegalPage } from '@/components/legal';
import { currentUser } from '@/lib/session';
import { site, subprocessors } from '@/lib/site';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Subprocessors' };

export default async function Subprocessors() {
  const user = await currentUser();
  const s = site();
  const list = subprocessors();
  return (
    <LegalPage title="Subprocessors" signedIn={!!user}>
      <p>
        The third parties that can receive data from AcquiCode at <code>{s.host}</code>. This list is generated from how this deployment is configured, so it
        shows what is actually in use rather than what might be.
      </p>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr><th>Who</th><th>Purpose</th><th>Data</th><th>When</th></tr>
          </thead>
          <tbody>
            {list.map((p) => (
              <tr key={p.name}><td><strong>{p.name}</strong></td><td>{p.purpose}</td><td>{p.data}</td><td className="small">{p.when}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
      {!list.some((p) => /Hosting/.test(p.purpose)) ? (
        <p className="small muted">The infrastructure provider that hosts this deployment is named in your agreement with the operator.</p>
      ) : null}
      <p className="small muted">No language-model, analytics or advertising provider receives data from this service.</p>
    </LegalPage>
  );
}
