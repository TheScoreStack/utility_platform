// What you came to the page for, above the ledger.
//
// Your net position and the shortest set of payments that clears the trip sit
// side by side, because on a desktop there is room to see both at once. On
// mobile these were two separate screens; on web they were behind an Overview
// tab and a Settlements tab.

import { useMemo } from "react";
import type { SettlementSuggestion } from "../../lib/settlementSuggestions";
import type { BalanceRow, Expense } from "../../types";

interface TripSummaryStripProps {
  balances: BalanceRow[];
  membersById: Record<string, string>;
  suggestions: SettlementSuggestion[];
  expenses: Expense[];
  currency: string;
  currentUserId?: string;
  onUseSuggestion: (suggestion: SettlementSuggestion) => void;
}

// Balances are cent-accurate, but float dust upstream can leave a few
// thousandths behind.
const SETTLED_EPSILON = 0.005;

const initialsOf = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("") || "?";

export const TripSummaryStrip = ({
  balances,
  membersById,
  suggestions,
  expenses,
  currency,
  currentUserId,
  onUseSuggestion
}: TripSummaryStripProps) => {
  const money = useMemo(
    () =>
      new Intl.NumberFormat(undefined, {
        style: "currency",
        currency,
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      }),
    [currency]
  );

  const mine = currentUserId
    ? balances.find((row) => row.memberId === currentUserId)
    : undefined;
  const net = mine?.balance ?? 0;
  const settled = Math.abs(net) < SETTLED_EPSILON;
  const owed = net > 0;

  // What you fronted versus what was actually yours — the two numbers the net
  // position is the difference between.
  const { paid, share } = useMemo(() => {
    if (!currentUserId) return { paid: 0, share: 0 };
    let paidTotal = 0;
    let shareTotal = 0;
    for (const expense of expenses) {
      if (expense.paidByMemberId === currentUserId) paidTotal += expense.total;
      for (const allocation of expense.allocations) {
        if (allocation.memberId === currentUserId) shareTotal += allocation.amount;
      }
    }
    return { paid: paidTotal, share: shareTotal };
  }, [expenses, currentUserId]);

  // Only the payments that involve you lead; the rest still matter but read
  // as context.
  const relevant = suggestions.filter(
    (s) => s.from === currentUserId || s.to === currentUserId
  );
  const shown = relevant.length > 0 ? relevant : suggestions;

  const nameOf = (memberId: string) => membersById[memberId] ?? "Someone";

  return (
    <section className="summary">
      <div className="position">
        <div className="position__line">
          {settled ? (
            <span className="position__figure position__figure--settled">
              All square
            </span>
          ) : (
            <>
              <span className="position__lead">
                {owed ? "You're owed" : "You owe"}
              </span>
              <span
                className={`position__figure ${
                  owed ? "position__figure--owed" : "position__figure--owe"
                }`}
              >
                {money.format(Math.abs(net))}
              </span>
            </>
          )}
        </div>
        {paid > 0 || share > 0 ? (
          <p className="position__note">
            You paid for {money.format(paid)} of this trip and your share was{" "}
            {money.format(share)}.
          </p>
        ) : (
          <p className="position__note">Nothing recorded against you yet.</p>
        )}
      </div>

      <div className="plan">
        {shown.length === 0 ? (
          <>
            <h3 className="plan__title">Nothing to settle</h3>
            <p className="position__note" style={{ marginTop: 0 }}>
              Everyone on this trip is square.
            </p>
          </>
        ) : (
          <>
            <h3 className="plan__title">
              {shown.length === 1
                ? "One payment clears this trip"
                : `${shown.length} payments clear this trip`}
            </h3>
            <ol className="plan__list">
              {shown.map((suggestion) => {
                const youPay = suggestion.from === currentUserId;
                const youReceive = suggestion.to === currentUserId;
                const other = youPay ? suggestion.to : suggestion.from;
                const otherName = nameOf(other);
                const label = youPay
                  ? `You pay ${otherName}`
                  : youReceive
                    ? `${otherName} pays you`
                    : `${nameOf(suggestion.from)} pays ${nameOf(suggestion.to)}`;
                return (
                  <li
                    key={`${suggestion.from}-${suggestion.to}-${suggestion.amount}`}
                    className="plan__row"
                  >
                    <span className="initial" aria-hidden="true">
                      {initialsOf(otherName)}
                    </span>
                    <span>{label}</span>
                    <span className="plan__amount">
                      {money.format(suggestion.amount)}
                    </span>
                    <span className="plan__action">
                      <button
                        type="button"
                        className="secondary btn-sm"
                        onClick={() => onUseSuggestion(suggestion)}
                      >
                        Record
                      </button>
                    </span>
                  </li>
                );
              })}
            </ol>
          </>
        )}
      </div>
    </section>
  );
};

export default TripSummaryStrip;
