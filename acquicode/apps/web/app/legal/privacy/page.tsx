import Link from 'next/link';
import { Contact, LegalPage } from '@/components/legal';
import { currentUser } from '@/lib/session';
import { site } from '@/lib/site';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Privacy' };

export default async function Privacy() {
  const user = await currentUser();
  const s = site();
  return (
    <LegalPage title="Privacy" signedIn={!!user}>
      <p>
        This page explains what personal data AcquiCode at <code>{s.host}</code> processes, why, for how long, and your rights. The controller is{' '}
        {s.operatorNamed ? <strong>{s.operator}</strong> : s.operator}. For source code and dossiers, your organisation decides what is analysed and we act on
        its behalf.
      </p>

      <h2>What we collect</h2>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr><th>Data</th><th>Source</th><th>Why</th><th>Kept for</th></tr>
          </thead>
          <tbody>
            <tr><td>GitHub account id, username, display name, verified primary email</td><td>GitHub, when you sign in</td><td>Signing you in; showing who did what; invitations</td><td>Until you ask us to delete your account</td></tr>
            <tr><td>Session records: a hash of your session token, IP address, browser user agent</td><td>Your browser</td><td>Keeping you signed in; security</td><td>Until the session expires, then deleted automatically</td></tr>
            <tr><td>Audit events: who did what, when, and from which IP address</td><td>Your actions in the app, share-link views</td><td>Security and accountability for your organisation</td><td>Life of your organisation (append-only)</td></tr>
            <tr><td>Repository contents</td><td>Repositories you connect or upload</td><td>Producing a dossier</td><td>Only for the duration of an analysis, then deleted</td></tr>
            <tr><td>Contributor names and email addresses from git history</td><td>Commit metadata in your repositories</td><td>The contributor register in the dossier (who wrote the code, under which agreement)</td><td>Inside dossiers, for your organisation&apos;s retention period</td></tr>
            <tr><td>Dossiers, declarations, IP registers you upload</td><td>You and the analysis</td><td>The service</td><td>Your organisation&apos;s retention period (7–3,650 days, set in Settings); declarations until deleted</td></tr>
            <tr><td>Billing details</td><td>You, at checkout</td><td>Payment</td><td>Held by the payment provider; we keep the plan and customer reference</td></tr>
          </tbody>
        </table>
      </div>
      <p>We use no advertising or third-party analytics, and set only the cookies needed to sign in and remember your selected organisation.</p>

      <h2>Contributors named in git history</h2>
      <p>
        Dossiers list the people who committed code, because ownership of code depends on who wrote it. Their data comes from the repository your organisation
        chose to analyse, and is processed on your organisation&apos;s behalf for its legitimate interest in establishing ownership of its software. If you are a
        contributor and have a question, contact the organisation that analysed the repository, or us.
      </p>

      <h2>Legal bases</h2>
      <p>
        Performing our contract with you (running the service), our legitimate interests (security, preventing abuse, improving reliability) and legal
        obligations (tax and accounting records). Where we rely on legitimate interests you may object.
      </p>

      <h2>Who else receives data</h2>
      <p>
        Only the <Link href="/legal/subprocessors">subprocessors</Link> needed to run this deployment, for the purposes stated there. No language model or
        machine-learning vendor receives your code or dossiers, and nothing is used to train models.
      </p>

      <h2>Security</h2>
      <p>
        Encryption in transit and at rest, per-organisation isolation enforced in the database, short-lived read-only repository tokens, and an append-only
        audit log. Details on the <Link href="/security">security page</Link>.
      </p>

      <h2>Your rights</h2>
      <p>
        You can access, correct, export or delete your data. Organisation owners can delete repositories, dossiers or the whole organisation in the app at any
        time. For anything else, including deleting your account, write to <Contact email={s.supportEmail} fallback="the operator of this deployment" />. You
        may also complain to your data-protection authority.
      </p>
    </LegalPage>
  );
}
