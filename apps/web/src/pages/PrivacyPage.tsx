import PublicShell from "../components/PublicShell";

// Public privacy policy — required for the App Store listing. Keep it
// accurate to what the stack actually does; update the effective date when
// it changes.
export const PrivacyPage = () => (
  <PublicShell active="privacy">
    <p className="pub-eyebrow">Legal</p>
    <h1 className="pub-title">
      Privacy <em>Policy.</em>
    </h1>
    <p className="pub-date">Effective July 5, 2026</p>

    <div className="pub-body">
      <p>
        The Stack Core ("we", "our") is a group expense-splitting service
        available at thestackcore.com and as the Stack Core mobile app. This
        policy describes what information we collect, why, and the choices
        you have. The short version: we collect what the product needs to
        split expenses with your group, we don't run ads, and we never sell
        your data.
      </p>

      <hr className="pub-rule" />

      <h2 className="pub-h2">Information we collect</h2>
      <ul>
        <li>
          <strong>Account information.</strong> Your name, email address, and
          password, managed through AWS Cognito. We never see or store your
          password in plain text.
        </li>
        <li>
          <strong>Content you add.</strong> Trips, expenses, line items,
          settlements, comments, and the payment handles you choose to share
          (such as a Venmo username, PayPal.Me name, or the email/phone you
          use with Zelle).
        </li>
        <li>
          <strong>Receipt images.</strong> Photos of receipts you upload for
          scanning and record keeping.
        </li>
        <li>
          <strong>Device push tokens.</strong> If you enable notifications, a
          token that lets us deliver them to your device. Declining or
          revoking notification permission removes this capability.
        </li>
        <li>
          <strong>Operational logs.</strong> Standard server logs
          (timestamps, request paths, error details) used to keep the
          service running.
        </li>
      </ul>
      <p>
        We do not collect your location, contacts, browsing history, or
        advertising identifiers, and we do not use third-party analytics or
        advertising SDKs.
      </p>

      <h2 className="pub-h2">How we use it</h2>
      <ul>
        <li>
          To provide the service: splitting expenses, computing balances, and
          syncing them with your group.
        </li>
        <li>
          To read receipts you scan, using Amazon Textract (an automated
          text-extraction service).
        </li>
        <li>
          To send push notifications you can turn off per category in the
          app, and an optional weekly email digest you opt into.
        </li>
        <li>To fix problems, using error logs.</li>
      </ul>

      <h2 className="pub-h2">Who can see your information</h2>
      <ul>
        <li>
          <strong>Your trip members.</strong> That's the product: expenses,
          settlements, comments, your display name, and your shared payment
          handles are visible to the people in your trips. Draft expenses
          stay private to you until you publish them.
        </li>
        <li>
          <strong>Service providers.</strong> We run on Amazon Web Services
          (hosting, database, file storage, receipt OCR, email, and push
          delivery) and use Apple and Google's push notification services to
          reach your device. These providers process data on our behalf and
          don't get to use it for their own purposes.
        </li>
        <li>
          <strong>Legal requirements.</strong> We may disclose information if
          required by law.
        </li>
      </ul>
      <p>We never sell your information or share it with advertisers.</p>

      <h2 className="pub-h2">Storage and security</h2>
      <p>
        Data is stored in AWS data centers in the United States, encrypted in
        transit (TLS) and at rest. Continuous backups let us recover from
        mistakes and failures.
      </p>

      <h2 className="pub-h2">Your choices and deleting your data</h2>
      <ul>
        <li>
          Edit or delete expenses, settlements, and comments you created, or
          leave a trip, at any time in the app.
        </li>
        <li>
          Control push notifications per category, and the email digest, in
          your profile settings.
        </li>
        <li>
          Delete your account from the app's Account screen. This permanently
          removes your login and profile (including payment handles).
          Expenses and settlements you shared with a group remain part of
          that group's records — the same way a text you sent stays in the
          group chat — but are no longer connected to a login.
        </li>
      </ul>

      <h2 className="pub-h2">Children</h2>
      <p>
        The Stack Core is not directed to children under 13, and we don't
        knowingly collect information from them.
      </p>

      <h2 className="pub-h2">Changes</h2>
      <p>
        If this policy changes materially, we'll update the effective date
        above and note the change in the app or by email.
      </p>

      <h2 className="pub-h2">Contact</h2>
      <p>
        Questions or requests:{" "}
        <a href="mailto:hunter.j.adam@gmail.com">hunter.j.adam@gmail.com</a>
      </p>
    </div>
  </PublicShell>
);

export default PrivacyPage;
