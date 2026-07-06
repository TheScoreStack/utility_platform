import PublicShell from "../components/PublicShell";

// Public marketing page — the App Store listing's Marketing URL.
export const AboutPage = () => (
  <PublicShell active="about">
    <p className="pub-eyebrow">Group expenses, handled</p>
    <h1 className="pub-title">
      Scan receipts. Split expenses.
      <br />
      Settle up <em>for real.</em>
    </h1>
    <p className="pub-lede">
      Stack Core makes group expenses painless — trips, roommates, dinners,
      anything you split. On iPhone and the web.
    </p>

    <div className="pub-cards">
      <div className="pub-card">
        <div className="pub-card__icon">📷</div>
        <h3 className="pub-card__title">Receipts that split themselves</h3>
        <p className="pub-card__body">
          Photograph a receipt and the line items are read for you — assign
          each dish to whoever ordered it, and tax and tip follow to the
          cent.
        </p>
      </div>
      <div className="pub-card">
        <div className="pub-card__icon">👥</div>
        <h3 className="pub-card__title">Add anyone, even without the app</h3>
        <p className="pub-card__body">
          Add friends by name and start splitting immediately; when they join
          from your invite link, their balance is waiting for them.
        </p>
      </div>
      <div className="pub-card">
        <div className="pub-card__icon">💸</div>
        <h3 className="pub-card__title">The fewest possible payments</h3>
        <p className="pub-card__body">
          Stack Core computes who pays whom, then opens Venmo or PayPal with
          the amount prefilled. Confirm when the money lands.
        </p>
      </div>
      <div className="pub-card">
        <div className="pub-card__icon">🔁</div>
        <h3 className="pub-card__title">Set it and forget it</h3>
        <p className="pub-card__body">
          Rent and subscriptions repeat weekly or monthly. Drafts stay
          private until you're sure they're right.
        </p>
      </div>
    </div>

    <div className="pub-cta-row">
      <a className="pub-cta" href="/">
        Open the web app
      </a>
      <a className="pub-cta pub-cta--ghost" href="/support">
        Questions?
      </a>
    </div>
    <p className="pub-hint">
      Coming to the App Store — the iPhone app is in TestFlight now.
    </p>
  </PublicShell>
);

export default AboutPage;
