// Public page (rendered outside the Authenticator) — the App Store listing's
// Support URL points here.

const sectionStyle: React.CSSProperties = { marginTop: "2rem" };
const headingStyle: React.CSSProperties = {
  fontSize: "1.05rem",
  marginBottom: "0.5rem"
};

export const SupportPage = () => (
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
    <h1 style={{ marginTop: "1rem" }}>Support</h1>
    <p>
      Questions, problems, or feedback about Stack Core? Email{" "}
      <a href="mailto:hunter.j.adam@gmail.com" style={{ color: "#a5b4fc" }}>
        hunter.j.adam@gmail.com
      </a>{" "}
      and you'll hear back within a couple of days.
    </p>

    <section style={sectionStyle}>
      <h2 style={headingStyle}>Common questions</h2>
      <ul>
        <li>
          <strong>How do invites work?</strong> Every trip has a share link —
          anyone who opens it can join, even without an account yet. If
          someone added you by name before you signed up, pick "I'm ‹you›"
          when joining and your balance comes with you.
        </li>
        <li>
          <strong>A receipt scanned wrong.</strong> Every extracted item is
          editable before you save — fix the amounts or assignments on the
          review screen. If scans fail repeatedly, email us the receipt and
          we'll investigate.
        </li>
        <li>
          <strong>How do I delete my account?</strong> In the app: Account →
          Delete account. Your login and profile are removed permanently.
          Details in the{" "}
          <a href="/privacy" style={{ color: "#a5b4fc" }}>
            privacy policy
          </a>
          .
        </li>
        <li>
          <strong>How do I stop notifications?</strong> Account settings has
          per-category toggles (activity and comments), or turn them off
          system-wide in iOS Settings.
        </li>
        <li>
          <strong>Can I leave a trip?</strong> Yes — trip menu → Members →
          Leave, as long as you have no recorded expenses or settlements in
          it.
        </li>
      </ul>
    </section>

    <section style={sectionStyle}>
      <h2 style={headingStyle}>Legal</h2>
      <p>
        <a href="/privacy" style={{ color: "#a5b4fc" }}>
          Privacy Policy
        </a>
        {" · "}
        <a href="/terms" style={{ color: "#a5b4fc" }}>
          Terms of Use
        </a>
      </p>
    </section>
  </main>
);

export default SupportPage;
