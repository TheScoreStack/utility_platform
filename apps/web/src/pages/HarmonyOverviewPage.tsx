import { useMemo } from "react";
import { Link } from "react-router-dom";
import HarmonySubNav from "../components/HarmonySubNav";
import { seedAvatar } from "../lib/avatarPalette";
import { useHarmonyLedgerAccess } from "../modules/useHarmonyLedgerAccess";
import { useHarmonyLedgerEntries } from "../modules/useHarmonyLedgerEntries";
import { useHarmonyLedgerOverview } from "../modules/useHarmonyLedgerOverview";
import { useHarmonyStatements } from "../modules/useHarmonyStatements";

const CURRENCY = "USD";

const formatCurrencyValue = (value: number) =>
  new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: CURRENCY,
    maximumFractionDigits: 2
  }).format(value);

const monthDateOf = (monthKey: string) => {
  const [year, month] = monthKey.split("-").map(Number);
  return new Date(year, month - 1, 1);
};

const formatMonthShort = (monthKey: string) =>
  new Intl.DateTimeFormat(undefined, { month: "short" }).format(
    monthDateOf(monthKey)
  );

const formatMonthLong = (monthKey: string) =>
  new Intl.DateTimeFormat(undefined, {
    month: "long",
    year: "numeric"
  }).format(monthDateOf(monthKey));

interface MonthBucket {
  monthKey: string;
  inflow: number;
  outflow: number;
  net: number;
}

const formatDateLong = (): string => {
  try {
    return new Intl.DateTimeFormat(undefined, {
      month: "long",
      day: "numeric",
      year: "numeric"
    }).format(new Date());
  } catch {
    return new Date().toDateString();
  }
};

const SkeletonHero = () => (
  <section className="hl-hero">
    <span className="hl-hero__eyebrow">Harmony Collective</span>
    <span
      className="skel"
      style={{ height: "4rem", width: "16rem", borderRadius: "14px", marginTop: "0.5rem" }}
    >
      &nbsp;
    </span>
    <span
      className="skel skel--text"
      style={{ width: "22rem", marginTop: "1rem" }}
    >
      &nbsp;
    </span>
  </section>
);

