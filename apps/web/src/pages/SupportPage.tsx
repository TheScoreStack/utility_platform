import PublicShell from "../components/PublicShell";

// Public support page — the App Store listing's Support URL.
export const SupportPage = () => (
  <PublicShell active="support">
    <p className="pub-eyebrow">Support</p>
    <h1 className="pub-title">
      How can <em>we help?</em>
    </h1>
    <p className="pub-lede">
      Questions, problems, or feedback about Stack Core — start with the
      quick answers below, or just email us.
    </p>

    <div className="pub-faq pub-body">
      <div className="pub-faq__item">
        <h3 className="pub-faq__q">How do invites work?</h3>
        <p className="pub-faq__a">
          Every trip has a share link — anyone who opens it can join, even
          without an account yet. If someone added you by name before you
          signed up, pick “I'm ‹you›” when joining and your balance comes
          with you.
        </p>
      </div>
      <div className="pub-faq__item">
        <h3 className="pub-faq__q">A receipt scanned wrong.</h3>
        <p className="pub-faq__a">
          Every extracted item is editable before you save — fix amounts or
          assignments on the review screen. If scans fail repeatedly, email
          us the receipt and we'll investigate.
        </p>
      </div>
      <div className="pub-faq__item">
        <h3 className="pub-faq__q">How do I delete my account?</h3>
        <p className="pub-faq__a">
          In the app: Account → Delete account. Your login and profile are
          removed permanently — details in the{" "}
          <a href="/privacy">privacy policy</a>.
        </p>
      </div>
      <div className="pub-faq__item">
        <h3 className="pub-faq__q">How do I stop notifications?</h3>
        <p className="pub-faq__a">
          Account settings has per-category toggles (activity and comments),
          or turn them off system-wide in iOS Settings.
        </p>
      </div>
      <div className="pub-faq__item">
        <h3 className="pub-faq__q">Can I leave a trip?</h3>
        <p className="pub-faq__a">
          Yes — trip menu → Members → Leave, as long as you have no recorded
          expenses or settlements in it.
        </p>
      </div>
    </div>

    <div className="pub-contact pub-body">
      <h2 className="pub-h2" style={{ marginTop: 0 }}>
        Still <em>stuck?</em>
      </h2>
      <p style={{ margin: "0.3rem 0 1.2rem" }}>
        Email us and you'll hear back within a couple of days.
      </p>
      <a className="pub-cta" href="mailto:hunter.j.adam@gmail.com">
        hunter.j.adam@gmail.com
      </a>
    </div>
  </PublicShell>
);

export default SupportPage;
