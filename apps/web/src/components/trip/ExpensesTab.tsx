import { useEffect, useMemo, useState } from "react";
import AddExpenseForm, { type CreateExpenseInput, type ExpensePrefill } from "../AddExpenseForm";
import { normalizeCategoryKey, resolveExpenseCategory } from "../../lib/expenseCategories";
import { api } from "../../lib/api";
import { formatDate, formatDayLabel, localDayKey } from "../../lib/tripFormat";
import { computeSettlementSuggestions } from "../../lib/settlementSuggestions";
import { ExpenseCard, type ReceiptPreviewData } from "./ExpenseCard";
import { ExpenseFilters } from "./ExpenseFilters";
import { ExpensesSidebar } from "./ExpensesSidebar";
import { RecentlyDeletedList } from "./RecentlyDeletedList";
import type { Expense, TripSummary } from "../../types";

interface ExpensesTabProps {
  receipts: TripSummary["receipts"];
  tripId: string;
  members: TripSummary["members"];
  expenses: TripSummary["expenses"];
  currency: string;
  onCreateExpense: (payload: CreateExpenseInput) => Promise<unknown>;
  isCreating: boolean;
  membersById: Record<string, string>;
  onDeleteExpense: (
    expenseId: string,
    description: string,
    isDraft?: boolean
  ) => Promise<void>;
  deletePending: boolean;
  deletingExpenseId?: string;
  currentUserId?: string;
  expensePrefill?: ExpensePrefill | null;
  onExpensePrefillConsumed?: () => void;
  onRepeatExpense: (expense: Expense) => void;
  editingExpense?: Expense | null;
  onCancelEditExpense?: () => void;
  onEditExpense: (expense: Expense) => void;
  draftExpenses: Expense[];
  onPublishDraft: (expenseId: string) => Promise<unknown>;
  publishingExpenseId?: string;
  deletedExpenses: Expense[];
  onRestoreExpense: (expenseId: string) => Promise<void>;
  onPurgeExpense: (expenseId: string) => Promise<void>;
  restoringExpenseId?: string;
  purgingExpenseId?: string;
  isTripOwner: boolean;
}

