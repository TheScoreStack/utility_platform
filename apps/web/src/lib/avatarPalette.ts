export interface AvatarPalette {
  bg: string;
  fg: string;
}

export const AVATAR_PALETTE: AvatarPalette[] = [
  { bg: "linear-gradient(135deg, #f472b6 0%, #ec4899 100%)", fg: "#fdf2f8" },
  { bg: "linear-gradient(135deg, #60a5fa 0%, #2563eb 100%)", fg: "#dbeafe" },
  { bg: "linear-gradient(135deg, #34d399 0%, #059669 100%)", fg: "#d1fae5" },
  { bg: "linear-gradient(135deg, #fbbf24 0%, #d97706 100%)", fg: "#fef3c7" },
  { bg: "linear-gradient(135deg, #a78bfa 0%, #7c3aed 100%)", fg: "#ede9fe" },
  { bg: "linear-gradient(135deg, #f87171 0%, #dc2626 100%)", fg: "#fee2e2" },
  { bg: "linear-gradient(135deg, #22d3ee 0%, #0891b2 100%)", fg: "#cffafe" },
  { bg: "linear-gradient(135deg, #fb923c 0%, #ea580c 100%)", fg: "#ffedd5" }
];

export const hashString = (s: string): number => {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
};

export const seedAvatar = (key: string): AvatarPalette =>
  AVATAR_PALETTE[hashString(key || "anon") % AVATAR_PALETTE.length];

export const getInitials = (name: string): string => {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
};
