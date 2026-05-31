import { useMemo } from "react";
import { Link } from "react-router-dom";
import HarmonySubNav from "../components/HarmonySubNav";
import { seedAvatar } from "../lib/avatarPalette";
import { useHarmonyLedgerOverview } from "../modules/useHarmonyLedgerOverview";

const CURRENCY = "USD";

const formatCurrencyValue = (value: number) =>
  new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: CURRENCY,
    maximumFractionDigits: 2
  }).format(value);

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

  return (
    <div className="hl-page">
      <HarmonySubNav />

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

        <Link to="/harmony-ledger/ledger" className="hl-hero__cta">
          Open the ledger →
        </Link>
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
              return (
                <article
                  key={group.groupId}
                  className={`hl-group ${tintClass}`}
                  style={{ animationDelay: `${0.08 * idx}s` }}
                >
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
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
};

export default HarmonyOverviewPage;
