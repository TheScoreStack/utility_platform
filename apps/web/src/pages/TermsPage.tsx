import PublicShell from "../components/PublicShell";

export const TermsPage = () => (
  <PublicShell active="terms">
    <p className="pub-eyebrow">Legal</p>
    <h1 className="pub-title">
      Terms of <em>Use.</em>
    </h1>
    <p className="pub-date">Effective July 5, 2026</p>

    <div className="pub-body">
      <p>
        The Stack Core is a group expense-splitting service. By creating an
        account or using the app you agree to these terms.
      </p>

      <hr className="pub-rule" />

      <h2 className="pub-h2">The service</h2>
      <p>
        Stack Core helps groups record shared expenses, scan receipts, and
        track who owes whom. It is a record-keeping tool: it does not hold,
        transfer, or process money. Payment links (Venmo, PayPal, Zelle) open
        third-party services governed by their own terms, and settling up
        happens entirely between you and your group.
      </p>

      <h2 className="pub-h2">Your content and conduct</h2>
      <p>
        You're responsible for what you add — expense details, receipt
        images, comments — and for having the right to share it with your
        group. Content you add to a trip is visible to that trip's members
        and remains part of the group's shared records even if you later
        leave or delete your account. Don't use the service for anything
        unlawful, and don't upload content you don't have rights to.
      </p>

      <h2 className="pub-h2">Accuracy</h2>
      <p>
        Split math is computed carefully, and receipt scanning is automated —
        but you should review extracted amounts before saving, and the
        numbers in the app are not financial, tax, or legal advice. Balances
        reflect what your group recorded, nothing more.
      </p>

      <h2 className="pub-h2">Availability and changes</h2>
      <p>
        The service is provided as-is, without warranties. We may change,
        suspend, or discontinue features, and may update these terms — if we
        do so materially, we'll update the date above and note it in the app.
        To the maximum extent permitted by law, our liability arising from
        your use of the service is limited to the amount you paid us for it
        (currently: nothing).
      </p>

      <h2 className="pub-h2">Your account</h2>
      <p>
        Keep your credentials to yourself; you're responsible for activity on
        your account. You can delete your account at any time from the app's
        Account screen. We may suspend accounts that abuse the service.
      </p>

      <h2 className="pub-h2">Copyright</h2>
      <p>
        © 2026 Hunter Adam. All rights reserved. The Stack Core name, app,
        and site are protected by copyright; the content your group adds
        belongs to your group.
      </p>

      <h2 className="pub-h2">Contact</h2>
      <p>
        <a href="mailto:hunter.j.adam@gmail.com">hunter.j.adam@gmail.com</a>
        {" · "}
        <a href="/privacy">Privacy Policy</a>
      </p>
    </div>
  </PublicShell>
);

export default TermsPage;
