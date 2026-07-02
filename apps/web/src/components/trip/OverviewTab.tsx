import { useEffect, useMemo, useRef, useState } from "react";
import { CategoryBadge } from "../CategoryBadge";
import { convertCurrency } from "../../lib/fx";
import { formatDate } from "../../lib/tripFormat";
import type { SettlementSuggestion } from "../../lib/settlementSuggestions";
import { OvAvatar } from "./OvAvatar";
import { OvFlowArc } from "./OvFlowArc";
import { OvCategoryChart } from "./OvCategoryChart";
import type { BalanceRow, Expense, TripSummary } from "../../types";

interface OverviewTabProps {
  balances: BalanceRow[];
  membersById: Record<string, string>;
  settlementSuggestions: SettlementSuggestion[];
  currency: string;
  expenses: TripSummary["expenses"];
  currentUserId?: string;
  pendingSettlements: TripSummary["settlements"];
  onUseSuggestion: (suggestion: SettlementSuggestion) => void;
  onGoToSettlements: () => void;
}

export const OverviewTab = ({
  balances,
  membersById,
  settlementSuggestions,
  currency,
  expenses,
  currentUserId,
  pendingSettlements,
  onUseSuggestion,
  onGoToSettlements
}: OverviewTabProps) => {
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);
  const detailRef = useRef<HTMLDivElement | null>(null);
  const currencyFormatter = useMemo(
    () =>
      new Intl.NumberFormat(undefined, {
        style: "currency",
        currency,
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      }),
    [currency]
  );

  const expensesByMember = useMemo(() => {
    const map: Record<string, Array<{ expense: Expense; share: number; isPayer: boolean }>> = {};

    expenses.forEach((expense) => {
      expense.allocations.forEach((allocation) => {
        map[allocation.memberId] = map[allocation.memberId] ?? [];
        map[allocation.memberId].push({
          expense,
          share: allocation.amount,
          isPayer: expense.paidByMemberId === allocation.memberId
        });
      });

      if (!expense.allocations.some((allocation) => allocation.memberId === expense.paidByMemberId)) {
        map[expense.paidByMemberId] = map[expense.paidByMemberId] ?? [];
        map[expense.paidByMemberId].push({
          expense,
          share: 0,
          isPayer: true
        });
      }
    });

    return map;
  }, [expenses]);

  const selectedMemberExpenses = useMemo(
    () => (selectedMemberId ? expensesByMember[selectedMemberId] ?? [] : []),
    [expensesByMember, selectedMemberId]
  );

  const selectedMemberTotal = useMemo(
    () => selectedMemberExpenses.reduce((sum, entry) => sum + entry.share, 0),
    [selectedMemberExpenses]
  );

  const selectedMemberName = selectedMemberId ? membersById[selectedMemberId] ?? selectedMemberId : null;

  useEffect(() => {
    if (selectedMemberId && detailRef.current) {
      detailRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [selectedMemberId]);

  const groupTotalSpent = useMemo(
    () =>
      expenses.reduce(
        (sum, expense) =>
          sum +
          convertCurrency(
            expense.total ?? 0,
            expense.currency || currency,
            currency
          ),
        0
      ),
    [expenses, currency]
  );

  const hasMixedCurrencies = useMemo(
    () =>
      expenses.some(
        (expense) =>
          expense.currency && expense.currency !== currency
      ),
    [expenses, currency]
  );

  const currentUserBalance = useMemo(() => {
    if (!currentUserId) return null;
    const row = balances.find((balance) => balance.memberId === currentUserId);
    return row ? row.balance : null;
  }, [balances, currentUserId]);

  const currentUserUnsettledCount = useMemo(() => {
    if (!currentUserId) return pendingSettlements.length;
    return pendingSettlements.filter(
      (s) => s.fromMemberId === currentUserId || s.toMemberId === currentUserId
    ).length;
  }, [pendingSettlements, currentUserId]);

  const yourTotalShare = useMemo(() => {
    if (!currentUserId) return 0;
    let total = 0;
    expenses.forEach((expense) => {
      const expCurrency = expense.currency || currency;
      expense.allocations.forEach((allocation) => {
        if (allocation.memberId === currentUserId) {
          total += convertCurrency(allocation.amount, expCurrency, currency);
        }
      });
    });
    return total;
  }, [expenses, currentUserId, currency]);

  const maxAbsBalance = useMemo(
    () =>
      balances.reduce((max, balance) => Math.max(max, Math.abs(balance.balance)), 0),
    [balances]
  );

  const primarySuggestionForUser = useMemo(() => {
    if (!currentUserId) return settlementSuggestions[0] ?? null;
    const owes = settlementSuggestions
      .filter((s) => s.from === currentUserId)
      .sort((a, b) => b.amount - a.amount)[0];
    if (owes) return owes;
    const owed = settlementSuggestions
      .filter((s) => s.to === currentUserId)
      .sort((a, b) => b.amount - a.amount)[0];
    if (owed) return owed;
    return settlementSuggestions[0] ?? null;
  }, [settlementSuggestions, currentUserId]);

  const heroTone: "owe" | "owed" | "settled" =
    currentUserBalance === null || Math.abs(currentUserBalance) < 0.01
      ? "settled"
      : currentUserBalance > 0
        ? "owed"
        : "owe";

  const balanceStatus =
    currentUserBalance === null
      ? "you're not part of this trip"
      : Math.abs(currentUserBalance) < 0.01
        ? "all square — nothing to settle"
        : currentUserBalance > 0
          ? "you're owed"
          : "you owe";

  const balanceDisplay =
    currentUserBalance === null
      ? "—"
      : currencyFormatter.format(Math.abs(currentUserBalance));

  const settleUpDisabled = !primarySuggestionForUser;
  const handleSettleUpClick = () => {
    if (primarySuggestionForUser) {
      onUseSuggestion(primarySuggestionForUser);
    } else {
      onGoToSettlements();
    }
  };
  const settleUpLabel = !primarySuggestionForUser
    ? "All settled ✓"
    : primarySuggestionForUser.from === currentUserId
      ? `Settle ${currencyFormatter.format(primarySuggestionForUser.amount)} →`
      : primarySuggestionForUser.to === currentUserId
        ? "View settlements →"
        : "Settle group →";

  return (
    <div className="ov-grid">
      {/* ── HERO ─────────────────────────────────────────────── */}
      <section className={`ov-hero ov-hero--${heroTone} ov-rise ov-rise-1`}>
        <div className="ov-hero__top">
          <div className="ov-hero__lockup">
            <span className="ov-hero__eyebrow">Where you stand</span>
            <span className={`ov-hero__amount ov-hero__amount--${heroTone}`}>
              {balanceDisplay}
            </span>
            <span className="ov-hero__status">{balanceStatus}</span>
          </div>
          <button
            type="button"
            className={`ov-cta ov-cta--${heroTone}`}
            disabled={settleUpDisabled}
            onClick={handleSettleUpClick}
          >
            {settleUpLabel}
          </button>
        </div>

        <div className="ov-stamps">
          <div className="ov-stamp">
            <span className="ov-stamp__label">
              Group spent
              {hasMixedCurrencies && (
                <span
                  className="ov-stamp__fx"
                  title="Some expenses use other currencies — converted using approximate FX rates"
                >
                  {" "}· approx FX
                </span>
              )}
            </span>
            <span className="ov-stamp__value">
              {currencyFormatter.format(groupTotalSpent)}
            </span>
          </div>
          {currentUserId && (
            <div className="ov-stamp">
              <span className="ov-stamp__label">Your share</span>
              <span className="ov-stamp__value">
                {currencyFormatter.format(yourTotalShare)}
              </span>
            </div>
          )}
          <div className="ov-stamp">
            <span className="ov-stamp__label">Unsettled</span>
            <span className="ov-stamp__value">{currentUserUnsettledCount}</span>
          </div>
        </div>
      </section>

      {/* ── SUGGESTIONS (primary column) ─────────────────────── */}
      <section className="ov-rise ov-rise-2">
        <div className="ov-section-head">
          <h2>{settlementSuggestions.length === 0 ? "All settled up" : "Settle up"}</h2>
          {settlementSuggestions.length > 0 && (
            <span className="ov-todo-pill">
              {settlementSuggestions.length} {settlementSuggestions.length === 1 ? "payment" : "payments"}
            </span>
          )}
        </div>

        {settlementSuggestions.length === 0 ? (
          <div className="ov-celebration">
            <div className="ov-celebration__mark">✓</div>
            <p className="ov-celebration__text">The ledger is clear.</p>
          </div>
        ) : (
          <>
            <div className="ov-suggestion-list">
              {settlementSuggestions.map((suggestion, index) => {
                const isFromUser = currentUserId === suggestion.from;
                const isToUser = currentUserId === suggestion.to;
                const tone: "owe" | "owed" | "neutral" = isFromUser
                  ? "owe"
                  : isToUser
                    ? "owed"
                    : "neutral";
                const modifier = isFromUser
                  ? "ov-suggestion--owe-self"
                  : isToUser
                    ? "ov-suggestion--owed-self"
                    : "";
                const fromName = membersById[suggestion.from] ?? suggestion.from;
                const toName = membersById[suggestion.to] ?? suggestion.to;
                const actionClass =
                  tone === "owe"
                    ? "ov-suggestion__action--owe"
                    : tone === "owed"
                      ? "ov-suggestion__action--owed"
                      : "ov-suggestion__action--neutral";

                return (
                  <div
                    key={`${suggestion.from}-${suggestion.to}-${index}`}
                    className={`ov-suggestion ${modifier}`}
                  >
                    <div className="ov-suggestion__person">
                      <OvAvatar
                        name={fromName}
                        memberId={suggestion.from}
                        isSelf={isFromUser}
                      />
                      <div className="ov-suggestion__person-body">
                        <span className="ov-suggestion__role">
                          {isFromUser ? "You owe" : "Pays"}
                        </span>
                        <span className="ov-suggestion__name">
                          {isFromUser ? <em style={{ fontStyle: "italic", color: "#f8fafc" }}>You</em> : fromName}
                        </span>
                      </div>
                    </div>

                    <div className="ov-suggestion__flow">
                      <span className="ov-suggestion__amount">
                        {currencyFormatter.format(suggestion.amount)}
                      </span>
                      <div className="ov-suggestion__arc">
                        <OvFlowArc tone={tone} />
                      </div>
                      <span className="ov-suggestion__to">
                        to {isToUser ? <em>you</em> : toName}
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={() => onUseSuggestion(suggestion)}
                      className={`ov-suggestion__action ${actionClass}`}
                    >
                      Record →
                    </button>
                  </div>
                );
              })}
            </div>
            <p
              className="muted"
              style={{ marginTop: "0.85rem", fontSize: "0.82rem" }}
            >
              These payments would zero out the current balances.
            </p>
          </>
        )}
      </section>

      {/* ── BALANCES (recessive column) ──────────────────────── */}
      <section className="ov-rise ov-rise-3">
        <div className="ov-section-head">
          <h2>Balances</h2>
          <span className="muted" style={{ fontSize: "0.82rem" }}>
            {balances.length} {balances.length === 1 ? "person" : "people"}
          </span>
        </div>

        {balances.length === 0 ? (
          <p className="muted" style={{ fontStyle: "italic" }}>
            Add expenses to see how the ledger shakes out.
          </p>
        ) : (
          <div className="ov-balance-list">
            {balances.map((balance) => {
              const isSelf = balance.memberId === currentUserId;
              const isSelected = selectedMemberId === balance.memberId;
              const memberName = membersById[balance.memberId] ?? balance.memberId;
              const isZero = Math.abs(balance.balance) < 0.01;
              const positive = balance.balance > 0;
              const barWidth =
                maxAbsBalance > 0
                  ? Math.min(100, (Math.abs(balance.balance) / maxAbsBalance) * 100)
                  : 0;
              const amountClass = isZero
                ? "ov-balance-row__amount--zero"
                : positive
                  ? "ov-balance-row__amount--owed"
                  : "ov-balance-row__amount--owe";

              return (
                <button
                  key={balance.memberId}
                  type="button"
                  onClick={() =>
                    setSelectedMemberId((current) =>
                      current === balance.memberId ? null : balance.memberId
                    )
                  }
                  className={`ov-balance-row ${isSelected ? "ov-balance-row--selected" : ""}`}
                >
                  <OvAvatar
                    name={memberName}
                    memberId={balance.memberId}
                    size="sm"
                    isSelf={isSelf}
                  />
                  <div className="ov-balance-row__body">
                    <span className="ov-balance-row__name">
                      {memberName}
                      {isSelf && <span className="ov-balance-row__self">· you</span>}
                    </span>
                    <div className="ov-balance-row__bar">
                      <div
                        className="ov-balance-row__bar-fill"
                        style={{
                          width: `${barWidth}%`,
                          left: 0,
                          background: isZero
                            ? "rgba(148,163,184,0.3)"
                            : positive
                              ? "linear-gradient(90deg, var(--owed) 0%, rgba(52,211,153,0.55) 100%)"
                              : "linear-gradient(90deg, var(--owe) 0%, rgba(251,146,60,0.55) 100%)"
                        }}
                      />
                    </div>
                  </div>
                  <span className={`ov-balance-row__amount ${amountClass}`}>
                    {isZero
                      ? "0.00"
                      : `${positive ? "+" : "−"}${currencyFormatter.format(Math.abs(balance.balance))}`}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {selectedMemberId && (
          <div className="ov-detail" ref={detailRef}>
            <div className="ov-detail__head">
              <h3 className="ov-detail__name">{selectedMemberName}</h3>
              <span className="muted" style={{ fontSize: "0.82rem" }}>
                {selectedMemberExpenses.length} items · {currencyFormatter.format(selectedMemberTotal)}
              </span>
            </div>
            {selectedMemberExpenses.length === 0 ? (
              <p className="muted" style={{ margin: 0, fontStyle: "italic" }}>
                Nothing allocated to this person yet.
              </p>
            ) : (
              <div className="ov-detail__list">
                {selectedMemberExpenses.map(({ expense, share, isPayer }) => (
                  <div key={expense.expenseId} className="ov-detail__item">
                    <div className="ov-detail__item-body">
                      <span className="ov-detail__item-title">{expense.description}</span>
                      <span className="ov-detail__item-meta">
                        {formatDate(expense.createdAt)} · Paid by{" "}
                        {membersById[expense.paidByMemberId] ?? expense.paidByMemberId}
                      </span>
                      {expense.category && (
                        <div style={{ marginTop: "0.25rem" }}>
                          <CategoryBadge category={expense.category} />
                        </div>
                      )}
                    </div>
                    <div className="ov-detail__item-right">
                      <span
                        className={`ov-detail__share ${share > 0 ? "" : "ov-detail__share--zero"}`}
                      >
                        {share > 0 ? currencyFormatter.format(share) : "no share"}
                      </span>
                      <span className="muted" style={{ fontSize: "0.76rem" }}>
                        of {currencyFormatter.format(expense.total)}
                      </span>
                      {isPayer && (
                        <span
                          className="pill"
                          style={{
                            background: "rgba(56,189,248,0.16)",
                            color: "#bae6fd",
                            fontSize: "0.7rem",
                            marginTop: "0.2rem"
                          }}
                        >
                          Payer
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <OvCategoryChart
          expenses={expenses}
          totalSpent={groupTotalSpent}
          currencyFormatter={currencyFormatter}
        />
      </section>
    </div>
  );
};
