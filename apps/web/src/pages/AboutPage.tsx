// Public marketing page (rendered outside the Authenticator) — the App
// Store listing's Marketing URL points here.

const featureStyle: React.CSSProperties = {
  padding: "1.1rem 1.25rem",
  borderRadius: "0.9rem",
  border: "1px solid rgba(148,163,184,0.15)",
  background: "rgba(30,41,59,0.5)"
};

export const AboutPage = () => (
  <main
    style={{
      maxWidth: "46rem",
      margin: "0 auto",
      padding: "3.5rem 1.5rem 5rem",
      lineHeight: 1.65,
      color: "#e2e8f0",
      background: "#0f172a",
      minHeight: "100vh"
    }}
  >
    <p style={{ color: "#a5b4fc", letterSpacing: "0.08em", fontSize: "0.8rem" }}>
      THE STACK CORE
    </p>
    <h1 style={{ fontSize: "2.2rem", lineHeight: 1.2, marginTop: "0.5rem" }}>
      Scan receipts. Split expenses.
      <br />
      Settle up for real.
    </h1>
    <p style={{ color: "#94a3b8", fontSize: "1.05rem", marginTop: "1rem" }}>
      Stack Core makes group expenses painless — trips, roommates, dinners,
      anything you split. On iPhone and the web.
    </p>

    <div style={{ display: "grid", gap: "0.8rem", marginTop: "2.5rem" }}>
      <div style={featureStyle}>
        <strong>📷 Receipts that split themselves.</strong> Photograph a
        receipt and the line items are read for you — assign each dish to
        whoever ordered it, and tax and tip follow to the cent.
      </div>
      <div style={featureStyle}>
        <strong>👥 Add anyone, even without the app.</strong> Add friends by
        name and start splitting immediately; when they join from your invite
        link, their balance is waiting for them.
      </div>
      <div style={featureStyle}>
        <strong>💸 Settle up in the fewest payments.</strong> Stack Core
        computes who pays whom, then opens Venmo or PayPal with the amount
        prefilled. Confirm when the money lands.
      </div>
      <div style={featureStyle}>
        <strong>🔁 Set it and forget it.</strong> Rent and subscriptions can
        repeat weekly or monthly. Drafts stay private until you're sure
        they're right.
      </div>
    </div>

    <div style={{ marginTop: "2.5rem", display: "flex", gap: "1rem", flexWrap: "wrap" }}>
      <a
        href="/"
        style={{
          padding: "0.8rem 1.5rem",
          borderRadius: "999px",
          background: "#4c6ef5",
          color: "#fff",
          textDecoration: "none",
          fontWeight: 600
        }}
      >
        Open the web app
      </a>
    </div>
    <p style={{ color: "#64748b", fontSize: "0.85rem", marginTop: "0.8rem" }}>
      Coming to the App Store — iPhone app in TestFlight now.
    </p>

    <footer
      style={{
        marginTop: "4rem",
        paddingTop: "1.5rem",
        borderTop: "1px solid rgba(148,163,184,0.15)",
        fontSize: "0.85rem",
        color: "#94a3b8"
      }}
    >
      © 2026 Hunter Adam ·{" "}
      <a href="/privacy" style={{ color: "#a5b4fc" }}>
        Privacy
      </a>
      {" · "}
      <a href="/terms" style={{ color: "#a5b4fc" }}>
        Terms
      </a>
      {" · "}
      <a href="/support" style={{ color: "#a5b4fc" }}>
        Support
      </a>
    </footer>
  </main>
);

export default AboutPage;
