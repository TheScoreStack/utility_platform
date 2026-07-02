export const OvFlowArc = ({ tone }: { tone: "owe" | "owed" | "neutral" }) => {
  const color =
    tone === "owe" ? "#fb923c" : tone === "owed" ? "#34d399" : "#94a3b8";
  return (
    <svg
      viewBox="0 0 100 18"
      preserveAspectRatio="none"
      style={{ width: "100%", height: "100%", overflow: "visible" }}
      aria-hidden="true"
    >
      <path
        d="M 4 12 Q 50 -4 96 12"
        fill="none"
        stroke={color}
        strokeWidth="1.4"
        strokeDasharray="2 4"
        strokeLinecap="round"
        opacity="0.75"
      />
      <polygon points="98,12 92,8 92,16" fill={color} opacity="0.95" />
      <circle cx="4" cy="12" r="1.6" fill={color} opacity="0.95" />
    </svg>
  );
};
