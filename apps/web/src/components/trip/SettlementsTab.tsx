import { useMemo, useState } from "react";
import SettlementForm, { type SettlementPrefill } from "../SettlementForm";
import { formatDate } from "../../lib/tripFormat";
import { buildPaymentLink } from "../../lib/paymentLinks";
import type { SettlementSuggestion } from "../../lib/settlementSuggestions";
import { OvAvatar } from "./OvAvatar";
import { OvFlowArc } from "./OvFlowArc";
import { RecentlyDeletedList } from "./RecentlyDeletedList";
import type { BalanceRow, PaymentMethods, Settlement, TripSummary } from "../../types";

interface SettlementsTabProps {
  currency: string;
  members: TripSummary["members"];
  settlements: TripSummary["settlements"];
  pendingSettlements: TripSummary["settlements"];
  balances: BalanceRow[];
  settlementSuggestions: SettlementSuggestion[];
  onRecord: (payload: {
    fromMemberId: string;
    toMemberId: string;
    amount: number;
    note?: string;
  }) => Promise<unknown>;
  isRecording: boolean;
  onConfirm: (settlementId: string, confirmed: boolean) => void;
  confirmPending: boolean;
  membersById: Record<string, string>;
  onDelete: (settlementId: string, label: string) => Promise<void>;
  deletePending: boolean;
  deletingSettlementId?: string;
  onUpdate: (
    settlementId: string,
    amount: number,
    note: string
  ) => Promise<unknown>;
  updatePending: boolean;
  currentUserId?: string;
  ownerId: string;
  paymentMethodsByMember: Record<string, PaymentMethods>;
  prefill?: SettlementPrefill | null;
  onPrefillConsumed?: () => void;
  deletedSettlements: Settlement[];
  onRestoreSettlement: (settlementId: string) => Promise<void>;
  onPurgeSettlement: (settlementId: string) => Promise<void>;
  restoringSettlementId?: string;
  purgingSettlementId?: string;
}

interface StlPayChipProps {
  method: string;
  value: string;
  href?: string | null;
}

const StlPayChip = ({ method, value, href }: StlPayChipProps) => {
  const [copied, setCopied] = useState(false);

  if (href) {
    return (
      <a
        className="stl-row__pay-method"
        href={href}
        target="_blank"
        rel="noreferrer noopener"
        title={`Open ${method} with the amount prefilled`}
      >
        <span className="stl-row__pay-key">{method}</span>
        <span>{value} ↗</span>
      </a>
    );
  }

  return (
    <button
      type="button"
      className={`stl-row__pay-method ${copied ? "stl-row__pay-method--copied" : ""}`}
      title={`Copy ${value}`}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1400);
        } catch {
          // clipboard write blocked — non-fatal
        }
      }}
    >
      <span className="stl-row__pay-key">{method}</span>
      <span>{copied ? "✓ copied" : value}</span>
    </button>
  );
};

