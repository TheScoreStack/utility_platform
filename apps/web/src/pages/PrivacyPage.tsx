// Public page (rendered outside the Authenticator) — required for the App
// Store listing and linked from the site footer. Keep it accurate to what
// the stack actually does; update the effective date when it changes.

const sectionStyle: React.CSSProperties = { marginTop: "2rem" };
const headingStyle: React.CSSProperties = {
  fontSize: "1.05rem",
  marginBottom: "0.5rem"
};

export const PrivacyPage = () => (
  <main
    style={{
      maxWidth: "46rem",
      margin: "0 auto",
      padding: "3rem 1.5rem 5rem",
      lineHeight: 1.65,
      color: "#e2e8f0",
      background: "#0f172a",
      minHeight: "100vh"
    }}
  >
    <a href="/" style={{ color: "#a5b4fc", fontSize: "0.9rem" }}>
      ← The Stack Core
    </a>
    <h1 style={{ marginTop: "1rem" }}>Privacy Policy</h1>
    <p style={{ color: "#94a3b8" }}>Effective July 5, 2026</p>

    <p>
      The Stack Core ("we", "our") is a group expense-splitting service
      available at thestackcore.com and as the Stack Core mobile app. This
      policy describes what information we collect, why, and the choices you
      have. The short version: we collect what the product needs to split
      expenses with your group, we don't run ads, and we never sell your
      data.
    </p>

    <section style={sectionStyle}>
      <h2 style={headingStyle}>Information we collect</h2>
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
          <strong>Operational logs.</strong> Standard server logs (timestamps,
          request paths, error details) used to keep the service running.
        </li>
      </ul>
      <p>
        We do not collect your location, contacts, browsing history, or
        advertising identifiers, and we do not use third-party analytics or
        advertising SDKs.
      </p>
    </section>

    <section style={sectionStyle}>
      <h2 style={headingStyle}>How we use it</h2>
      <ul>
        <li>To provide the service: splitting expenses, computing balances, and syncing them with your group.</li>
        <li>To read receipts you scan, using Amazon Textract (an automated text-extraction service).</li>
        <li>To send push notifications you can turn off per category in the app, and an optional weekly email digest you opt into.</li>
        <li>To fix problems, using error logs.</li>
      </ul>
    </section>

    <section style={sectionStyle}>
      <h2 style={headingStyle}>Who can see your information</h2>
      <ul>
        <li>
          <strong>Your trip members.</strong> That's the product: expenses,
          settlements, comments, your display name, and your shared payment
          handles are visible to the people in your trips. Draft expenses stay
          private to you until you publish them.
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
    </section>

    <section style={sectionStyle}>
      <h2 style={headingStyle}>Storage and security</h2>
      <p>
        Data is stored in AWS data centers in the United States, encrypted in
        transit (TLS) and at rest. Continuous backups let us recover from
        mistakes and failures.
      </p>
    </section>

    <section style={sectionStyle}>
      <h2 style={headingStyle}>Your choices and deleting your data</h2>
      <ul>
        <li>Edit or delete expenses, settlements, and comments you created, or leave a trip, at any time in the app.</li>
        <li>Control push notifications per category, and the email digest, in your profile settings.</li>
        <li>
          Delete your account from the app's Account screen. This permanently
          removes your login and profile (including payment handles).
          Expenses and settlements you shared with a group remain part of that
          group's records — the same way a text you sent stays in the group
          chat — but are no longer connected to a login.
        </li>
      </ul>
    </section>

    <section style={sectionStyle}>
      <h2 style={headingStyle}>Children</h2>
      <p>
        The Stack Core is not directed to children under 13, and we don't
        knowingly collect information from them.
      </p>
    </section>

    <section style={sectionStyle}>
      <h2 style={headingStyle}>Changes</h2>
      <p>
        If this policy changes materially, we'll update the effective date
        above and note the change in the app or by email.
      </p>
    </section>

    <section style={sectionStyle}>
      <h2 style={headingStyle}>Contact</h2>
      <p>
        Questions or requests:{" "}
        <a href="mailto:hunter.j.adam@gmail.com" style={{ color: "#a5b4fc" }}>
          hunter.j.adam@gmail.com
        </a>
      </p>
    </section>
  </main>
);

export default PrivacyPage;
