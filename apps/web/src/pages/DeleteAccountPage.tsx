import PublicShell from "../components/PublicShell";

// Public account-deletion page — linked from the Google Play listing
// (Data safety → Delete account URL), so it must be reachable signed-out.
export const DeleteAccountPage = () => (
  <PublicShell active="privacy">
    <p className="pub-eyebrow">Your data</p>
    <h1 className="pub-title">
      Delete your <em>Stack Core</em> account
    </h1>
    <p className="pub-lede">
      You can permanently delete your Stack Core account and its data at any
      time — straight from the app, or by emailing us.
    </p>

    <div className="pub-body">
      <h2 className="pub-h2">
        From the <em>app</em>
      </h2>
      <ol>
        <li>Open Stack Core and sign in.</li>
        <li>
          Tap your <strong>Account</strong> avatar (top right).
        </li>
        <li>
          Choose <strong>Delete account</strong> and confirm.
        </li>
      </ol>
      <p>
        Deletion takes effect immediately — your login stops working right
        away.
      </p>

      <h2 className="pub-h2">
        By <em>email</em>
      </h2>
      <p>
        No access to the app? Email{" "}
        <a href="mailto:hunter.j.adam@gmail.com?subject=Delete%20my%20Stack%20Core%20account">
          hunter.j.adam@gmail.com
        </a>{" "}
        from the address on your account with the subject{" "}
        <em>“Delete my Stack Core account”</em>. We verify the request against
        the account email and complete it within 30 days.
      </p>

      <h2 className="pub-h2">
        What gets <em>deleted</em>
      </h2>
      <ul>
        <li>Your login credentials and authentication record.</li>
        <li>Your profile — name, email address, and payment handles.</li>
        <li>Your notification preferences and registered devices.</li>
        <li>Receipt images you uploaded.</li>
      </ul>

      <h2 className="pub-h2">
        What may be <em>kept</em>
      </h2>
      <p>
        Expenses and settlements you recorded in shared trips remain, shown
        under your name only, so other members' balances stay correct. They
        are no longer linked to a login or email address. Routine encrypted
        backups age out automatically within 35 days.
      </p>
      <p>
        Want your data removed without closing the account — say, deleting
        receipt images or clearing payment handles? Email us at the address
        above and we'll take care of it.
      </p>
      <p>
        The full details are in our <a href="/privacy">privacy policy</a>.
      </p>
    </div>
  </PublicShell>
);

export default DeleteAccountPage;
