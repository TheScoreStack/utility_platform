import type { SVGProps } from "react";

const gradientProps = {
  strokeWidth: 1.5,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  fill: "none"
};

export const WorkspaceBadgeIcon = ({
  className,
  ...props
}: SVGProps<SVGSVGElement>) => (
  <svg
    viewBox="0 0 48 48"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    {...props}
  >
    <defs>
      <linearGradient id="workspaceGradient" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#748ffc" />
        <stop offset="100%" stopColor="#4c6ef5" />
      </linearGradient>
    </defs>
    <rect
      x="4"
      y="4"
      width="40"
      height="40"
      rx="12"
      fill="url(#workspaceGradient)"
      opacity="0.2"
    />
    <path
      {...gradientProps}
      stroke="url(#workspaceGradient)"
      d="M15 20h18M15 28h8M27 28h6M18 16l5.5-5 5.5 5"
    />
    <circle cx="16" cy="32" r="3" fill="#748ffc" opacity="0.9" />
    <circle cx="32" cy="32" r="3" fill="#4c6ef5" opacity="0.9" />
  </svg>
);

export const ToolStackIcon = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <svg
    viewBox="0 0 40 40"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    {...props}
  >
    <rect x="6" y="8" width="28" height="8" rx="4" fill="rgba(56,189,248,0.25)" />
    <rect x="10" y="18" width="20" height="8" rx="4" fill="rgba(14,165,233,0.35)" />
    <rect x="14" y="28" width="12" height="6" rx="3" fill="rgba(99,102,241,0.4)" />
  </svg>
);

export const AutomationSparkIcon = ({
  className,
  ...props
}: SVGProps<SVGSVGElement>) => (
  <svg
    viewBox="0 0 40 40"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    {...props}
  >
    <circle cx="20" cy="20" r="14" fill="rgba(14,165,233,0.15)" />
    <path
      {...gradientProps}
      stroke="#748ffc"
      d="M12 20h16M20 12v16M15 15l10 10M25 15l-10 10"
      opacity="0.8"
    />
  </svg>
);

export const ExpensesGlyphIcon = ({
  className,
  ...props
}: SVGProps<SVGSVGElement>) => (
  <svg
    viewBox="0 0 48 48"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    {...props}
  >
    <defs>
      <linearGradient id="expensesGradient" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#f97316" />
        <stop offset="100%" stopColor="#facc15" />
      </linearGradient>
    </defs>
    <rect
      x="6"
      y="10"
      width="36"
      height="28"
      rx="6"
      fill="rgba(248, 250, 252, 0.08)"
      stroke="url(#expensesGradient)"
      strokeWidth="1.5"
    />
    <path
      d="M16 20h16M16 28h10"
      stroke="url(#expensesGradient)"
      strokeWidth="2"
      strokeLinecap="round"
    />
    <circle cx="33" cy="28" r="4" fill="url(#expensesGradient)" opacity="0.8" />
  </svg>
);

export const LedgerGlyphIcon = ({
  className,
  ...props
}: SVGProps<SVGSVGElement>) => (
  <svg
    viewBox="0 0 48 48"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    {...props}
  >
    <defs>
      <linearGradient id="ledgerGradient" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#748ffc" />
        <stop offset="100%" stopColor="#0ea5e9" />
      </linearGradient>
    </defs>
    <rect
      x="10"
      y="8"
      width="28"
      height="32"
      rx="6"
      fill="rgba(14, 165, 233, 0.08)"
      stroke="url(#ledgerGradient)"
      strokeWidth="1.5"
    />
    <path
      {...gradientProps}
      stroke="url(#ledgerGradient)"
      d="M16 16h16M16 22h12M16 28h16M16 34h10"
    />
    <circle cx="30" cy="22" r="3" fill="#748ffc" opacity="0.8" />
  </svg>
);

export const TimeClockGlyphIcon = ({
  className,
  ...props
}: SVGProps<SVGSVGElement>) => (
  <svg
    viewBox="0 0 48 48"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    {...props}
  >
    <defs>
      <linearGradient id="timeClockGradient" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#a78bfa" />
        <stop offset="100%" stopColor="#7c3aed" />
      </linearGradient>
    </defs>
    <circle
      cx="24"
      cy="24"
      r="18"
      fill="rgba(167, 139, 250, 0.08)"
      stroke="url(#timeClockGradient)"
      strokeWidth="1.5"
    />
    <path
      {...gradientProps}
      stroke="url(#timeClockGradient)"
      strokeWidth="2"
      d="M24 14v10l7 5"
    />
    <circle cx="24" cy="24" r="2" fill="url(#timeClockGradient)" />
    <path
      {...gradientProps}
      stroke="url(#timeClockGradient)"
      d="M24 8v2M24 38v2M8 24h2M38 24h2"
    />
  </svg>
);
