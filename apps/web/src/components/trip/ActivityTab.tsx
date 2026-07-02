import { ReactNode, useCallback, useMemo } from "react";
import { resolveExpenseCategory } from "../../lib/expenseCategories";
import { formatDayLabel, formatTime, localDayKey } from "../../lib/tripFormat";
import { OvAvatar } from "./OvAvatar";
import type { TripSummary } from "../../types";

type ActivityKind =
  | "expense_added"
  | "expense_edited"
  | "settlement_recorded"
  | "settlement_confirmed"
  | "member_added";

interface ActivityEvent {
  id: string;
  timestamp: string;
  actorId: string;
  actorName: string;
  kind: ActivityKind;
  amount?: number;
  amountTone?: "positive" | "negative" | "neutral";
  body: ReactNode;
  iconChar: string;
  tone: "owe" | "owed" | "neutral";
}

interface ActivityTabProps {
  expenses: TripSummary["expenses"];
  settlements: TripSummary["settlements"];
  members: TripSummary["members"];
  membersById: Record<string, string>;
  currency: string;
  currentUserId?: string;
}

export const ActivityTab = ({
  expenses,
  settlements,
  members,
  membersById,
  currency,
  currentUserId
}: ActivityTabProps) => {
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

  const nameOf = useCallback(
    (memberId: string): string => {
      if (memberId === currentUserId) return "You";
      return membersById[memberId] ?? "Someone";
    },
    [membersById, currentUserId]
  );

  const events = useMemo<ActivityEvent[]>(() => {
    const acc: ActivityEvent[] = [];

    expenses.forEach((expense) => {
      const actor = expense.paidByMemberId;
      const actorName = nameOf(actor);
      const resolved = resolveExpenseCategory(expense.category);
      acc.push({
        id: `exp-added-${expense.expenseId}`,
        timestamp: expense.createdAt,
        actorId: actor,
        actorName,
        kind: "expense_added",
        amount: expense.total,
        amountTone: "neutral",
        iconChar: resolved?.icon ?? "🧾",
        tone: "neutral",
        body: (
          <>
            <strong>{actorName}</strong> added{" "}
            <span className="act-amount">{currencyFormatter.format(expense.total)}</span>{" "}
            <em style={{ fontStyle: "italic" }}>“{expense.description}”</em>
            {resolved ? <> · {resolved.label}</> : null}
          </>
        )
      });

      if (
        expense.updatedAt &&
        expense.updatedAt !== expense.createdAt
      ) {
        acc.push({
          id: `exp-edited-${expense.expenseId}`,
          timestamp: expense.updatedAt,
          actorId: actor,
          actorName,
          kind: "expense_edited",
          iconChar: "✎",
          tone: "neutral",
          body: (
            <>
              <strong>{actorName}</strong> edited{" "}
              <em style={{ fontStyle: "italic" }}>“{expense.description}”</em>
            </>
          )
        });
      }
    });

    settlements.forEach((settlement) => {
      const fromName = nameOf(settlement.fromMemberId);
      const toName = nameOf(settlement.toMemberId);
      const involvesMe =
        currentUserId === settlement.fromMemberId || currentUserId === settlement.toMemberId;
      const recordedTone: "owe" | "owed" | "neutral" =
        currentUserId === settlement.fromMemberId
          ? "owe"
          : currentUserId === settlement.toMemberId
            ? "owed"
            : "neutral";
      acc.push({
        id: `stl-rec-${settlement.settlementId}`,
        timestamp: settlement.createdAt,
        actorId: settlement.createdBy ?? settlement.fromMemberId,
        actorName: nameOf(settlement.createdBy ?? settlement.fromMemberId),
        kind: "settlement_recorded",
        amount: settlement.amount,
        iconChar: "→",
        tone: recordedTone,
        body: (
          <>
            <strong>{fromName}</strong> {involvesMe && fromName === "You" ? "marked paying" : "paid"}{" "}
            <strong>{toName}</strong>{" "}
            <span className="act-amount">{currencyFormatter.format(settlement.amount)}</span>
            {!settlement.confirmedAt ? <> · <em style={{ color: "var(--owe)" }}>pending</em></> : null}
          </>
        )
      });

      if (settlement.confirmedAt) {
        const confirmedBy = settlement.toMemberId;
        acc.push({
          id: `stl-conf-${settlement.settlementId}`,
          timestamp: settlement.confirmedAt,
          actorId: confirmedBy,
          actorName: nameOf(confirmedBy),
          kind: "settlement_confirmed",
          amount: settlement.amount,
          iconChar: "✓",
          tone: "owed",
          body: (
            <>
              <strong>{nameOf(confirmedBy)}</strong> confirmed receiving{" "}
              <span className="act-amount act-amount--positive">
                {currencyFormatter.format(settlement.amount)}
              </span>{" "}
              from <strong>{fromName}</strong>
            </>
          )
        });
      }
    });

    members.forEach((member) => {
      if (member.addedBy && member.addedBy !== member.memberId) {
        acc.push({
          id: `mem-${member.memberId}`,
          timestamp: member.createdAt,
          actorId: member.addedBy,
          actorName: nameOf(member.addedBy),
          kind: "member_added",
          iconChar: "+",
          tone: "neutral",
          body: (
            <>
              <strong>{nameOf(member.addedBy)}</strong> added{" "}
              <strong>{nameOf(member.memberId)}</strong> to the group
            </>
          )
        });
      }
    });

    return acc.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  }, [expenses, settlements, members, currencyFormatter, nameOf, currentUserId]);

  const eventsByDay = useMemo(() => {
    const groups = new Map<string, { dayKey: string; ref: string; events: ActivityEvent[] }>();
    events.forEach((event) => {
      const dayKey = localDayKey(event.timestamp);
      const g = groups.get(dayKey);
      if (g) g.events.push(event);
      else groups.set(dayKey, { dayKey, ref: event.timestamp, events: [event] });
    });
    return Array.from(groups.values());
  }, [events]);

  if (events.length === 0) {
    return (
      <section className="card">
        <div className="act-empty">
          <div className="act-empty__mark">∼</div>
          <p className="act-empty__title">Nothing&rsquo;s happened yet.</p>
          <p className="act-empty__hint">
            Add an expense or record a settlement and it&rsquo;ll show up here.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="card">
      <div className="section-title">
        <h2>Activity</h2>
        <span className="muted" style={{ fontSize: "0.85rem" }}>
          {events.length} {events.length === 1 ? "event" : "events"}
        </span>
      </div>
      <div className="act-wrap">
        {eventsByDay.map((day) => {
          const label = formatDayLabel(day.ref);
          return (
            <div key={day.dayKey} className="act-day">
              <div className="act-day__header">
                <span className="act-day__date">
                  {label.primary}
                  {label.secondary && (
                    <small style={{ fontFamily: "Inter, sans-serif", fontStyle: "normal", fontSize: "0.75rem", color: "#64748b", letterSpacing: "0.06em", textTransform: "uppercase", marginLeft: "0.55rem", fontWeight: 500 }}>
                      {label.secondary}
                    </small>
                  )}
                </span>
                <span className="act-day__meta">
                  {day.events.length} {day.events.length === 1 ? "event" : "events"}
                </span>
              </div>
              <div className="act-list">
                {day.events.map((event) => (
                  <div key={event.id} className={`act-row act-row--${event.tone}`}>
                    <OvAvatar
                      name={event.actorName}
                      memberId={event.actorId}
                      size="sm"
                      isSelf={event.actorId === currentUserId}
                    />
                    <div className="act-row__body">
                      <span className="act-row__line">{event.body}</span>
                      <span className="act-row__sub">
                        <span className="act-row__kind-icon" aria-hidden="true">
                          {event.iconChar}
                        </span>
                        {event.kind === "expense_added"
                          ? "expense added"
                          : event.kind === "expense_edited"
                            ? "expense edited"
                            : event.kind === "settlement_recorded"
                              ? "settlement recorded"
                              : event.kind === "settlement_confirmed"
                                ? "settlement confirmed"
                                : "member added"}
                      </span>
                    </div>
                    <span className="act-row__time">{formatTime(event.timestamp)}</span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
};
