import type { TripSummary } from "../../types";
import type { SettlementSuggestion } from "../../lib/settlementSuggestions";
import type { ReceiptPreviewData } from "./ExpenseCard";

export interface MemberTotalRow {
  memberId: string;
  name: string;
  paid: number;
  share: number;
  net: number;
}

interface ExpensesSidebarProps {
  sortedTotals: MemberTotalRow[];
  suggestions: SettlementSuggestion[];
  membersById: Record<string, string>;
  formatCurrency: Intl.NumberFormat;
  receipts: TripSummary["receipts"];
  receiptsByStatus: TripSummary["receipts"];
  receiptUsage: Map<string, string>;
  receiptPreviewCache: Record<string, ReceiptPreviewData>;
  expandedReceiptId: string | null;
  viewingReceiptId: string | null;
  onSetExpandedReceiptId: (receiptId: string | null) => void;
  onViewReceipt: (receiptId: string) => void;
}

export const ExpensesSidebar = ({
  sortedTotals,
  suggestions,
  membersById,
  formatCurrency,
  receipts,
  receiptsByStatus,
  receiptUsage,
  receiptPreviewCache,
  expandedReceiptId,
  viewingReceiptId,
  onSetExpandedReceiptId,
  onViewReceipt
}: ExpensesSidebarProps) => (
  <aside
    className="card"
    style={{
      padding: "1.1rem 1.3rem",
      borderRadius: "1rem",
      border: "1px solid rgba(148,163,184,0.12)",
      background: "rgba(15,23,42,0.45)",
      backdropFilter: "blur(10px)",
      display: "flex",
      flexDirection: "column",
      gap: "1.1rem"
    }}
  >
    <div>
      <h3 style={{ margin: 0 }}>Member totals</h3>
      <p className="muted" style={{ marginTop: "0.35rem", fontSize: "0.85rem" }}>
        Based on filtered expenses
      </p>
      <div className="list" style={{ marginTop: "0.75rem", gap: "0.55rem" }}>
        {sortedTotals.map((member) => {
          const tone = member.net >= 0 ? "#4ade80" : "#f87171";
          return (
            <div
              key={member.memberId}
              className="card"
              style={{
                padding: "0.65rem 0.75rem",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                background: "rgba(15,23,42,0.55)",
                borderRadius: "0.75rem",
                border: "1px solid rgba(148,163,184,0.08)"
              }}
            >
              <div style={{ display: "flex", flexDirection: "column" }}>
                <span style={{ fontWeight: 600 }}>{member.name}</span>
                <span className="muted" style={{ fontSize: "0.8rem" }}>
                  Paid {formatCurrency.format(member.paid)} · Share {formatCurrency.format(member.share)}
                </span>
              </div>
              <span style={{ fontWeight: 700, color: tone }}>
                {member.net >= 0 ? "Owed" : "Owes"} {formatCurrency.format(Math.abs(member.net))}
              </span>
            </div>
          );
        })}
      </div>
    </div>

    {suggestions.length > 0 && (
      <div>
        <h3 style={{ margin: 0 }}>Suggested settlements</h3>
        <div className="list" style={{ marginTop: "0.75rem", gap: "0.5rem" }}>
          {suggestions.map((suggestion, index) => (
            <div
              key={`${suggestion.from}-${suggestion.to}-${index}`}
              className="card"
              style={{
                padding: "0.6rem 0.7rem",
                background: "rgba(30,41,59,0.75)",
                borderRadius: "0.65rem",
                border: "1px solid rgba(148,163,184,0.08)"
              }}
            >
              <p style={{ margin: 0, fontSize: "0.85rem" }}>
                <strong>{membersById[suggestion.from] ?? suggestion.from}</strong> should pay {" "}
                <strong>{formatCurrency.format(suggestion.amount)}</strong> to {" "}
                <strong>{membersById[suggestion.to] ?? suggestion.to}</strong>
              </p>
            </div>
          ))}
        </div>
      </div>
    )}

    <div>
      <h3 style={{ margin: 0 }}>Receipts</h3>
      <p className="muted" style={{ marginTop: "0.35rem", fontSize: "0.85rem" }}>
        {receipts.length === 0
          ? "Upload a receipt with the next expense and it'll appear here."
          : "Track uploaded receipts and their status."}
      </p>
      {receipts.length > 0 && (
        <div className="list" style={{ marginTop: "0.75rem", gap: "0.55rem" }}>
          {receiptsByStatus.map((receipt) => {
            const attachedTo = receiptUsage.get(receipt.receiptId);
            const statusTone =
              receipt.status === "COMPLETED"
                ? "#4ade80"
                : receipt.status === "PROCESSING"
                ? "#facc15"
                : "#f87171";
            const receiptPreview = receiptPreviewCache[receipt.receiptId];
            const isExpanded = expandedReceiptId === receipt.receiptId;
            return (
              <div
                key={receipt.receiptId}
                className="card"
                style={{
                  padding: "0.65rem 0.75rem",
                  display: "flex",
                  flexDirection: "column",
                  gap: "0.65rem",
                  background: "rgba(15,23,42,0.55)",
                  borderRadius: "0.75rem",
                  border: "1px solid rgba(148,163,184,0.08)"
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: "0.75rem"
                  }}
                >
                  <div style={{ display: "flex", flexDirection: "column" }}>
                    <span style={{ fontWeight: 600 }}>{receipt.fileName}</span>
                    <span className="muted" style={{ fontSize: "0.8rem", color: statusTone }}>
                      {receipt.status.toLowerCase()}
                    </span>
                    {attachedTo && (
                      <span className="muted" style={{ fontSize: "0.8rem" }}>
                        Attached to: {attachedTo}
                      </span>
                    )}
                  </div>
                  <button
                    className="secondary"
                    style={{ paddingInline: "0.65rem", fontSize: "0.85rem" }}
                    disabled={
                      viewingReceiptId === receipt.receiptId ||
                      receipt.status !== "COMPLETED" ||
                      !receipt.storageKey
                    }
                    onClick={() => {
                      if (isExpanded) {
                        onSetExpandedReceiptId(null);
                        return;
                      }
                      if (receiptPreviewCache[receipt.receiptId]) {
                        onSetExpandedReceiptId(receipt.receiptId);
                        return;
                      }
                      onViewReceipt(receipt.receiptId);
                    }}
                  >
                    {isExpanded
                      ? "Hide preview"
                      : viewingReceiptId === receipt.receiptId
                      ? "Opening…"
                      : receipt.status === "FAILED"
                      ? "Unavailable"
                      : receiptPreviewCache[receipt.receiptId]
                      ? "Show preview"
                      : "View receipt"}
                  </button>
                </div>
                {isExpanded && (
                  <div
                    style={{
                      border: "1px solid rgba(148,163,184,0.14)",
                      borderRadius: "0.65rem",
                      padding: "0.6rem",
                      background: "rgba(15,23,42,0.45)"
                    }}
                  >
                    {receiptPreview ? (
                      receiptPreview.type === "application/pdf" ? (
                        <iframe
                          title={receiptPreview.title}
                          src={receiptPreview.url}
                          style={{
                            border: "none",
                            width: "100%",
                            height: "220px",
                            borderRadius: "0.5rem"
                          }}
                        />
                      ) : receiptPreview.type === "image" ? (
                        <img
                          src={receiptPreview.url}
                          alt={receiptPreview.title}
                          style={{
                            maxWidth: "100%",
                            maxHeight: "280px",
                            display: "block",
                            borderRadius: "0.5rem"
                          }}
                        />
                      ) : (
                        <a
                          className="secondary"
                          href={receiptPreview.url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Open receipt in new tab
                        </a>
                      )
                    ) : (
                      <p className="muted" style={{ margin: 0 }}>
                        Loading preview…
                      </p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  </aside>
);
