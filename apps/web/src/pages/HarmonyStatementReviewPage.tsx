import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../lib/api";
import HarmonySubNav from "../components/HarmonySubNav";
import {
  HarmonyLedgerEntryType,
  HarmonyStagedTransaction,
  HarmonyStatementBulkConfirmResponse,
  HarmonyStatementConfirmResponse,
  HarmonyStatementCounts,
  HarmonyStatementDetailResponse,
  HarmonyStatementSourceType,
  HarmonyStatementTransactionResponse
} from "../types";
import { useHarmonyLedgerAccess } from "../modules/useHarmonyLedgerAccess";
import { isStatementProcessing } from "../modules/useHarmonyStatements";
import { useHarmonyStatementDetail } from "../modules/useHarmonyStatementDetail";
import { useConfirm } from "../components/ConfirmDialog";

interface RowEdit {
  type?: HarmonyLedgerEntryType;
  /** "" means explicitly Unallocated. */
  groupId?: string;
  /** Raw input value; undefined means the field was never touched. */
  category?: string;
}

interface ConfirmPayload {
  txnDate: string;
  type?: HarmonyLedgerEntryType;
  groupId?: string | null;
  /** String overrides the suggestion, null suppresses it, omitted keeps it. */
  category?: string | null;
}

const sourceTypeLabels: Record<HarmonyStatementSourceType, string> = {
  BANK: "Bank",
  VENMO: "Venmo",
  PAYPAL: "PayPal",
  OTHER: "Other"
};

const entryTypeLabels: Record<HarmonyLedgerEntryType, string> = {
  DONATION: "Donation",
  INCOME: "Income",
  EXPENSE: "Expense",
  REIMBURSEMENT: "Reimbursement"
};

const inTypeOptions: HarmonyLedgerEntryType[] = [
  "DONATION",
  "INCOME",
  "REIMBURSEMENT"
];

const formatCurrencyValue = (value: number, currency: string) =>
  new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    maximumFractionDigits: 2
  }).format(value);

const formatTxnDate = (value: string) =>
  new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit"
  }).format(new Date(`${value}T00:00:00`));

const formatDateTime = (value: string) =>
  new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));

const formatReviewedDate = (value: string) =>
  new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit"
  }).format(new Date(value));

const computeCounts = (
  txns: HarmonyStagedTransaction[]
): HarmonyStatementCounts => ({
  total: txns.length,
  pending: txns.filter((txn) => txn.status === "PENDING").length,
  confirmed: txns.filter((txn) => txn.status === "CONFIRMED").length,
  dismissed: txns.filter((txn) => txn.status === "DISMISSED").length,
  duplicates: txns.filter((txn) => Boolean(txn.duplicateOf)).length
});

const TxnBadges = ({ txn }: { txn: HarmonyStagedTransaction }) => {
  if (!txn.duplicateOf && !txn.isLikelyInternalTransfer) {
    return null;
  }
  return (
    <div className="hl-txn-badges">
      {txn.duplicateOf && (
        <span className="hl-txn-badge hl-txn-badge--dup">Possible duplicate</span>
      )}
      {txn.isLikelyInternalTransfer && (
        <span className="hl-txn-badge hl-txn-badge--transfer">
          Internal transfer?
        </span>
      )}
    </div>
  );
};

const TxnAmount = ({ txn }: { txn: HarmonyStagedTransaction }) => (
  <span
    className={
      txn.direction === "IN"
        ? "hl-txn-amount hl-txn-amount--in"
        : "hl-txn-amount hl-txn-amount--out"
    }
  >
    {txn.direction === "IN" ? "+" : "−"}
    {formatCurrencyValue(txn.amount, txn.currency)}
  </span>
);

