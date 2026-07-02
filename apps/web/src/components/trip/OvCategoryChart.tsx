import { useMemo } from "react";
import { normalizeCategoryKey, resolveExpenseCategory } from "../../lib/expenseCategories";
import type { TripSummary } from "../../types";

interface OvCategoryChartProps {
  expenses: TripSummary["expenses"];
  totalSpent: number;
  currencyFormatter: Intl.NumberFormat;
}

export const OvCategoryChart = ({
  expenses,
  totalSpent,
  currencyFormatter
}: OvCategoryChartProps) => {
  const segments = useMemo(() => {
    const totals = new Map<
      string,
      { key: string; label: string; icon: string; color: string; amount: number }
    >();
    expenses.forEach((expense) => {
      const resolved = resolveExpenseCategory(expense.category);
      const key = resolved?.id ?? (normalizeCategoryKey(expense.category) || "unset");
      const label = resolved?.label ?? (expense.category?.trim() || "Uncategorized");
      const icon = resolved?.icon ?? "✦";
      const color = resolved?.color ?? "#94a3b8";
      const existing = totals.get(key);
      if (existing) {
        existing.amount += expense.total;
      } else {
        totals.set(key, { key, label, icon, color, amount: expense.total });
      }
    });
    return Array.from(totals.values()).sort((a, b) => b.amount - a.amount);
  }, [expenses]);

  if (segments.length === 0 || totalSpent <= 0) {
    return (
      <div className="cat-chart">
        <div className="cat-chart__empty">
          Add expenses to see a category breakdown.
        </div>
      </div>
    );
  }

  let cursor = 0;
  const arcs = segments.map((seg) => {
    const percent = (seg.amount / totalSpent) * 100;
    const arc = { ...seg, percent, startPercent: cursor };
    cursor += percent;
    return arc;
  });
  const visibleArcs = arcs.slice(0, 5);
  const hiddenCount = arcs.length - visibleArcs.length;
  const hiddenAmount =
    hiddenCount > 0
      ? arcs.slice(5).reduce((sum, a) => sum + a.amount, 0)
      : 0;

  return (
    <div className="cat-chart">
      <div className="cat-chart__top">
        <div className="cat-chart__donut">
          <svg viewBox="0 0 100 100" style={{ width: "100%", height: "100%" }}>
            <circle
              cx="50"
              cy="50"
              r="42"
              fill="none"
              stroke="rgba(148, 163, 184, 0.10)"
              strokeWidth="13"
            />
            <g transform="rotate(-90 50 50)">
              {arcs.map((arc) => {
                const dashLen = Math.max(0.5, arc.percent - 1.2);
                return (
                  <circle
                    key={arc.key}
                    cx="50"
                    cy="50"
                    r="42"
                    pathLength={100}
                    fill="none"
                    stroke={arc.color}
                    strokeWidth="13"
                    strokeLinecap="butt"
                    strokeDasharray={`${dashLen} ${100 - dashLen}`}
                    strokeDashoffset={-arc.startPercent}
                    opacity={0.9}
                  />
                );
              })}
            </g>
          </svg>
          <div className="cat-chart__center">
            <span className="cat-chart__center-amount">
              {currencyFormatter.format(totalSpent)}
            </span>
            <span className="cat-chart__center-label">spent</span>
          </div>
        </div>
        <div className="cat-chart__legend">
          {visibleArcs.map((arc) => (
            <div key={arc.key} className="cat-chart__row">
              <span className="cat-chart__swatch" style={{ background: arc.color }} />
              <span className="cat-chart__name" title={arc.label}>
                <span aria-hidden="true">{arc.icon}</span>
                {arc.label}
              </span>
              <span className="cat-chart__amount">
                {currencyFormatter.format(arc.amount)}
              </span>
            </div>
          ))}
          {hiddenCount > 0 && (
            <div className="cat-chart__row" style={{ color: "#64748b" }}>
              <span
                className="cat-chart__swatch"
                style={{ background: "rgba(148,163,184,0.4)" }}
              />
              <span className="cat-chart__name" style={{ fontStyle: "italic" }}>
                + {hiddenCount} more
              </span>
              <span className="cat-chart__amount">
                {currencyFormatter.format(hiddenAmount)}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
