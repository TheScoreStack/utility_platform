import { resolveExpenseCategory } from "../lib/expenseCategories";

interface CategoryBadgeProps {
  category?: string | null;
  prefix?: string;
}

export const CategoryBadge = ({ category, prefix }: CategoryBadgeProps) => {
  if (!category || !category.trim()) return null;
  const resolved = resolveExpenseCategory(category);
  const label = resolved?.label ?? category.trim();
  const icon = resolved?.icon ?? "✦";
  const color = resolved?.color ?? "#cbd5f5";

  return (
    <span
      className="cat-badge"
      style={{
        background: `color-mix(in srgb, ${color} 16%, transparent)`,
        borderColor: `color-mix(in srgb, ${color} 36%, transparent)`,
        color
      }}
    >
      <span className="cat-badge__icon" aria-hidden="true">{icon}</span>
      <span className="cat-badge__label">
        {prefix ? (
          <span className="cat-badge__prefix">{prefix}</span>
        ) : null}
        {label}
      </span>
    </span>
  );
};
