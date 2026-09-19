// The number you actually came for, at the top of the page.
//
// The mobile app opens on a large running balance; web opened on an empty
// expense form and kept balances behind an Overview tab. This puts your net
// position back in front, with everyone else's as a quiet secondary row.

import { useMemo } from "react";
import type { BalanceRow } from "../../types";

interface TripBalanceStripProps {
  balances: BalanceRow[];
  currency: string;
  currentUserId?: string;
  onGoToSettle: () => void;
}

// Balances are cent-accurate but float arithmetic upstream can leave dust.
const SETTLED_EPSILON = 0.005;

export const TripBalanceStrip = ({
  balances,
  currency,
  currentUserId,
  onGoToSettle
}: TripBalanceStripProps) => {
  const formatCurrency = useMemo(
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
  const others = balances.filter((row) => row.memberId !== mine?.memberId);

  const net = mine?.balance ?? 0;
  const settled = Math.abs(net) < SETTLED_EPSILON;
  const owed = net > 0;

  const headline = settled
    ? "You're all square"
    : owed
      ? formatCurrency.format(net)
      : formatCurrency.format(Math.abs(net));

  const label = settled
    ? "Nothing outstanding"
    : owed
      ? "You are owed"
      : "You owe";

  const toneClass = settled
    ? "balance-strip__amount--settled"
    : owed
      ? "balance-strip__amount--owed"
      : "balance-strip__amount--owe";

  return (
    <section className="card">
      <div className="balance-strip">
        <div className="balance-strip__headline">
          <span className="balance-strip__label">{label}</span>
          <span className={`balance-strip__amount ${toneClass}`}>{headline}</span>
        </div>
        <button type="button" className="secondary" onClick={onGoToSettle}>
          Settle up
        </button>
      </div>

      {others.length > 0 && (
        <div className="cluster" style={{ marginTop: "var(--space-4)" }}>
          {others.map((row) => {
            const rowSettled = Math.abs(row.balance) < SETTLED_EPSILON;
            const rowOwed = row.balance > 0;
            return (
              <span
                key={row.memberId}
                className="chip"
                title={
                  rowSettled
                    ? `${row.displayName} is settled up`
                    : rowOwed
                      ? `${row.displayName} is owed ${formatCurrency.format(row.balance)}`
                      : `${row.displayName} owes ${formatCurrency.format(Math.abs(row.balance))}`
                }
              >
                {row.displayName}
                <strong
                  className="num"
                  style={{
                    color: rowSettled
                      ? "var(--text-dim)"
                      : rowOwed
                        ? "var(--positive)"
                        : "var(--warning)"
                  }}
                >
                  {rowSettled
                    ? "settled"
                    : formatCurrency.format(Math.abs(row.balance))}
                </strong>
              </span>
            );
          })}
        </div>
      )}
    </section>
  );
};

export default TripBalanceStrip;
