import { CategoryBadge } from "../CategoryBadge";
import ExpenseCommentsThread from "../ExpenseCommentsThread";
import { formatDate } from "../../lib/tripFormat";
import type { Expense } from "../../types";

export type ReceiptPreviewData = { url: string; title: string; type: string | null };

const sharedLabel = (count: number) =>
  `Shared with ${count} ${count === 1 ? "person" : "people"}`;

interface ExpenseCardProps {
  expense: Expense;
  tripId: string;
  membersById: Record<string, string>;
  formatCurrency: Intl.NumberFormat;
  currentUserId?: string;
  isTripOwner: boolean;
  commentsOpen: boolean;
  onToggleComments: () => void;
  onRepeatExpense: (expense: Expense) => void;
  onEditExpense: (expense: Expense) => void;
  onDeleteExpense: (expenseId: string, description: string) => Promise<void>;
  deleteDisabled: boolean;
  previewData?: ReceiptPreviewData;
  isLoadingPreview: boolean;
  receiptStatus?: string;
  hasReceiptStorage: boolean;
  onViewReceipt: (receiptId: string) => void;
}

export const ExpenseCard = ({
  expense,
  tripId,
  membersById,
  formatCurrency,
  currentUserId,
  isTripOwner,
  commentsOpen,
  onToggleComments,
  onRepeatExpense,
  onEditExpense,
  onDeleteExpense,
  deleteDisabled,
  previewData,
  isLoadingPreview,
  receiptStatus,
  hasReceiptStorage,
  onViewReceipt
}: ExpenseCardProps) => {
  // Mirrors the server's ownership rule: the person who entered the expense
  // (payer for legacy expenses without createdBy) or the trip owner.
  const canModify =
    isTripOwner ||
    (expense.createdBy
      ? expense.createdBy === currentUserId
      : expense.paidByMemberId === currentUserId);

  const badges: string[] = [];
  if (typeof expense.tax === "number" && expense.tax > 0) {
    badges.push(`Tax ${formatCurrency.format(expense.tax)}`);
  }
  if (typeof expense.tip === "number" && expense.tip > 0) {
    badges.push(`Tip ${formatCurrency.format(expense.tip)}`);
  }

  return (
    <div
      className="card"
      style={{
        padding: "1.35rem 1.6rem",
        borderRadius: "1.1rem",
        border: "1px solid rgba(148,163,184,0.12)",
        background: "var(--surface-2)",
        display: "flex",
        flexDirection: "column",
        gap: "1rem"
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: "1rem",
          flexWrap: "wrap"
        }}
      >
        <div>
          <h3 style={{ margin: 0, fontSize: "1.15rem", fontWeight: 600 }}>
            {expense.description}
          </h3>
          <p className="muted" style={{ marginTop: "0.45rem" }}>
            {formatDate(expense.createdAt)} · Paid by {membersById[expense.paidByMemberId] ?? expense.paidByMemberId}
          </p>
        </div>
        <div style={{ textAlign: "right" }}>
          <span style={{ fontSize: "1.45rem", fontWeight: 700 }}>
            {formatCurrency.format(expense.total)}
          </span>
        </div>
      </div>

      {(expense.vendor || expense.category || badges.length > 0) && (
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "0.5rem"
          }}
        >
          {expense.vendor && (
            <span className="pill" style={{ background: "rgba(59,130,246,0.14)", color: "#bfdbfe" }}>
              Vendor • {expense.vendor}
            </span>
          )}
          {expense.category && <CategoryBadge category={expense.category} />}
          {badges.map((badge) => (
            <span key={badge} className="pill" style={{ background: "rgba(148,163,184,0.14)", color: "#e2e8f0" }}>
              {badge}
            </span>
          ))}
        </div>
      )}

      {expense.lineItems && expense.lineItems.length > 0 && (
        <details
          style={{
            border: "1px solid rgba(148,163,184,0.14)",
            borderRadius: "0.75rem",
            padding: "0.55rem 0.8rem",
            background: "var(--inset)"
          }}
        >
          <summary
            className="muted"
            style={{ cursor: "pointer", fontSize: "0.88rem" }}
          >
            {expense.lineItems.length}{" "}
            {expense.lineItems.length === 1 ? "item" : "items"} · split by
            item
            {expense.extrasSplitMode === "even"
              ? " · tax & tip split evenly"
              : " · tax & tip proportional"}
          </summary>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "0.45rem",
              marginTop: "0.6rem"
            }}
          >
            {expense.lineItems.map((item) => (
              <div
                key={item.lineItemId}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: "0.75rem",
                  alignItems: "baseline"
                }}
              >
                <span style={{ fontSize: "0.88rem" }}>
                  {item.description}
                  {typeof item.quantity === "number" &&
                    item.quantity > 1 && (
                      <span className="muted"> ×{item.quantity}</span>
                    )}
                  <span
                    className="muted"
                    style={{ fontSize: "0.78rem", marginLeft: "0.4rem" }}
                  >
                    {item.assignedMemberIds
                      .map(
                        (memberId) =>
                          (membersById[memberId] ?? memberId).split(
                            /\s+/
                          )[0]
                      )
                      .join(", ")}
                  </span>
                </span>
                <span style={{ fontSize: "0.88rem", fontWeight: 600 }}>
                  {formatCurrency.format(item.total)}
                </span>
              </div>
            ))}
          </div>
        </details>
      )}

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "0.6rem"
        }}
      >
        {expense.allocations.map((allocation) => (
          <div
            key={allocation.memberId}
            className="pill"
            style={{
              background: "rgba(71,85,105,0.35)",
              color: "#f1f5f9",
              display: "inline-flex",
              alignItems: "center",
              gap: "0.45rem",
              padding: "0.35rem 0.65rem"
            }}
          >
            <span>{membersById[allocation.memberId] ?? allocation.memberId}</span>
            <span style={{ fontWeight: 600 }}>{formatCurrency.format(allocation.amount)}</span>
          </div>
        ))}
      </div>

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          borderTop: "1px solid rgba(148,163,184,0.12)",
          paddingTop: "0.8rem"
        }}
      >
        <span className="muted" style={{ fontSize: "0.85rem" }}>
          {sharedLabel(expense.sharedWithMemberIds.length)}
        </span>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          {expense.receiptId && (
            <button
              className="secondary"
              style={{ paddingInline: "0.65rem", fontSize: "0.85rem" }}
              disabled={
                isLoadingPreview ||
                receiptStatus === "FAILED" ||
                (!previewData &&
                  (receiptStatus !== "COMPLETED" || !hasReceiptStorage))
              }
              onClick={() => {
                if (!expense.receiptId) return;
                if (previewData) {
                  window.open(previewData.url, "_blank", "noopener");
                  return;
                }
                onViewReceipt(expense.receiptId);
              }}
            >
              {previewData
                ? "Open full size"
                : isLoadingPreview
                ? "Loading…"
                : receiptStatus === "FAILED"
                ? "Unavailable"
                : "Load preview"}
            </button>
          )}
          <button
            type="button"
            className="secondary"
            style={{
              paddingInline: "0.7rem",
              fontSize: "0.85rem",
              display: "inline-flex",
              alignItems: "center",
              gap: "0.3rem"
            }}
            title="Discuss this expense"
            onClick={onToggleComments}
            aria-expanded={commentsOpen}
          >
            <span aria-hidden="true">💬</span> Comments
          </button>
          <button
            type="button"
            className="secondary"
            style={{
              paddingInline: "0.7rem",
              fontSize: "0.85rem",
              display: "inline-flex",
              alignItems: "center",
              gap: "0.3rem"
            }}
            title="Clone this expense into the form"
            onClick={() => onRepeatExpense(expense)}
          >
            <span aria-hidden="true">↻</span> Repeat
          </button>
          {canModify && (
            <>
              <button
                type="button"
                className="secondary"
                style={{
                  paddingInline: "0.7rem",
                  fontSize: "0.85rem",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "0.3rem"
                }}
                title="Load this expense into the form and save changes to it"
                onClick={() => onEditExpense(expense)}
              >
                <span aria-hidden="true">✎</span> Edit
              </button>
              <button
                type="button"
                className="secondary"
                style={{
                  paddingInline: "0.7rem",
                  opacity: 0.6,
                  fontSize: "0.85rem"
                }}
                disabled={deleteDisabled}
                title="Move to Recently deleted (undoable for now)"
                onClick={() => {
                  onDeleteExpense(expense.expenseId, expense.description).catch(() => {});
                }}
              >
                Delete
              </button>
            </>
          )}
        </div>
      </div>
      <ExpenseCommentsThread
        tripId={tripId}
        expenseId={expense.expenseId}
        currentUserId={currentUserId}
        canDeleteAny={isTripOwner}
        open={commentsOpen}
      />
      {(expense.receiptId && (previewData || isLoadingPreview)) && (
        <div
          style={{
            marginTop: "0.85rem",
            border: "1px solid rgba(148,163,184,0.14)",
            borderRadius: "0.9rem",
            padding: "0.75rem",
            background: "var(--inset)",
            display: "flex",
            flexDirection: "column",
            gap: "0.75rem"
          }}
        >
          {previewData ? (
            previewData.type === "application/pdf" ? (
              <iframe
                title={previewData.title}
                src={previewData.url}
                style={{
                  border: "none",
                  width: "100%",
                  height: "260px",
                  borderRadius: "0.65rem"
                }}
              />
            ) : previewData.type === "image" ? (
              <img
                src={previewData.url}
                alt={previewData.title}
                style={{
                  maxWidth: "100%",
                  maxHeight: "340px",
                  display: "block",
                  borderRadius: "0.65rem"
                }}
              />
            ) : (
              <a
                className="secondary"
                href={previewData.url}
                target="_blank"
                rel="noreferrer"
                style={{ alignSelf: "flex-start" }}
              >
                Open receipt in new tab
              </a>
            )
          ) : (
            <p className="muted" style={{ margin: 0 }}>
              Loading preview…
            </p>
          )}
          {previewData && (
            <span className="muted" style={{ fontSize: "0.8rem" }}>
              {previewData.title}
            </span>
          )}
        </div>
      )}
    </div>
  );
};
