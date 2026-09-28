import Link from 'next/link';
import { Contact, LegalPage } from '@/components/legal';
import { currentUser } from '@/lib/session';
import { site } from '@/lib/site';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Terms of service' };

export default async function Terms() {
  const user = await currentUser();
  const s = site();
  const provider = s.operatorNamed ? s.operator : 'the operator of this AcquiCode deployment';
  return (
    <LegalPage title="Terms of service" signedIn={!!user}>
      <p>
        These terms govern your use of AcquiCode at <code>{s.host}</code>. The service is provided by {provider} (&ldquo;we&rdquo;). If your organisation has signed an order form or
        agreement with us, that document takes precedence where it differs from these terms.
      </p>

      <h2>1. What AcquiCode does, and does not do</h2>
      <p>
        AcquiCode analyses software repositories and produces a diligence dossier: facts about the code and its history, each with a stated certainty, and
        questions for management, counsel and engineering. A readiness level (READY, REVIEW, BLOCKED) describes how completely the evidence answers those
        questions. It is not a statement that the software is good, secure, owned or free of legal risk.
      </p>
      <p>
        AcquiCode is not legal, financial, tax or security advice, and it is not an audit. It does not run or test your software, review its design, or
        inspect infrastructure or data handling. It sees only what the repositories you connect contain. Decisions you or others make on the basis of a
        dossier are yours.
      </p>

      <h2>2. Accounts and organisations</h2>
      <p>
        You sign in with GitHub. Work happens in organisations whose owners and admins decide who may see and change what. You are responsible for the access
        you grant: to people you invite, to share links you create, and to the repositories you connect. Tell us promptly at{' '}
        <Contact email={s.securityEmail} fallback="the security contact on the Security page" /> if you believe an account has been compromised.
      </p>

      <h2>3. Your code and your data</h2>
      <ul>
        <li>You keep all rights in your code, your repositories, your declarations and your dossiers.</li>
        <li>
          You give us permission to fetch, process and store them only as needed to provide the service to you: cloning a repository for the duration of an
          analysis, storing the resulting dossier for the retention period your organisation sets, and showing it to the people and links you authorise.
        </li>
        <li>We do not use your code or your dossiers to train any machine-learning model, and no language model reads them.</li>
        <li>We do not sell your data or use it for advertising.</li>
        <li>
          We treat source code and dossiers as confidential. We disclose them only to the subprocessors listed on the{' '}
          <Link href="/legal/subprocessors">subprocessors page</Link> for the purposes stated there, or when the law compels us to, in which case we will tell you
          unless the law forbids it.
        </li>
        <li>
          You may delete a repository, or your whole organisation, at any time from the app. Deletion removes the data from the service immediately; copies in
          backups expire on the backup schedule.
        </li>
      </ul>

      <h2>4. Share links and dossiers you give to others</h2>
      <p>
        Anyone with a share link can read that dossier until the link expires or you revoke it. Once you give a dossier or a link to a buyer, investor or
        adviser, what they do with it is governed by your agreements with them, not by these terms.
      </p>

      <h2>5. Acceptable use</h2>
      <p>You must only connect or upload repositories you are authorised to analyse. You must not:</p>
      <ul>
        <li>use AcquiCode to analyse code you have no right to access, or to find weaknesses in systems you do not own or have permission to test;</li>
        <li>attempt to access another organisation&apos;s data, probe or overload the service, or bypass its limits or security controls;</li>
        <li>use a dossier to misrepresent its contents, for example by altering it and presenting it as produced by AcquiCode.</li>
      </ul>
      <p>We may suspend access that breaks these rules or endangers other customers, and will tell you why unless doing so would itself cause harm.</p>

      <h2>6. Plans and payment</h2>
      <ul>
        <li>Prices and limits are shown on the pricing section of the home page and in your organisation&apos;s settings.</li>
        <li>A Readiness purchase covers its plan for 90 days from payment. Subscriptions (Custody, Acquirer) renew monthly until cancelled; cancelling stops the next renewal.</li>
        <li>
          If we cannot produce a dossier for your repositories for technical reasons within 14 days of a Readiness purchase, tell us and we will refund it. Other
          refunds are at our discretion or as required by law.
        </li>
        <li>Prices exclude taxes, which are added where required.</li>
      </ul>

      <h2>7. Changes and availability</h2>
      <p>
        We improve the analysis continuously; rule versions are recorded in every dossier so results can be reproduced. We will give at least 30 days&apos; notice
        by email or in the app before a change to these terms or to a paid feature that materially reduces what you receive. We aim for high availability but,
        unless your agreement says otherwise, provide no service-level commitment.
      </p>

      <h2>8. Warranties and liability</h2>
      <p>
        The service is provided as is. An analysis can only report what the evidence in your repositories shows; we do not promise that it finds every issue, or
        that any finding will or will not matter in a transaction. To the extent the law allows, our total liability for any claim relating to the service is
        limited to the fees you paid us in the 12 months before the claim, and neither party is liable for indirect or consequential losses. Nothing in these
        terms limits liability that cannot be limited by law.
      </p>

      <h2>9. Ending the relationship</h2>
      <p>
        You can stop using AcquiCode and delete your organisation at any time. We may end the service for you with 30 days&apos; notice, or immediately for a
        serious breach of these terms; in either case you can download your dossiers before access ends.
      </p>

      <h2>10. Law and contact</h2>
      <p>
        These terms are governed by the laws of the place where the operator is established, unless your agreement with us says otherwise. Questions:{' '}
        <Contact email={s.supportEmail} fallback="contact the operator of this deployment" />.
      </p>
    </LegalPage>
  );
}