export const SettlementsTab = ({
  currency,
  members,
  settlements,
  pendingSettlements,
  balances,
  settlementSuggestions,
  onRecord,
  isRecording,
  onConfirm,
  confirmPending,
  membersById,
  onDelete,
  deletePending,
  deletingSettlementId,
  onUpdate,
  updatePending,
  currentUserId,
  ownerId,
  paymentMethodsByMember,
  prefill,
  onPrefillConsumed,
  deletedSettlements,
  onRestoreSettlement,
  onPurgeSettlement,
  restoringSettlementId,
  purgingSettlementId
}: SettlementsTabProps) => {
  const settlementAmountFormatter = useMemo(
    () =>
      new Intl.NumberFormat(undefined, {
        style: "currency",
        currency,
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      }),
    [currency]
  );

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editAmount, setEditAmount] = useState("");
  const [editNote, setEditNote] = useState("");
  const [editError, setEditError] = useState<string | null>(null);

  const startEditing = (settlement: Settlement) => {
    setEditingId(settlement.settlementId);
    setEditAmount(settlement.amount.toFixed(2));
    setEditNote(settlement.note ?? "");
    setEditError(null);
  };

  const saveEdit = async (settlementId: string) => {
    const amount = Number.parseFloat(editAmount.replace(",", "."));
    if (!Number.isFinite(amount) || amount <= 0) {
      setEditError("Enter an amount greater than zero.");
      return;
    }
    try {
      await onUpdate(settlementId, Math.round(amount * 100) / 100, editNote.trim());
      setEditingId(null);
    } catch (error) {
      setEditError(
        error instanceof Error ? error.message : "Could not save the changes."
      );
    }
  };

  return (
    <div className="grid-two">
      <section className="card">
        <div className="section-title">
          <h2>Record Settlement</h2>
        </div>
        <SettlementForm
          members={members}
          currency={currency}
          isSubmitting={isRecording}
          onSubmit={onRecord}
          currentUserId={currentUserId}
          paymentMethods={paymentMethodsByMember}
          memberBalances={Object.fromEntries(balances.map((balance) => [balance.memberId, balance.balance]))}
          settlementSuggestions={settlementSuggestions}
          prefill={prefill}
          onPrefillConsumed={onPrefillConsumed}
        />
      </section>

      <section className="card" style={{ gridColumn: "1 / -1" }}>
        <div className="section-title">
          <h2>Settlement History</h2>
          <span className="muted">{settlements.length} recorded</span>
        </div>
        {settlements.length === 0 ? (
          <p className="muted" style={{ fontStyle: "italic" }}>
            No settlements recorded yet.
          </p>
        ) : (
          <div className="list">
            {settlements.map((settlement) => {
              const fromName = membersById[settlement.fromMemberId] ?? settlement.fromMemberId;
              const toName = membersById[settlement.toMemberId] ?? settlement.toMemberId;
              const isFromUser = currentUserId === settlement.fromMemberId;
              const isToUser = currentUserId === settlement.toMemberId;
              const confirmed = Boolean(settlement.confirmedAt);
              const rowModifier = !confirmed && isFromUser
                ? "stl-row--owe-self"
                : !confirmed && isToUser
                  ? "stl-row--owed-self"
                  : "";
              const recipientMethods = paymentMethodsByMember[settlement.toMemberId];
              const payableMethods = recipientMethods
                ? (Object.entries(recipientMethods).filter(([, v]) => Boolean(v)) as Array<[string, string]>)
                : [];
              const showPayPanel =
                !confirmed && isFromUser && payableMethods.length > 0;

              // Mirrors the server rules: participants, whoever recorded it,
              // or the trip owner can edit/delete; confirming is for the
              // participants or the owner.
              const isOwner = currentUserId === ownerId;
              const canModify =
                isFromUser ||
                isToUser ||
                isOwner ||
                currentUserId === settlement.createdBy;
              const canConfirm = isFromUser || isToUser || isOwner;
              const isEditing = editingId === settlement.settlementId;

              const confirmLabel = isFromUser
                ? "I paid this"
                : isToUser
                  ? "Confirm received"
                  : "Mark confirmed";
              const confirmModifier = isFromUser
                ? "stl-confirm--sender"
                : isToUser
                  ? "stl-confirm--receiver"
                  : "stl-confirm--third";

              return (
                <div key={settlement.settlementId} className={`stl-row ${rowModifier}`}>
                  <div className="stl-row__head">
                    <div className="stl-row__person">
                      <OvAvatar
                        name={fromName}
                        memberId={settlement.fromMemberId}
                        size="sm"
                        isSelf={isFromUser}
                      />
                      <div className="stl-row__person-body">
                        <span className="stl-row__role">{confirmed ? "Paid" : "Owes"}</span>
                        <span className="stl-row__name">
                          {isFromUser ? <em style={{ fontStyle: "italic", color: "#f8fafc" }}>You</em> : fromName}
                        </span>
                      </div>
                    </div>

                    <div className="stl-row__center">
                      <span
                        className={`stl-row__amount ${confirmed ? "stl-row__amount--confirmed" : ""}`}
                      >
                        {settlementAmountFormatter.format(settlement.amount)}
                      </span>
                      <div className="stl-row__arc">
                        <OvFlowArc tone={confirmed ? "owed" : isFromUser ? "owe" : isToUser ? "owed" : "neutral"} />
                      </div>
                    </div>

                    <div className="stl-row__person stl-row__person--to">
                      <div className="stl-row__person-body">
                        <span className="stl-row__role">{confirmed ? "Received" : "To"}</span>
                        <span className="stl-row__name">
                          {isToUser ? <em style={{ fontStyle: "italic", color: "#f8fafc" }}>You</em> : toName}
                        </span>
                      </div>
                      <OvAvatar
                        name={toName}
                        memberId={settlement.toMemberId}
                        size="sm"
                        isSelf={isToUser}
                      />
                    </div>
                  </div>

                  {settlement.note && (
                    <p className="stl-row__note">“{settlement.note}”</p>
                  )}

                  <div className="stl-row__meta">
                    <span className={`stl-row__status stl-row__status--${confirmed ? "confirmed" : "pending"}`}>
                      <span className="stl-row__status-dot" />
                      {confirmed ? "Confirmed" : "Pending"}
                    </span>
                    <span>Recorded {formatDate(settlement.createdAt)}</span>
                    {confirmed && settlement.confirmedAt && (
                      <span>· Confirmed {formatDate(settlement.confirmedAt)}</span>
                    )}
                  </div>

                  {showPayPanel && (
                    <div className="stl-row__pay-panel">
                      <span className="stl-row__pay-label">Pay {toName} via</span>
                      <div className="stl-row__pay-methods">
                        {payableMethods.map(([method, value]) => (
                          <StlPayChip
                            key={method}
                            method={method}
                            value={value}
                            href={buildPaymentLink(
                              method,
                              value,
                              settlement.amount,
                              settlement.currency || currency,
                              settlement.note || "Settle up"
                            )}
                          />
                        ))}
                      </div>
                    </div>
                  )}

                  {isEditing ? (
                    <div
                      className="stl-row__actions"
                      style={{ flexWrap: "wrap", gap: "0.5rem", alignItems: "center" }}
                    >
                      <input
                        type="text"
                        inputMode="decimal"
                        value={editAmount}
                        onChange={(event) => setEditAmount(event.target.value)}
                        aria-label="Amount"
                        style={{ width: "6.5rem" }}
                      />
                      <input
                        type="text"
                        value={editNote}
                        onChange={(event) => setEditNote(event.target.value)}
                        placeholder="Note (optional)"
                        aria-label="Note"
                        style={{ flex: "1 1 10rem", minWidth: "8rem" }}
                      />
                      <button
                        type="button"
                        className="primary"
                        disabled={updatePending}
                        onClick={() => {
                          void saveEdit(settlement.settlementId);
                        }}
                      >
                        {updatePending ? "Saving…" : "Save"}
                      </button>
                      <button
                        type="button"
                        className="secondary"
                        disabled={updatePending}
                        onClick={() => setEditingId(null)}
                      >
                        Cancel
                      </button>
                      {confirmed && (
                        <span className="muted" style={{ fontSize: "0.8rem", width: "100%" }}>
                          Changing the amount resets the confirmation — it will
                          need to be confirmed again.
                        </span>
                      )}
                      {editError && (
                        <span style={{ color: "#fca5a5", fontSize: "0.8rem", width: "100%" }}>
                          {editError}
                        </span>
                      )}
                    </div>
                  ) : (
                    <div className="stl-row__actions">
                      {!confirmed && canConfirm && (
                        <button
                          type="button"
                          className={`stl-confirm ${confirmModifier}`}
                          disabled={confirmPending}
                          onClick={() => onConfirm(settlement.settlementId, true)}
                        >
                          {confirmLabel}
                        </button>
                      )}
                      {confirmed && canConfirm && (
                        <button
                          type="button"
                          className="secondary"
                          disabled={confirmPending}
                          onClick={() => onConfirm(settlement.settlementId, false)}
                        >
                          Mark pending
                        </button>
                      )}
                      {canModify && (
                        <>
                          <button
                            type="button"
                            className="secondary"
                            title="Change the amount or note"
                            onClick={() => startEditing(settlement)}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className="secondary"
                            disabled={deletePending && deletingSettlementId === settlement.settlementId}
                            title="Move to Recently deleted (undoable for now)"
                            onClick={() => {
                              onDelete(settlement.settlementId, `${fromName} → ${toName}`).catch(() => {});
                            }}
                          >
                            Delete
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
        {pendingSettlements.length > 0 && (
          <p className="muted" style={{ marginTop: "1rem", fontSize: "0.85rem" }}>
            Pending settlements reduce balances once confirmed.
          </p>
        )}
        <RecentlyDeletedList
          label="Settlements"
          emptyHint={`${deletedSettlements.length} item${deletedSettlements.length === 1 ? "" : "s"}`}
          items={deletedSettlements.map((settlement) => {
            const from = membersById[settlement.fromMemberId] ?? settlement.fromMemberId;
            const to = membersById[settlement.toMemberId] ?? settlement.toMemberId;
            return {
              id: settlement.settlementId,
              title: (
                <>
                  <strong>{settlementAmountFormatter.format(settlement.amount)}</strong> · {from} → {to}
                </>
              ),
              meta: `Deleted ${settlement.deletedAt ? formatDate(settlement.deletedAt) : ""}`
            };
          })}
          onRestore={onRestoreSettlement}
          onPurge={onPurgeSettlement}
          restoringId={restoringSettlementId}
          purgingId={purgingSettlementId}
        />
      </section>
    </div>
  );
};