const HarmonyStatementReviewPage = () => {
  const { statementId } = useParams<{ statementId: string }>();
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const { data: accessData, isLoading: accessLoading } = useHarmonyLedgerAccess();
  const detailQuery = useHarmonyStatementDetail(
    statementId,
    accessData?.allowed ?? false
  );

  const [edits, setEdits] = useState<Record<string, RowEdit>>({});
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkResult, setBulkResult] = useState<string | null>(null);

  const detailKey = ["harmony-ledger", "statements", statementId];

  const applyTransactionUpdate = (updated: HarmonyStagedTransaction) => {
    queryClient.setQueryData<HarmonyStatementDetailResponse>(
      detailKey,
      (current) => {
        if (!current) return current;
        const transactions = current.transactions.map((txn) =>
          txn.txnId === updated.txnId ? updated : txn
        );
        return {
          ...current,
          transactions,
          statement: {
            ...current.statement,
            counts: computeCounts(transactions)
          }
        };
      }
    );
    // Keep the counts on the statements list fresh too.
    queryClient.invalidateQueries({
      queryKey: ["harmony-ledger", "statements"],
      exact: true
    });
  };

  const setRowError = (txnId: string, error: unknown) => {
    const message =
      error instanceof ApiError
        ? error.message
        : error instanceof Error
          ? error.message
          : "Something went wrong";
    setRowErrors((prev) => ({ ...prev, [txnId]: message }));
  };

  const clearRowError = (txnId: string) => {
    setRowErrors((prev) => {
      if (!(txnId in prev)) return prev;
      const next = { ...prev };
      delete next[txnId];
      return next;
    });
  };

  const confirmMutation = useMutation({
    mutationFn: (vars: { txn: HarmonyStagedTransaction; payload: ConfirmPayload }) =>
      api.post<HarmonyStatementConfirmResponse>(
        `/harmony-ledger/statements/${statementId}/transactions/${vars.txn.txnId}/confirm`,
        vars.payload
      ),
    onSuccess: (result) => {
      applyTransactionUpdate(result.transaction);
      queryClient.invalidateQueries({ queryKey: ["harmony-ledger", "entries"] });
    },
    onError: (error: unknown, vars) => setRowError(vars.txn.txnId, error)
  });

  const dismissMutation = useMutation({
    mutationFn: (vars: { txn: HarmonyStagedTransaction }) =>
      api.post<HarmonyStatementTransactionResponse>(
        `/harmony-ledger/statements/${statementId}/transactions/${vars.txn.txnId}/dismiss`,
        { txnDate: vars.txn.txnDate }
      ),
    onSuccess: (result) => applyTransactionUpdate(result.transaction),
    onError: (error: unknown, vars) => setRowError(vars.txn.txnId, error)
  });

  const reopenMutation = useMutation({
    mutationFn: (vars: { txn: HarmonyStagedTransaction }) =>
      api.post<HarmonyStatementTransactionResponse>(
        `/harmony-ledger/statements/${statementId}/transactions/${vars.txn.txnId}/reopen`,
        { txnDate: vars.txn.txnDate }
      ),
    onSuccess: (result) => applyTransactionUpdate(result.transaction),
    onError: (error: unknown, vars) => setRowError(vars.txn.txnId, error)
  });

  const unconfirmMutation = useMutation({
    mutationFn: (vars: { txn: HarmonyStagedTransaction }) =>
      api.post<HarmonyStatementTransactionResponse>(
        `/harmony-ledger/statements/${statementId}/transactions/${vars.txn.txnId}/unconfirm`,
        { txnDate: vars.txn.txnDate }
      ),
    onSuccess: (result) => {
      applyTransactionUpdate(result.transaction);
      // The ledger entry the confirm created was deleted server-side.
      queryClient.invalidateQueries({ queryKey: ["harmony-ledger", "entries"] });
    },
    onError: (error: unknown, vars) => setRowError(vars.txn.txnId, error)
  });

  const rowBusyId = confirmMutation.isPending
    ? confirmMutation.variables?.txn.txnId
    : dismissMutation.isPending
      ? dismissMutation.variables?.txn.txnId
      : reopenMutation.isPending
        ? reopenMutation.variables?.txn.txnId
        : unconfirmMutation.isPending
          ? unconfirmMutation.variables?.txn.txnId
          : undefined;

  const handleConfirm = (txn: HarmonyStagedTransaction) => {
    clearRowError(txn.txnId);
    const edit = edits[txn.txnId];
    const selectedType = edit?.type ?? txn.suggestedType;
    const suggestedGroup = txn.suggestedGroupId ?? "";
    const payload: ConfirmPayload = { txnDate: txn.txnDate };
    if (selectedType !== txn.suggestedType) {
      payload.type = selectedType;
    }
    if (edit?.groupId !== undefined && edit.groupId !== suggestedGroup) {
      payload.groupId = edit.groupId === "" ? null : edit.groupId;
    }
    if (edit?.category !== undefined) {
      const trimmed = edit.category.trim();
      const suggested = (txn.suggestedCategory ?? "").trim();
      if (trimmed !== suggested) {
        payload.category = trimmed === "" ? null : trimmed;
      }
    }
    confirmMutation.mutate({ txn, payload });
  };

  const handleDismiss = (txn: HarmonyStagedTransaction) => {
    clearRowError(txn.txnId);
    dismissMutation.mutate({ txn });
  };

  const handleReopen = (txn: HarmonyStagedTransaction) => {
    clearRowError(txn.txnId);
    reopenMutation.mutate({ txn });
  };

  const handleUnconfirm = (txn: HarmonyStagedTransaction) => {
    clearRowError(txn.txnId);
    unconfirmMutation.mutate({ txn });
  };

  const handleConfirmAll = async () => {
    if (!statementId) return;
    const ok = await confirm({
      title: "Accept all AI suggestions?",
      body: "Every pending transaction is confirmed with its suggested type and group. Possible duplicates and likely internal transfers are skipped, so you can review those by hand.",
      confirmLabel: "Accept all"
    });
    if (!ok) return;
    setBulkBusy(true);
    setBulkResult(null);
    try {
      let confirmedTotal = 0;
      let skipped = 0;
      let remaining = Infinity;
      while (remaining > 0) {
        const result = await api.post<HarmonyStatementBulkConfirmResponse>(
          `/harmony-ledger/statements/${statementId}/confirm-all`,
          {}
        );
        confirmedTotal += result.confirmed;
        skipped = result.skipped;
        remaining = result.remaining;
        if (result.confirmed === 0 && remaining > 0) break;
      }
      setBulkResult(
        `Confirmed ${confirmedTotal} transaction${confirmedTotal === 1 ? "" : "s"}${
          skipped > 0 ? ` · ${skipped} left for manual review` : ""
        }`
      );
    } catch (error) {
      setBulkResult(
        error instanceof ApiError ? error.message : "Bulk confirm failed"
      );
    } finally {
      setBulkBusy(false);
      queryClient.invalidateQueries({ queryKey: ["harmony-ledger"] });
    }
  };

  const backLink = (
    <Link to="/harmony-ledger/statements" className="trip-back">
      ← All statements
    </Link>
  );

  if (accessLoading) {
    return (
      <div className="hl-page">
        <HarmonySubNav />
        <section className="hl-hero">
          <span className="hl-hero__eyebrow">Harmony Collective</span>
          <h1 className="hl-hero__title">
            Checking <em>your access…</em>
          </h1>
        </section>
      </div>
    );
  }

  if (!accessData?.allowed) {
    return (
      <div className="hl-page">
        <HarmonySubNav />
        <section className="hl-hero">
          <span className="hl-hero__eyebrow">Harmony Collective · private</span>
          <h1 className="hl-hero__title">
            Invite-only <em>workspace.</em>
          </h1>
          <p className="hl-hero__net">
            If you should have access, ask Hunter to add you on the Ledger page.
          </p>
          <div className="hl-hero__rule" aria-hidden="true" />
        </section>
      </div>
    );
  }

  if (detailQuery.isLoading) {
    return (
      <div className="hl-page">
        <HarmonySubNav />
        {backLink}
        <section className="card">
          <p className="muted">Loading statement…</p>
        </section>
      </div>
    );
  }

  if (detailQuery.isError || !detailQuery.data) {
    const notFound =
      detailQuery.error instanceof ApiError && detailQuery.error.status === 404;
    return (
      <div className="hl-page">
        <HarmonySubNav />
        {backLink}
        <div className="empty-state">
          <p className="empty-state__title">
            {notFound ? "Statement not found." : "Couldn't load this statement."}
          </p>
          <p className="empty-state__hint">
            {notFound
              ? "It may have been deleted. Head back to the statements list."
              : detailQuery.error instanceof ApiError
                ? detailQuery.error.message
                : "Please try again in a moment."}
          </p>
        </div>
      </div>
    );
  }

  const { statement, transactions, groups } = detailQuery.data;

  if (isStatementProcessing(statement.status)) {
    return (
      <div className="hl-page">
        <HarmonySubNav />
        {backLink}
        <section className="card">
          <div className="section-title">
            <div>
              <h2>{statement.fileName}</h2>
              <p className="muted">
                Parsing with AI… (usually under a minute) — this page refreshes
                automatically.
              </p>
            </div>
            <span className="pill">
              <span className="hl-status-dot" aria-hidden="true" />
              Parsing…
            </span>
          </div>
          <button
            type="button"
            className="ghost"
            onClick={() => detailQuery.refetch()}
            disabled={detailQuery.isFetching}
          >
            Check again
          </button>
        </section>
      </div>
    );
  }

  if (statement.status === "FAILED") {
    return (
      <div className="hl-page">
        <HarmonySubNav />
        {backLink}
        <section className="card">
          <div className="section-title">
            <div>
              <h2>{statement.fileName}</h2>
              <p className="muted">
                {sourceTypeLabels[statement.sourceType]} · uploaded{" "}
                {formatDateTime(statement.uploadedAt)}
              </p>
            </div>
            <span
              className="pill"
              style={{ background: "rgba(248, 113, 113, 0.15)", color: "#f87171" }}
            >
              Failed
            </span>
          </div>
          <p className="error">
            {statement.errorMessage ??
              "We couldn't parse this statement. Try a different export."}
          </p>
        </section>
      </div>
    );
  }

  const counts = statement.counts ?? computeCounts(transactions);
  const activeGroups = groups.filter((group) => group.isActive);
  const pendingTxns = transactions.filter((txn) => txn.status === "PENDING");
  const reviewedTxns = transactions.filter((txn) => txn.status !== "PENDING");

  return (
    <div className="hl-page">
      <HarmonySubNav />
      {backLink}

      <section className="card">
        <div className="section-title">
          <div>
            <h2>{statement.fileName}</h2>
            <p className="muted">
              {sourceTypeLabels[statement.sourceType]} · uploaded{" "}
              {formatDateTime(statement.uploadedAt)}
              {statement.uploadedByName ? ` by ${statement.uploadedByName}` : ""}
            </p>
            <p className="muted" style={{ margin: 0 }}>
              {counts.pending} to review · {counts.confirmed} confirmed ·{" "}
              {counts.dismissed} dismissed
              {counts.duplicates > 0
                ? ` · ${counts.duplicates} duplicate${counts.duplicates === 1 ? "" : "s"}`
                : ""}
            </p>
          </div>
          <button
            type="button"
            className="primary"
            onClick={handleConfirmAll}
            disabled={bulkBusy || counts.pending === 0}
          >
            {bulkBusy ? "Confirming…" : "Accept all suggestions"}
          </button>
        </div>
        {bulkResult && <p className="muted" style={{ margin: 0 }}>{bulkResult}</p>}
      </section>

      <section className="card">
        <div className="section-title">
          <div>
            <h2>To Review</h2>
            <p className="muted">
              Adjust the type or group if the AI suggestion is off, then confirm
              each transaction into the ledger.
            </p>
          </div>
        </div>
        {pendingTxns.length === 0 ? (
          <div className="empty-state">
            <p className="empty-state__title">All caught up.</p>
            <p className="empty-state__hint">
              Every transaction on this statement has been reviewed.
            </p>
          </div>
        ) : (
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th style={{ width: "10%" }}>Date</th>
                  <th>Transaction</th>
                  <th style={{ width: "10%" }}>Amount</th>
                  <th style={{ width: "14%" }}>Type</th>
                  <th style={{ width: "16%" }}>Group</th>
                  <th style={{ width: "12%" }}>Category</th>
                  <th style={{ width: "16%" }}></th>
                </tr>
              </thead>
              <tbody>
                {pendingTxns.map((txn) => {
                  const edit = edits[txn.txnId];
                  const selectedType = edit?.type ?? txn.suggestedType;
                  const selectedGroup = edit?.groupId ?? txn.suggestedGroupId ?? "";
                  const rowBusy = bulkBusy || rowBusyId === txn.txnId;
                  return (
                    <tr key={txn.txnId}>
                      <td>{formatTxnDate(txn.txnDate)}</td>
                      <td>
                        <strong>{txn.rawDescription}</strong>
                        {txn.counterparty && (
                          <p className="muted" style={{ margin: 0 }}>
                            {txn.counterparty}
                          </p>
                        )}
                        <TxnBadges txn={txn} />
                        {rowErrors[txn.txnId] && (
                          <p className="error" style={{ marginTop: "0.3rem" }}>
                            {rowErrors[txn.txnId]}
                          </p>
                        )}
                      </td>
                      <td>
                        <TxnAmount txn={txn} />
                      </td>
                      <td>
                        {txn.direction === "OUT" ? (
                          <select value="EXPENSE" disabled aria-label="Entry type">
                            <option value="EXPENSE">Expense</option>
                          </select>
                        ) : (
                          <select
                            value={selectedType}
                            aria-label="Entry type"
                            disabled={rowBusy}
                            onChange={(event) =>
                              setEdits((prev) => ({
                                ...prev,
                                [txn.txnId]: {
                                  ...prev[txn.txnId],
                                  type: event.target.value as HarmonyLedgerEntryType
                                }
                              }))
                            }
                          >
                            {inTypeOptions.map((type) => (
                              <option key={type} value={type}>
                                {entryTypeLabels[type]}
                              </option>
                            ))}
                          </select>
                        )}
                      </td>
                      <td>
                        <select
                          value={selectedGroup}
                          aria-label="Group allocation"
                          disabled={rowBusy}
                          onChange={(event) =>
                            setEdits((prev) => ({
                              ...prev,
                              [txn.txnId]: {
                                ...prev[txn.txnId],
                                groupId: event.target.value
                              }
                            }))
                          }
                        >
                          <option value="">Unallocated</option>
                          {activeGroups.map((group) => (
                            <option key={group.groupId} value={group.groupId}>
                              {group.name}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <input
                          type="text"
                          className="hl-cat-input"
                          value={edit?.category ?? txn.suggestedCategory ?? ""}
                          placeholder="category"
                          aria-label="Category"
                          disabled={rowBusy}
                          onChange={(event) =>
                            setEdits((prev) => ({
                              ...prev,
                              [txn.txnId]: {
                                ...prev[txn.txnId],
                                category: event.target.value
                              }
                            }))
                          }
                        />
                      </td>
                      <td>
                        <div className="hl-txn-actions">
                          <button
                            type="button"
                            className="primary"
                            onClick={() => handleConfirm(txn)}
                            disabled={rowBusy}
                          >
                            {rowBusyId === txn.txnId && confirmMutation.isPending
                              ? "Confirming…"
                              : "Confirm"}
                          </button>
                          <button
                            type="button"
                            className="ghost"
                            onClick={() => handleDismiss(txn)}
                            disabled={rowBusy}
                          >
                            Dismiss
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {reviewedTxns.length > 0 && (
        <section className="card">
          <div className="section-title">
            <div>
              <h2>Reviewed</h2>
              <p className="muted">
                Confirmed transactions are in the ledger; dismissed ones were
                skipped. Undoing a confirmation also removes the ledger entry it
                created.
              </p>
            </div>
          </div>
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th style={{ width: "12%" }}>Date</th>
                  <th>Transaction</th>
                  <th style={{ width: "12%" }}>Amount</th>
                  <th style={{ width: "14%" }}>Outcome</th>
                  <th style={{ width: "14%" }}></th>
                </tr>
              </thead>
              <tbody>
                {reviewedTxns.map((txn) => (
                  <tr key={txn.txnId} className="hl-reviewed-row">
                    <td>{formatTxnDate(txn.txnDate)}</td>
                    <td>
                      <strong>{txn.rawDescription}</strong>
                      {txn.counterparty && (
                        <p className="muted" style={{ margin: 0 }}>
                          {txn.counterparty}
                        </p>
                      )}
                      {txn.suggestedCategory && (
                        <p className="muted" style={{ margin: 0, fontSize: "0.8rem" }}>
                          {txn.suggestedCategory}
                        </p>
                      )}
                      {rowErrors[txn.txnId] && (
                        <p className="error" style={{ marginTop: "0.3rem" }}>
                          {rowErrors[txn.txnId]}
                        </p>
                      )}
                    </td>
                    <td>
                      <TxnAmount txn={txn} />
                    </td>
                    <td>
                      {txn.status === "CONFIRMED" ? (
                        <span
                          className="pill"
                          style={{
                            background: "rgba(52, 211, 153, 0.14)",
                            color: "#6ee7b7"
                          }}
                        >
                          Confirmed
                        </span>
                      ) : (
                        <span
                          className="pill"
                          style={{
                            background: "rgba(148, 163, 184, 0.16)",
                            color: "#cbd5f5"
                          }}
                        >
                          Dismissed
                        </span>
                      )}
                      {txn.reviewedByName && (
                        <p
                          className="muted"
                          style={{ margin: "0.3rem 0 0", fontSize: "0.8rem" }}
                        >
                          {txn.status === "CONFIRMED" ? "Confirmed by" : "Skipped by"}{" "}
                          {txn.reviewedByName}
                          {txn.reviewedAt
                            ? ` · ${formatReviewedDate(txn.reviewedAt)}`
                            : ""}
                        </p>
                      )}
                    </td>
                    <td>
                      {txn.status === "DISMISSED" ? (
                        <button
                          type="button"
                          className="ghost"
                          onClick={() => handleReopen(txn)}
                          disabled={bulkBusy || rowBusyId === txn.txnId}
                        >
                          {rowBusyId === txn.txnId && reopenMutation.isPending
                            ? "Restoring…"
                            : "Restore"}
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="ghost"
                          title="Moves this back to review and removes the ledger entry its confirmation created."
                          onClick={() => handleUnconfirm(txn)}
                          disabled={bulkBusy || rowBusyId === txn.txnId}
                        >
                          {rowBusyId === txn.txnId && unconfirmMutation.isPending
                            ? "Undoing…"
                            : "Undo"}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
};

export default HarmonyStatementReviewPage;