const HarmonyOverviewPage = () => {
  const { data, isLoading } = useHarmonyLedgerOverview();
  const { data: accessData } = useHarmonyLedgerAccess();
  const isAdmin = accessData?.isAdmin ?? false;
  // Statements and full entries are admin-only endpoints.
  const statementsQuery = useHarmonyStatements(isAdmin);
  const entriesQuery = useHarmonyLedgerEntries(isAdmin);

  const statements = statementsQuery.data?.statements;
  const pendingReview = useMemo(
    () =>
      (statements ?? []).reduce(
        (sum, statement) =>
          statement.status === "PARSED"
            ? sum + (statement.counts?.pending ?? 0)
            : sum,
        0
      ),
    [statements]
  );
  const failedCount = useMemo(
    () =>
      (statements ?? []).filter((statement) => statement.status === "FAILED")
        .length,
    [statements]
  );

  // Last 12 months of activity, bucketed by effective transaction date.
  const monthly = useMemo<MonthBucket[]>(() => {
    const entries = entriesQuery.data?.entries;
    if (!entries || entries.length === 0) return [];
    const buckets = new Map<string, { inflow: number; outflow: number }>();
    for (const entry of entries) {
      const monthKey = (entry.occurredAt ?? entry.recordedAt).slice(0, 7);
      const bucket = buckets.get(monthKey) ?? { inflow: 0, outflow: 0 };
      if (entry.type === "EXPENSE") {
        bucket.outflow += entry.amount;
      } else {
        bucket.inflow += entry.amount;
      }
      buckets.set(monthKey, bucket);
    }
    return [...buckets.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-12)
      .map(([monthKey, sums]) => ({
        monthKey,
        ...sums,
        net: sums.inflow - sums.outflow
      }));
  }, [entriesQuery.data]);

  const maxMonthlyFlow = useMemo(
    () =>
      monthly.reduce(
        (max, month) => Math.max(max, month.inflow, month.outflow),
        0
      ),
    [monthly]
  );

  const groupRows = useMemo(() => {
    if (!data) return [];
    return [...data.groups]
      .sort((a, b) => Math.abs(b.net) - Math.abs(a.net))
      .map((group) => {
        const inflow =
          group.donations +
          group.income +
          group.reimbursements +
          group.transfersIn;
        const outflow = group.expenses + group.transfersOut;
        return { ...group, inflow, outflow };
      });
  }, [data]);

  const maxAbsNet = useMemo(
    () => groupRows.reduce((m, g) => Math.max(m, Math.abs(g.net)), 0),
    [groupRows]
  );

  if (isLoading || !data) {
    return (
      <div className="hl-page">
        <HarmonySubNav />
        <SkeletonHero />
      </div>
    );
  }

  const { totals, unallocated, groups } = data;
  const totalInflow = totals.donations + totals.income;
  const totalOutflow = totals.expenses + totals.reimbursements;
  const surplusCount = groups.filter((g) => g.net > 0).length;
  const tone: "owed" | "owe" | "settled" =
    totals.net > 0.01 ? "owed" : totals.net < -0.01 ? "owe" : "settled";

  const latestMonth = monthly.length > 0 ? monthly[monthly.length - 1] : null;
  const latestTone: "owed" | "owe" | "settled" = latestMonth
    ? latestMonth.net > 0.01
      ? "owed"
      : latestMonth.net < -0.01
        ? "owe"
        : "settled"
    : "settled";

  return (
    <div className="hl-page">
      <HarmonySubNav />

      {isAdmin && (pendingReview > 0 || failedCount > 0) && (
        <Link
          to="/harmony-ledger/statements"
          className={`hl-nudge ov-rise${pendingReview === 0 ? " hl-nudge--failed" : ""}`}
        >
          <span className="hl-nudge__lines">
            {pendingReview > 0 && (
              <span className="hl-nudge__line">
                <strong>{pendingReview}</strong> imported{" "}
                {pendingReview === 1 ? "transaction" : "transactions"} awaiting
                review
              </span>
            )}
            {failedCount > 0 && (
              <span className="hl-nudge__line hl-nudge__line--failed">
                {failedCount}{" "}
                {failedCount === 1
                  ? "statement failed to parse — retry it"
                  : "statements failed to parse — retry them"}
              </span>
            )}
          </span>
          <span className="hl-nudge__cta">Open statements →</span>
        </Link>
      )}

      <section className={`hl-hero hl-hero--${tone} ov-rise ov-rise-1`}>
        <span className="hl-hero__eyebrow">
          Harmony Collective · {formatDateLong()}
        </span>
        <h1 className="hl-hero__title">
          The books, <em>open.</em>
        </h1>
        <p className="hl-hero__net">
          Net balance:&nbsp;
          <strong className={`hl-hero__net-value hl-hero__net-value--${tone}`}>
            {formatCurrencyValue(totals.net)}
          </strong>
        </p>
        <div className="hl-hero__rule" aria-hidden="true" />

        <div className="hl-stamps">
          <div className="hl-stamp hl-stamp--inflow">
            <span className="hl-stamp__label">Inflow</span>
            <span className="hl-stamp__value">{formatCurrencyValue(totalInflow)}</span>
          </div>
          <div className="hl-stamp hl-stamp--outflow">
            <span className="hl-stamp__label">Outflow</span>
            <span className="hl-stamp__value">{formatCurrencyValue(totalOutflow)}</span>
          </div>
          <div className="hl-stamp">
            <span className="hl-stamp__label">Unallocated</span>
            <span className="hl-stamp__value">{formatCurrencyValue(unallocated.net)}</span>
          </div>
          <div className="hl-stamp">
            <span className="hl-stamp__label">Groups</span>
            <span className="hl-stamp__value">
              {groups.length}
              {surplusCount > 0 && (
                <span className="hl-stamp__sub">
                  · {surplusCount} surplus
                </span>
              )}
            </span>
          </div>
        </div>

        {isAdmin && (
          <Link to="/harmony-ledger/ledger" className="hl-hero__cta">
            Open the ledger →
          </Link>
        )}
      </section>

      <section className="hl-section ov-rise ov-rise-2">
        <div className="hl-section-head">
          <h2 className="hl-section-head__title">Group balances</h2>
          <span className="hl-section-head__count">
            {groups.length} {groups.length === 1 ? "group" : "groups"}
          </span>
        </div>

        {groupRows.length === 0 ? (
          <div className="empty-state">
            <p className="empty-state__title">No groups yet.</p>
            <p className="empty-state__hint">
              Add an entry on the ledger and assign it to a group to see balances here.
            </p>
          </div>
        ) : (
          <div className="hl-group-list">
            {groupRows.map((group, idx) => {
              const palette = seedAvatar(group.groupId);
              const positive = group.net > 0.01;
              const negative = group.net < -0.01;
              const barWidth =
                maxAbsNet > 0
                  ? Math.min(100, (Math.abs(group.net) / maxAbsNet) * 100)
                  : 0;
              const tintClass = positive
                ? "hl-group--owed"
                : negative
                  ? "hl-group--owe"
                  : "hl-group--neutral";
              const cardInner = (
                <>
                  <div className="hl-group__head">
                    <span
                      className="hl-group__seal"
                      style={{ background: palette.bg, color: palette.fg }}
                      aria-hidden="true"
                    >
                      {(group.name || "?").slice(0, 1).toUpperCase()}
                    </span>
                    <div className="hl-group__id">
                      <h3 className="hl-group__name">{group.name}</h3>
                      <p className="hl-group__flows">
                        <span className="hl-group__flow hl-group__flow--in">
                          ↑ {formatCurrencyValue(group.inflow)}
                        </span>
                        <span className="hl-group__flow hl-group__flow--out">
                          ↓ {formatCurrencyValue(group.outflow)}
                        </span>
                      </p>
                    </div>
                    <span
                      className={`hl-group__net hl-group__net--${positive ? "owed" : negative ? "owe" : "neutral"}`}
                    >
                      {formatCurrencyValue(group.net)}
                    </span>
                  </div>
                  <div className="hl-group__bar">
                    <div
                      className={`hl-group__bar-fill hl-group__bar-fill--${positive ? "owed" : "owe"}`}
                      style={{ width: `${barWidth}%` }}
                    />
                  </div>
                </>
              );
              // Drill-down goes to the admin-only ledger; viewers get a
              // plain card.
              return isAdmin ? (
                <Link
                  key={group.groupId}
                  to={`/harmony-ledger/ledger?group=${encodeURIComponent(group.groupId)}`}
                  className={`hl-group ${tintClass}`}
                  style={{ animationDelay: `${0.08 * idx}s` }}
                >
                  {cardInner}
                </Link>
              ) : (
                <div
                  key={group.groupId}
                  className={`hl-group ${tintClass}`}
                  style={{ animationDelay: `${0.08 * idx}s` }}
                >
                  {cardInner}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {latestMonth && (
        <section className="hl-section ov-rise ov-rise-3">
          <div className="hl-section-head">
            <h2 className="hl-section-head__title">Monthly activity</h2>
            <span className="hl-section-head__count">
              last {monthly.length} {monthly.length === 1 ? "month" : "months"}
            </span>
          </div>
          <div className="hl-months">
            {monthly.map((month) => {
              const inHeight =
                maxMonthlyFlow > 0 ? (month.inflow / maxMonthlyFlow) * 100 : 0;
              const outHeight =
                maxMonthlyFlow > 0 ? (month.outflow / maxMonthlyFlow) * 100 : 0;
              return (
                <div
                  key={month.monthKey}
                  className="hl-months__col"
                  title={`${formatMonthLong(month.monthKey)} — in ${formatCurrencyValue(month.inflow)} · out ${formatCurrencyValue(month.outflow)} · net ${formatCurrencyValue(month.net)}`}
                >
                  <div className="hl-months__bars" aria-hidden="true">
                    <span
                      className="hl-months__bar hl-months__bar--in"
                      style={{ height: `${inHeight}%` }}
                    />
                    <span
                      className="hl-months__bar hl-months__bar--out"
                      style={{ height: `${outHeight}%` }}
                    />
                  </div>
                  <span className="hl-months__label">
                    {formatMonthShort(month.monthKey)}
                  </span>
                </div>
              );
            })}
          </div>
          <p className="hl-months__net">
            {formatMonthLong(latestMonth.monthKey)} net:&nbsp;
            <strong className={`hl-months__net-value hl-months__net-value--${latestTone}`}>
              {formatCurrencyValue(latestMonth.net)}
            </strong>
          </p>
        </section>
      )}
    </div>
  );
};

export default HarmonyOverviewPage;
