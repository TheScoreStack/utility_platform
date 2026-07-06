// Public page (rendered outside the Authenticator).

const sectionStyle: React.CSSProperties = { marginTop: "2rem" };
const headingStyle: React.CSSProperties = {
  fontSize: "1.05rem",
  marginBottom: "0.5rem"
};

export const TermsPage = () => (
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
    <h1 style={{ marginTop: "1rem" }}>Terms of Use</h1>
    <p style={{ color: "#94a3b8" }}>Effective July 5, 2026</p>

    <p>
      The Stack Core is a group expense-splitting service. By creating an
      account or using the app you agree to these terms.
    </p>

    <section style={sectionStyle}>
      <h2 style={headingStyle}>The service</h2>
      <p>
        Stack Core helps groups record shared expenses, scan receipts, and
        track who owes whom. It is a record-keeping tool: it does not hold,
        transfer, or process money. Payment links (Venmo, PayPal, Zelle) open
        third-party services governed by their own terms, and settling up
        happens entirely between you and your group.
      </p>
    </section>

    <section style={sectionStyle}>
      <h2 style={headingStyle}>Your content and conduct</h2>
      <p>
        You're responsible for what you add — expense details, receipt
        images, comments — and for having the right to share it with your
        group. Content you add to a trip is visible to that trip's members
        and remains part of the group's shared records even if you later
        leave or delete your account. Don't use the service for anything
        unlawful, and don't upload content you don't have rights to.
      </p>
    </section>

    <section style={sectionStyle}>
      <h2 style={headingStyle}>Accuracy</h2>
      <p>
        Split math is computed carefully, and receipt scanning is automated —
        but you should review extracted amounts before saving, and the
        numbers in the app are not financial, tax, or legal advice. Balances
        reflect what your group recorded, nothing more.
      </p>
    </section>

    <section style={sectionStyle}>
      <h2 style={headingStyle}>Availability and changes</h2>
      <p>
        The service is provided as-is, without warranties. We may change,
        suspend, or discontinue features, and may update these terms — if we
        do so materially, we'll update the date above and note it in the app.
        To the maximum extent permitted by law, our liability arising from
        your use of the service is limited to the amount you paid us for it
        (currently: nothing).
      </p>
    </section>

    <section style={sectionStyle}>
      <h2 style={headingStyle}>Your account</h2>
      <p>
        Keep your credentials to yourself; you're responsible for activity on
        your account. You can delete your account at any time from the app's
        Account screen. We may suspend accounts that abuse the service.
      </p>
    </section>

    <section style={sectionStyle}>
      <h2 style={headingStyle}>Copyright</h2>
      <p>
        © 2026 Hunter Adam. All rights reserved. The Stack Core name, app,
        and site are protected by copyright; the content your group adds
        belongs to your group.
      </p>
    </section>

    <section style={sectionStyle}>
      <h2 style={headingStyle}>Contact</h2>
      <p>
        <a href="mailto:hunter.j.adam@gmail.com" style={{ color: "#a5b4fc" }}>
          hunter.j.adam@gmail.com
        </a>
        {" · "}
        <a href="/privacy" style={{ color: "#a5b4fc" }}>
          Privacy Policy
        </a>
      </p>
    </section>
  </main>
);

export default TermsPage;
