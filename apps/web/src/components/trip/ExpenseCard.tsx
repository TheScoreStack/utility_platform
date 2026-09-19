import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CategoryBadge } from "../CategoryBadge";
import ExpenseCommentsThread from "../ExpenseCommentsThread";
import { useConfirm } from "../ConfirmDialog";
import { formatDate } from "../../lib/tripFormat";
import { splitLinkApi, splitLinkUrl } from "../../lib/splitLinkApi";
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
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const [splitUrl, setSplitUrl] = useState<string | null>(null);
  const [claimBusy, setClaimBusy] = useState(false);
  const [claimError, setClaimError] = useState<string | null>(null);

  // Members claim their items right here — the split link stays for people
  // who aren't on the trip. Each tap sends the full "what's mine" set, so a
  // stale card can't silently drop a claim made from another device.
  const canClaim = Boolean(currentUserId) && !expense.draft;
  const myItemIds = new Set(
    (expense.lineItems ?? [])
      .filter(
        (item) =>
          currentUserId && item.assignedMemberIds.includes(currentUserId)
      )
      .map((item) => item.lineItemId)
  );
  const unclaimedCount = (expense.lineItems ?? []).filter(
    (item) => item.assignedMemberIds.length === 0
  ).length;

  const handleToggleClaim = async (lineItemId: string) => {
    if (!canClaim || claimBusy) return;
    const next = new Set(myItemIds);
    if (next.has(lineItemId)) {
      next.delete(lineItemId);
    } else {
      next.add(lineItemId);
    }
    setClaimBusy(true);
    setClaimError(null);
    try {
      await splitLinkApi.saveMemberClaims(tripId, expense.expenseId, [...next]);
      await queryClient.invalidateQueries({ queryKey: ["trip", tripId] });
    } catch (error) {
      setClaimError(
        error instanceof Error ? error.message : "Couldn't save that claim."
      );
    } finally {
      setClaimBusy(false);
    }
  };
  const [splitBusy, setSplitBusy] = useState<"open" | "revoke" | null>(null);
  const [splitCopied, setSplitCopied] = useState(false);
  const [splitError, setSplitError] = useState<string | null>(null);

  const handleSplitLink = async () => {
    if (splitUrl) {
      setSplitUrl(null);
      return;
    }
    setSplitBusy("open");
    setSplitError(null);
    try {
      // Fetch-or-create, like the trip invite link.
      const { link } = await splitLinkApi.getOrCreate(
        tripId,
        expense.expenseId
      );
      setSplitUrl(splitLinkUrl(link.shareId));
    } catch {
      setSplitError("Couldn't get the split link — try again.");
    } finally {
      setSplitBusy(null);
    }
  };

  const handleCopySplitLink = async () => {
    if (!splitUrl) return;
    try {
      await navigator.clipboard.writeText(splitUrl);
      setSplitCopied(true);
      setTimeout(() => setSplitCopied(false), 2000);
    } catch {
      // Clipboard can be blocked (permissions, non-HTTPS) — fall back to
      // showing the link so it can be copied by hand.
      window.prompt("Copy your split link:", splitUrl);
    }
  };

  const handleRevokeSplitLink = async () => {
    const ok = await confirm({
      title: "Revoke this split link?",
      body:
        "The current link stops working everywhere it was shared. Claims " +
        "and recorded payments stay. Sharing again creates a fresh link.",
      confirmLabel: "Revoke"
    });
    if (!ok) return;
    setSplitBusy("revoke");
    setSplitError(null);
    try {
      await splitLinkApi.revoke(tripId, expense.expenseId);
      setSplitUrl(null);
    } catch {
      setSplitError("Couldn't revoke the link — try again.");
    } finally {
      setSplitBusy(null);
    }
  };

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
  if (typeof expense.fees === "number" && expense.fees > 0) {
    badges.push(`Fees ${formatCurrency.format(expense.fees)}`);
  }

  return (
    <div
      className="card"
      style={{
        padding: "1.35rem 1.6rem",
        borderRadius: "1.1rem",
        border: "1px solid var(--border)",
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
            border: "1px solid var(--border)",
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
              ? " · tax, tip & fees split evenly"
              : " · tax, tip & fees proportional"}
            {unclaimedCount > 0 && (
              <strong style={{ marginLeft: "0.4rem" }}>
                · {unclaimedCount} unclaimed
              </strong>
            )}
          </summary>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "0.45rem",
              marginTop: "0.6rem"
            }}
          >
            {canClaim && (
              <p
                className="muted"
                style={{ margin: "0 0 0.2rem", fontSize: "0.78rem" }}
              >
                {claimBusy
                  ? "Saving…"
                  : unclaimedCount > 0
                    ? "Tap an item to claim it — anything nobody claims stays with the payer."
                    : "Tap an item to claim or unclaim it."}
              </p>
            )}
            {expense.lineItems.map((item) => {
              const mine = myItemIds.has(item.lineItemId);
              const others = item.assignedMemberIds.filter(
                (memberId) => memberId !== currentUserId
              );
              const names = [
                ...(mine ? ["you"] : []),
                ...others.map(
                  (memberId) =>
                    (membersById[memberId] ?? memberId).split(/\s+/)[0]
                )
              ];
              const row = (
                <>
                  {canClaim && (
                    <span
                      aria-hidden="true"
                      style={{
                        display: "inline-block",
                        width: "1rem",
                        height: "1rem",
                        borderRadius: "0.3rem",
                        border: mine
                          ? "1px solid var(--accent, #6366f1)"
                          : "1px solid rgba(148,163,184,0.5)",
                        background: mine
                          ? "var(--accent)"
                          : "transparent",
                        color: "white",
                        fontSize: "0.7rem",
                        lineHeight: "1rem",
                        textAlign: "center",
                        flexShrink: 0
                      }}
                    >
                      {mine ? "✓" : ""}
                    </span>
                  )}
                  <span style={{ fontSize: "0.88rem", flex: 1 }}>
                    {item.description}
                    {typeof item.quantity === "number" &&
                      item.quantity > 1 && (
                        <span className="muted"> ×{item.quantity}</span>
                      )}
                    <span
                      className="muted"
                      style={{ fontSize: "0.78rem", marginLeft: "0.4rem" }}
                    >
                      {names.length > 0 ? names.join(", ") : "unclaimed"}
                    </span>
                  </span>
                  <span style={{ fontSize: "0.88rem", fontWeight: 600 }}>
                    {formatCurrency.format(item.total)}
                  </span>
                </>
              );
              const rowStyle = {
                display: "flex",
                gap: "0.6rem",
                alignItems: "baseline",
                width: "100%"
              } as const;
              return canClaim ? (
                <button
                  key={item.lineItemId}
                  type="button"
                  role="checkbox"
                  aria-checked={mine}
                  disabled={claimBusy}
                  title={mine ? "Unclaim this item" : "Claim this item"}
                  onClick={() => void handleToggleClaim(item.lineItemId)}
                  style={{
                    ...rowStyle,
                    background: "none",
                    border: "none",
                    padding: 0,
                    margin: 0,
                    color: "inherit",
                    font: "inherit",
                    textAlign: "left",
                    cursor: claimBusy ? "wait" : "pointer"
                  }}
                >
                  {row}
                </button>
              ) : (
                <div key={item.lineItemId} style={rowStyle}>
                  {row}
                </div>
              );
            })}
            {claimError && (
              <p
                role="alert"
                style={{
                  margin: 0,
                  fontSize: "0.8rem",
                  color: "var(--danger)"
                }}
              >
                {claimError}
              </p>
            )}
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
          borderTop: "1px solid var(--border)",
          paddingTop: "var(--space-3)"
        }}
        className="row row--between"
      >
        <span className="muted" style={{ fontSize: "0.85rem" }}>
          {sharedLabel(expense.sharedWithMemberIds.length)}
        </span>
        <div className="cluster">
          {expense.receiptId && (
            <button
              className="secondary btn-sm btn-quiet"
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
          {expense.lineItems && expense.lineItems.length > 0 && (
            <button
              type="button"
              className="secondary btn-sm btn-quiet"
              disabled={splitBusy === "open"}
              title="A link where anyone can claim their items and pay — no account needed"
              onClick={() => void handleSplitLink()}
              aria-expanded={Boolean(splitUrl)}
            >
              {splitBusy === "open" ? (
                "Getting link…"
              ) : (
                <>
                  <span aria-hidden="true">🔗</span> Split link
                </>
              )}
            </button>
          )}
          <button
            type="button"
            className="secondary btn-sm btn-quiet"
            title="Discuss this expense"
            onClick={onToggleComments}
            aria-expanded={commentsOpen}
          >
            <span aria-hidden="true">💬</span> Comments
          </button>
          <button
            type="button"
            className="secondary btn-sm btn-quiet"
            title="Clone this expense into the form"
            onClick={() => onRepeatExpense(expense)}
          >
            <span aria-hidden="true">↻</span> Repeat
          </button>
          {canModify && (
            <>
              <button
                type="button"
                className="secondary btn-sm btn-quiet"
                title="Load this expense into the form and save changes to it"
                onClick={() => onEditExpense(expense)}
              >
                <span aria-hidden="true">✎</span> Edit
              </button>
              <button
                type="button"
                className="secondary btn-sm btn-danger"
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
      {(splitUrl || splitError) && (
        <div className="panel stack stack--tight">
          {splitError ? (
            <p style={{ margin: 0, color: "var(--danger)", fontSize: "0.85rem" }}>
              {splitError}
            </p>
          ) : (
            <>
              <span
                style={{
                  fontSize: "0.85rem",
                  color: "#a5b4fc",
                  wordBreak: "break-all"
                }}
              >
                {splitUrl}
              </span>
              <span className="muted" style={{ fontSize: "0.8rem" }}>
                Anyone with this link can claim their items, see their share
                of tax &amp; tip, and pay — no account needed.
              </span>
              <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                <button
                  type="button"
                  className="primary"
                  style={{ paddingInline: "0.8rem", fontSize: "0.85rem" }}
                  onClick={() => void handleCopySplitLink()}
                >
                  {splitCopied ? "Copied ✓" : "Copy link"}
                </button>
                <button
                  type="button"
                  className="secondary"
                  style={{
                    paddingInline: "0.8rem",
                    fontSize: "0.85rem",
                    opacity: 0.75
                  }}
                  disabled={splitBusy === "revoke"}
                  title="Kills the link everywhere it was shared; claims and payments stay"
                  onClick={() => void handleRevokeSplitLink()}
                >
                  {splitBusy === "revoke" ? "Revoking…" : "Revoke link"}
                </button>
              </div>
            </>
          )}
        </div>
      )}
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
            border: "1px solid var(--border)",
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
