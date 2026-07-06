import type { ReactNode } from "react";

/** Shared chrome for the public (pre-auth) pages: wordmark header,
 *  cross-links, and footer — styled to match the app shell. */
export const PublicShell = ({
  active,
  children
}: {
  active: "about" | "support" | "privacy" | "terms";
  children: ReactNode;
}) => (
  <div className="pub-shell">
    <div className="pub-inner pub-header">
      <a href="/about" style={{ textDecoration: "none" }}>
        <span className="shell-wordmark">
          <span className="shell-wordmark__the">The</span>
          <span className="shell-wordmark__stack">Stack</span>
          <span className="shell-wordmark__core">Core</span>
        </span>
      </a>
      <nav className="pub-nav" aria-label="Public pages">
        {(
          [
            ["about", "About"],
            ["support", "Support"],
            ["privacy", "Privacy"],
            ["terms", "Terms"]
          ] as const
        ).map(([slug, label]) => (
          <a
            key={slug}
            href={`/${slug}`}
            className={active === slug ? "pub-nav--active" : undefined}
          >
            {label}
          </a>
        ))}
      </nav>
    </div>
    <main className="pub-inner pub-main">{children}</main>
    <div className="pub-inner">
      <footer className="pub-footer">
        <span>© 2026 Hunter Adam</span>
        <span>
          <a href="/">Open the app</a>
          {" · "}
          <a href="mailto:hunter.j.adam@gmail.com">hunter.j.adam@gmail.com</a>
        </span>
      </footer>
    </div>
  </div>
);

export default PublicShell;
