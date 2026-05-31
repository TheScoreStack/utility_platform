import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { api, ApiError } from "../lib/api";
import { resolveExpenseCategory } from "../lib/expenseCategories";
import type { TripSummary } from "../types";

const formatDate = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  try {
    return new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric"
    }).format(d);
  } catch {
    return d.toDateString();
  }
};

const TripSummaryPrintPage = () => {
  const { tripId } = useParams<{ tripId: string }>();
  const { data, isLoading, error } = useQuery({
    queryKey: ["trip", tripId],
    queryFn: () => api.get<TripSummary>(`/trips/${tripId}`),
    enabled: Boolean(tripId)
  });

  const fmt = useMemo(() => {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: data?.trip.currency ?? "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  }, [data?.trip.currency]);

  const groupTotal = useMemo(
    () => (data?.expenses ?? []).reduce((sum, e) => sum + (e.total ?? 0), 0),
    [data?.expenses]
  );

  const expensesByCategory = useMemo(() => {
    if (!data?.expenses) return [];
    const totals = new Map<
      string,
      { key: string; label: string; icon: string; total: number; count: number }
    >();
    data.expenses.forEach((expense) => {
      const resolved = resolveExpenseCategory(expense.category);
      const key = resolved?.id ?? (expense.category?.trim().toLowerCase() || "uncategorized");
      const label = resolved?.label ?? expense.category?.trim() ?? "Uncategorized";
      const icon = resolved?.icon ?? "✦";
      const entry = totals.get(key) ?? { key, label, icon, total: 0, count: 0 };
      entry.total += expense.total;
      entry.count += 1;
      totals.set(key, entry);
    });
    return Array.from(totals.values()).sort((a, b) => b.total - a.total);
  }, [data?.expenses]);

  if (isLoading) {
    return (
      <div className="print-loading">
        <p>Loading trip summary…</p>
      </div>
    );
  }

  if (error || !data) {
    const message =
      error instanceof ApiError ? error.message : "Couldn't load this trip.";
    return (
      <div className="empty-state">
        <p className="empty-state__title">Summary unavailable.</p>
        <p className="empty-state__hint">{message}</p>
      </div>
    );
  }

  const { trip, members, expenses, settlements, balances } = data;
  const membersById = Object.fromEntries(
    members.map((member) => [member.memberId, member.displayName ?? member.email ?? member.memberId])
  );

  const startStr = trip.startDate ? formatDate(trip.startDate) : null;
  const endStr = trip.endDate ? formatDate(trip.endDate) : null;
  const dateRange = startStr && endStr
    ? `${startStr} → ${endStr}`
    : startStr ?? endStr ?? "Flexible dates";

  return (
    <div className="print-page">
      <div className="print-toolbar">
        <Link to={`/group-expenses/trips/${trip.tripId}`} className="print-toolbar__back">
          ← Back to trip
        </Link>
        <button
          type="button"
          className="primary print-toolbar__print"
          onClick={() => window.print()}
        >
          Print / Save as PDF
        </button>
      </div>

      <article className="print-sheet">
        <header className="print-header">
          <span className="print-eyebrow">The Stack Core · Trip Summary</span>
          <h1 className="print-title">{trip.name}</h1>
          <p className="print-sub">
            {dateRange} · {members.length} {members.length === 1 ? "person" : "people"} · {trip.currency}
          </p>
          <p className="print-printed">
            Printed {formatDate(new Date().toISOString())}
          </p>
        </header>

        <section className="print-section">
          <h2 className="print-h2">Members</h2>
          <ul className="print-members">
            {members.map((member) => (
              <li key={member.memberId}>
                {member.displayName ?? member.email ?? member.memberId}
                {member.memberId === trip.ownerId && (
                  <span className="print-tag">owner</span>
                )}
              </li>
            ))}
          </ul>
        </section>

        <section className="print-section">
          <h2 className="print-h2">Balances</h2>
          <table className="print-table">
            <thead>
              <tr>
                <th>Person</th>
                <th className="print-right">Balance</th>
              </tr>
            </thead>
            <tbody>
              {balances.map((row) => (
                <tr key={row.memberId}>
                  <td>{membersById[row.memberId] ?? row.memberId}</td>
                  <td
                    className="print-right"
                    style={{
                      color:
                        Math.abs(row.balance) < 0.01
                          ? "#444"
                          : row.balance > 0
                            ? "#0a7c43"
                            : "#a04400"
                    }}
                  >
                    {row.balance > 0 ? "+" : ""}
                    {fmt.format(row.balance)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="print-section">
          <h2 className="print-h2">Spending by category</h2>
          <table className="print-table">
            <thead>
              <tr>
                <th>Category</th>
                <th className="print-right">Count</th>
                <th className="print-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {expensesByCategory.map((cat) => (
                <tr key={cat.key}>
                  <td>
                    <span aria-hidden="true">{cat.icon}</span> {cat.label}
                  </td>
                  <td className="print-right">{cat.count}</td>
                  <td className="print-right">{fmt.format(cat.total)}</td>
                </tr>
              ))}
              <tr className="print-total-row">
                <td><strong>Total spent</strong></td>
                <td className="print-right">{expenses.length}</td>
                <td className="print-right"><strong>{fmt.format(groupTotal)}</strong></td>
              </tr>
            </tbody>
          </table>
        </section>

        <section className="print-section">
          <h2 className="print-h2">Settlements ({settlements.length})</h2>
          {settlements.length === 0 ? (
            <p className="print-empty"><em>No settlements recorded.</em></p>
          ) : (
            <table className="print-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>From</th>
                  <th>To</th>
                  <th className="print-right">Amount</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {settlements.map((s) => (
                  <tr key={s.settlementId}>
                    <td>{formatDate(s.createdAt)}</td>
                    <td>{membersById[s.fromMemberId] ?? s.fromMemberId}</td>
                    <td>{membersById[s.toMemberId] ?? s.toMemberId}</td>
                    <td className="print-right">{fmt.format(s.amount)}</td>
                    <td>{s.confirmedAt ? "confirmed" : "pending"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="print-section">
          <h2 className="print-h2">All expenses ({expenses.length})</h2>
          {expenses.length === 0 ? (
            <p className="print-empty"><em>No expenses recorded.</em></p>
          ) : (
            <table className="print-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Description</th>
                  <th>Category</th>
                  <th>Paid by</th>
                  <th className="print-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {[...expenses]
                  .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
                  .map((expense) => {
                    const resolved = resolveExpenseCategory(expense.category);
                    return (
                      <tr key={expense.expenseId}>
                        <td>{formatDate(expense.createdAt)}</td>
                        <td>{expense.description}</td>
                        <td>{resolved ? `${resolved.icon} ${resolved.label}` : expense.category ?? ""}</td>
                        <td>{membersById[expense.paidByMemberId] ?? expense.paidByMemberId}</td>
                        <td className="print-right">{fmt.format(expense.total)}</td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          )}
        </section>

        <footer className="print-footer">
          <p>Generated by The Stack Core · thestackcore.com</p>
        </footer>
      </article>
    </div>
  );
};

export default TripSummaryPrintPage;