export const ExpensesTab = ({
  receipts,
  tripId,
  members,
  expenses,
  currency,
  onCreateExpense,
  isCreating,
  membersById,
  onDeleteExpense,
  deletePending,
  deletingExpenseId,
  currentUserId,
  expensePrefill,
  onExpensePrefillConsumed,
  onRepeatExpense,
  editingExpense,
  onCancelEditExpense,
  onEditExpense,
  draftExpenses,
  onPublishDraft,
  publishingExpenseId,
  deletedExpenses,
  onRestoreExpense,
  onPurgeExpense,
  restoringExpenseId,
  purgingExpenseId,
  isTripOwner
}: ExpensesTabProps) => {
  const [openComments, setOpenComments] = useState<Record<string, boolean>>({});
  const toggleComments = (expenseId: string) =>
    setOpenComments((prev) => ({ ...prev, [expenseId]: !prev[expenseId] }));
  const [memberFilter, setMemberFilter] = useState<string>("all");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");
  const [searchTerm, setSearchTerm] = useState<string>("");
  const [viewingReceiptId, setViewingReceiptId] = useState<string | null>(null);
  const [viewReceiptError, setViewReceiptError] = useState<string | null>(null);
  const [expandedReceiptId, setExpandedReceiptId] = useState<string | null>(null);
  const [receiptPreviewCache, setReceiptPreviewCache] = useState<
    Record<string, ReceiptPreviewData>
  >({});

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

  const categories = useMemo(() => {
    const seen = new Map<string, { key: string; label: string; icon: string }>();
    expenses.forEach((expense) => {
      const key = normalizeCategoryKey(expense.category);
      if (!key || seen.has(key)) return;
      const resolved = resolveExpenseCategory(expense.category);
      seen.set(key, {
        key,
        label: resolved?.label ?? (expense.category ?? "").trim(),
        icon: resolved?.icon ?? "✦"
      });
    });
    return Array.from(seen.values()).sort((a, b) => a.label.localeCompare(b.label));
  }, [expenses]);

  const filteredExpenses = useMemo(() => {
    const fromDate = dateFrom ? new Date(dateFrom) : null;
    const toDate = dateTo ? new Date(`${dateTo}T23:59:59.999`) : null;
    const search = searchTerm.trim().toLowerCase();
    const searchAsNumber = search ? Number.parseFloat(search) : NaN;
    const hasNumericSearch = !Number.isNaN(searchAsNumber);

    return expenses.filter((expense) => {
      if (memberFilter !== "all") {
        const involvesMember =
          expense.paidByMemberId === memberFilter ||
          expense.sharedWithMemberIds.includes(memberFilter) ||
          expense.allocations.some((allocation) => allocation.memberId === memberFilter);
        if (!involvesMember) return false;
      }

      if (categoryFilter !== "all" && normalizeCategoryKey(expense.category) !== categoryFilter) {
        return false;
      }

      const expenseDate = new Date(expense.createdAt);
      if (!Number.isNaN(expenseDate.getTime())) {
        if (fromDate && expenseDate < fromDate) return false;
        if (toDate && expenseDate > toDate) return false;
      }

      if (search) {
        const resolved = resolveExpenseCategory(expense.category);
        const haystack = [
          expense.description,
          expense.vendor,
          expense.category,
          resolved?.label,
          membersById[expense.paidByMemberId]
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        const textHit = haystack.includes(search);
        const numericHit =
          hasNumericSearch &&
          Math.abs(expense.total - searchAsNumber) < 0.01;
        if (!textHit && !numericHit) return false;
      }

      return true;
    });
  }, [expenses, memberFilter, categoryFilter, dateFrom, dateTo, searchTerm, membersById]);

  const expensesByDay = useMemo(() => {
    const groups = new Map<
      string,
      { dayKey: string; representativeIso: string; total: number; expenses: typeof filteredExpenses }
    >();
    filteredExpenses.forEach((expense) => {
      const dayKey = localDayKey(expense.createdAt);
      const existing = groups.get(dayKey);
      if (existing) {
        existing.total += expense.total;
        existing.expenses.push(expense);
      } else {
        groups.set(dayKey, {
          dayKey,
          representativeIso: expense.createdAt,
          total: expense.total,
          expenses: [expense]
        });
      }
    });
    return Array.from(groups.values()).sort((a, b) =>
      b.dayKey.localeCompare(a.dayKey)
    );
  }, [filteredExpenses]);

  const perMemberTotals = useMemo(() => {
    const totals = new Map<string, { paid: number; share: number }>();
    members.forEach((member) => {
      totals.set(member.memberId, { paid: 0, share: 0 });
    });

    filteredExpenses.forEach((expense) => {
      const payerTotals = totals.get(expense.paidByMemberId);
      if (payerTotals) {
        payerTotals.paid += expense.total;
      }
      expense.allocations.forEach((allocation) => {
        const entry = totals.get(allocation.memberId);
        if (entry) {
          entry.share += allocation.amount;
        }
      });
    });

    return members.map((member) => {
      const entry = totals.get(member.memberId) ?? { paid: 0, share: 0 };
      const net = entry.paid - entry.share;
      return {
        memberId: member.memberId,
        name: membersById[member.memberId] ?? member.memberId,
        paid: entry.paid,
        share: entry.share,
        net
      };
    });
  }, [filteredExpenses, members, membersById]);

  const suggestions = useMemo(() => {
    const balanceRows = perMemberTotals.map((member) => ({
      memberId: member.memberId,
      displayName: member.name,
      balance: Math.round(member.net * 100) / 100
    }));
    return computeSettlementSuggestions(balanceRows).filter((suggestion) => suggestion.amount > 0.01);
  }, [perMemberTotals]);

  const filteredTotal = useMemo(
    () => filteredExpenses.reduce((sum, expense) => sum + expense.total, 0),
    [filteredExpenses]
  );

  const receiptMetadata = useMemo(() => {
    const usage = new Map<string, string>();
    expenses.forEach((expense) => {
      if (expense.receiptId) {
        usage.set(expense.receiptId, expense.description);
      }
    });

    const status = new Map<string, string>();
    const storage = new Map<string, string | undefined>();
    receipts.forEach((receipt) => {
      status.set(receipt.receiptId, receipt.status);
      storage.set(receipt.receiptId, receipt.storageKey);
    });
    return { usage, status, storage };
  }, [expenses, receipts]);

  useEffect(() => {
    setReceiptPreviewCache((current) => {
      let changed = false;
      const next = { ...current };

      expenses.forEach((expense) => {
        if (!expense.receiptId || !expense.receiptPreviewUrl) {
          return;
        }

        const receipt = receipts.find(
          (item) => item.receiptId === expense.receiptId
        );
        const title = receipt?.fileName ?? "Receipt";
        const type = inferPreviewType(receipt?.fileName);
        const existing = next[expense.receiptId];

        if (!existing || existing.url !== expense.receiptPreviewUrl) {
          next[expense.receiptId] = {
            url: expense.receiptPreviewUrl,
            title,
            type
          };
          changed = true;
        }
      });

      return changed ? next : current;
    });
  }, [expenses, receipts]);

  useEffect(() => {
    const pending = expenses
      .map((expense) => expense.receiptId)
      .filter((id): id is string => Boolean(id))
      .filter((id) => {
        if (receiptPreviewCache[id]) return false;
        const status = receiptMetadata.status.get(id);
        const storageKey = receiptMetadata.storage.get(id);
        return status === "COMPLETED" && Boolean(storageKey);
      });

    if (pending.length === 0) {
      return;
    }

    let cancelled = false;
    const fetchPreviews = async () => {
      for (const receiptId of pending) {
        try {
          const { url } = await api.get<{ url: string }>(
            `/trips/${tripId}/receipts/${receiptId}`
          );
          if (!url) continue;
          const receipt = receipts.find((item) => item.receiptId === receiptId);
          if (!receipt) continue;
          if (cancelled) return;
          setReceiptPreviewCache((current) => {
            if (current[receiptId]) return current;
            return {
              ...current,
              [receiptId]: {
                url,
                title: receipt.fileName ?? "Receipt",
                type: inferPreviewType(receipt.fileName)
              }
            };
          });
        } catch {
          // Ignore failures here; user can still open on demand.
        }
      }
    };

    void fetchPreviews();

    return () => {
      cancelled = true;
    };
  }, [expenses, receiptMetadata, receipts, receiptPreviewCache, tripId]);

  const receiptsByStatus = useMemo(
    () =>
      [...receipts].sort((a, b) => {
        const statusWeight = (status: string) =>
          status === "COMPLETED" ? 0 : status === "PROCESSING" ? 1 : 2;
        const weight = statusWeight(a.status) - statusWeight(b.status);
        if (weight !== 0) return weight;
        return a.fileName.localeCompare(b.fileName);
      }),
    [receipts]
  );

  const resetFilters = () => {
    setMemberFilter("all");
    setCategoryFilter("all");
    setDateFrom("");
    setDateTo("");
    setSearchTerm("");
  };

  const sortedTotals = useMemo(
    () => perMemberTotals.slice().sort((a, b) => Math.abs(b.net) - Math.abs(a.net)),
    [perMemberTotals]
  );

  const inferPreviewType = (fileName?: string) => {
    if (!fileName) return null;
    const lower = fileName.toLowerCase();
    if (lower.endsWith(".pdf")) return "application/pdf";
    if (/(\.png|\.jpg|\.jpeg|\.gif|\.webp|\.bmp)$/.test(lower)) {
      return "image";
    }
    return null;
  };

  const handleViewReceipt = async (receiptId: string) => {
    setViewReceiptError(null);

    if (receiptPreviewCache[receiptId]) {
      setExpandedReceiptId(receiptId);
      return;
    }

    setViewingReceiptId(receiptId);
    try {
      const status = receiptMetadata.status.get(receiptId);
      const storageKey = receiptMetadata.storage.get(receiptId);
      if (!storageKey) {
        setExpandedReceiptId((current) =>
          current === receiptId ? null : current
        );
        setViewReceiptError("Receipt is not available yet");
        return;
      }
      if (status === "FAILED") {
        setExpandedReceiptId((current) =>
          current === receiptId ? null : current
        );
        setViewReceiptError("Receipt processing failed");
        return;
      }
      const response = await api.get<{ url: string }>(
        `/trips/${tripId}/receipts/${receiptId}`
      );
      const url = response.url;
      if (url) {
        const receipt = receipts.find((item) => item.receiptId === receiptId);
        const preview = {
          url,
          title: receipt?.fileName ?? "Receipt",
          type: inferPreviewType(receipt?.fileName)
        };
        setReceiptPreviewCache((current) => ({
          ...current,
          [receiptId]: preview
        }));
        setExpandedReceiptId(receiptId);
      } else {
        setExpandedReceiptId((current) =>
          current === receiptId ? null : current
        );
        setViewReceiptError("No receipt preview available");
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to open receipt";
      setExpandedReceiptId((current) =>
        current === receiptId ? null : current
      );
      setViewReceiptError(message);
    } finally {
      setViewingReceiptId(null);
    }
  };

  return (
    <div className="grid-two">
      <section className="card">
        <div className="section-title">
          <h2>{editingExpense ? "Edit Expense" : "Log Expense"}</h2>
        </div>
        <AddExpenseForm
          tripId={tripId}
          members={members}
          currency={currency}
          receipts={receipts}
          isSubmitting={isCreating}
          onSubmit={onCreateExpense}
          currentUserId={currentUserId}
          prefill={expensePrefill}
          onPrefillConsumed={onExpensePrefillConsumed}
          editingLabel={editingExpense?.description ?? null}
          editingIsDraft={Boolean(editingExpense?.draft)}
          onCancelEdit={onCancelEditExpense}
        />
      </section>

      {draftExpenses.length > 0 && (
        <section
          className="card"
          style={{
            gridColumn: "1 / -1",
            border: "1px dashed rgba(250,204,21,0.45)"
          }}
        >
          <div className="section-title">
            <h2>Your drafts</h2>
            <span className="muted">
              Only you can see these until you publish.
            </span>
          </div>
          <div className="list">
            {draftExpenses.map((draft) => (
              <div
                key={draft.expenseId}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: "1rem",
                  flexWrap: "wrap",
                  border: "1px solid rgba(148,163,184,0.14)",
                  borderRadius: "0.85rem",
                  padding: "0.85rem 1rem"
                }}
              >
                <div style={{ minWidth: "12rem" }}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "0.5rem"
                    }}
                  >
                    <span
                      className="pill"
                      style={{
                        background: "rgba(250,204,21,0.16)",
                        color: "#fde68a",
                        fontSize: "0.72rem"
                      }}
                    >
                      Draft
                    </span>
                    <strong>{draft.description}</strong>
                  </div>
                  <p className="muted" style={{ margin: "0.3rem 0 0" }}>
                    {formatCurrency.format(draft.total)}
                    {draft.lineItems && draft.lineItems.length > 0
                      ? ` · ${draft.lineItems.length} ${
                          draft.lineItems.length === 1 ? "item" : "items"
                        }`
                      : ""}
                    {draft.receiptId ? " · receipt attached" : ""}
                    {" · saved "}
                    {formatDate(draft.updatedAt)}
                  </p>
                </div>
                <div style={{ display: "flex", gap: "0.5rem" }}>
                  <button
                    type="button"
                    className="primary"
                    style={{ paddingInline: "0.85rem" }}
                    disabled={publishingExpenseId === draft.expenseId}
                    onClick={() => {
                      void onPublishDraft(draft.expenseId);
                    }}
                  >
                    {publishingExpenseId === draft.expenseId
                      ? "Publishing…"
                      : "Publish"}
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => onEditExpense(draft)}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    style={{ opacity: 0.7 }}
                    disabled={deletePending && deletingExpenseId === draft.expenseId}
                    title="Deletes the draft permanently"
                    onClick={() => {
                      onDeleteExpense(
                        draft.expenseId,
                        draft.description,
                        true
                      ).catch(() => {});
                    }}
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="card" style={{ gridColumn: "1 / -1" }}>
        <div className="section-title">
          <h2>Expense History</h2>
          <span className="muted">{expenses.length} recorded</span>
        </div>
        {expenses.length === 0 ? (
          <p className="muted">No expenses yet.</p>
        ) : (
          <div className="list" style={{ gap: "1.5rem" }}>
            <ExpenseFilters
              members={members}
              membersById={membersById}
              categories={categories}
              searchTerm={searchTerm}
              onSearchTermChange={setSearchTerm}
              memberFilter={memberFilter}
              onMemberFilterChange={setMemberFilter}
              categoryFilter={categoryFilter}
              onCategoryFilterChange={setCategoryFilter}
              dateFrom={dateFrom}
              onDateFromChange={setDateFrom}
              dateTo={dateTo}
              onDateToChange={setDateTo}
              filteredCount={filteredExpenses.length}
              totalCount={expenses.length}
              filteredTotal={filteredTotal}
              formatCurrency={formatCurrency}
              onResetFilters={resetFilters}
            />
            {viewReceiptError && (
              <p style={{ color: "#f87171" }}>{viewReceiptError}</p>
            )}

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
                gap: "1.5rem",
                alignItems: "start"
              }}
            >
              <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
                {filteredExpenses.length === 0 ? (
                  <div className="empty-state">
                    <p className="empty-state__title">No matches.</p>
                    <p className="empty-state__hint">
                      Try widening the date range, picking a different person, or clear the active filters above.
                    </p>
                  </div>
                ) : (
                  expensesByDay.map((day) => {
                    const dayLabel = formatDayLabel(day.representativeIso);
                    return (
                      <div key={day.dayKey} className="day-group">
                        <div className="day-header">
                          <span className="day-header__date">
                            {dayLabel.primary}
                            {dayLabel.secondary && <small>{dayLabel.secondary}</small>}
                          </span>
                          <span className="day-header__right">
                            <span>{day.expenses.length} {day.expenses.length === 1 ? "expense" : "expenses"}</span>
                            <span className="day-header__total">{formatCurrency.format(day.total)}</span>
                          </span>
                        </div>
                        {day.expenses.map((expense) => (
                          <ExpenseCard
                            key={expense.expenseId}
                            expense={expense}
                            tripId={tripId}
                            membersById={membersById}
                            formatCurrency={formatCurrency}
                            currentUserId={currentUserId}
                            isTripOwner={isTripOwner}
                            commentsOpen={Boolean(openComments[expense.expenseId])}
                            onToggleComments={() => toggleComments(expense.expenseId)}
                            onRepeatExpense={onRepeatExpense}
                            onEditExpense={onEditExpense}
                            onDeleteExpense={onDeleteExpense}
                            deleteDisabled={
                              deletePending && deletingExpenseId === expense.expenseId
                            }
                            previewData={
                              expense.receiptId
                                ? receiptPreviewCache[expense.receiptId]
                                : undefined
                            }
                            isLoadingPreview={viewingReceiptId === expense.receiptId}
                            receiptStatus={
                              expense.receiptId
                                ? receiptMetadata.status.get(expense.receiptId)
                                : undefined
                            }
                            hasReceiptStorage={Boolean(
                              expense.receiptId &&
                                receiptMetadata.storage.get(expense.receiptId)
                            )}
                            onViewReceipt={(receiptId) => {
                              void handleViewReceipt(receiptId);
                            }}
                          />
                        ))}
                      </div>
                    );
                  })
                )}
                <RecentlyDeletedList
                  label="Expenses"
                  emptyHint={`${deletedExpenses.length} item${deletedExpenses.length === 1 ? "" : "s"}`}
                  items={deletedExpenses.map((expense) => ({
                    id: expense.expenseId,
                    title: (
                      <>
                        <strong>{formatCurrency.format(expense.total)}</strong> · {expense.description}
                      </>
                    ),
                    meta: `Deleted ${expense.deletedAt ? formatDate(expense.deletedAt) : ""} · paid by ${
                      membersById[expense.paidByMemberId] ?? expense.paidByMemberId
                    }`
                  }))}
                  onRestore={onRestoreExpense}
                  onPurge={onPurgeExpense}
                  restoringId={restoringExpenseId}
                  purgingId={purgingExpenseId}
                />
              </div>

              <ExpensesSidebar
                sortedTotals={sortedTotals}
                suggestions={suggestions}
                membersById={membersById}
                formatCurrency={formatCurrency}
                receipts={receipts}
                receiptsByStatus={receiptsByStatus}
                receiptUsage={receiptMetadata.usage}
                receiptPreviewCache={receiptPreviewCache}
                expandedReceiptId={expandedReceiptId}
                viewingReceiptId={viewingReceiptId}
                onSetExpandedReceiptId={setExpandedReceiptId}
                onViewReceipt={(receiptId) => {
                  void handleViewReceipt(receiptId);
                }}
              />
            </div>
          </div>
        )}
      </section>
    </div>
  );
};
