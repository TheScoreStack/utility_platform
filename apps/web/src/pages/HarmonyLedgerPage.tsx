import { FormEvent, Fragment, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../lib/api";
import HarmonySubNav from "../components/HarmonySubNav";
import {
  HarmonyLedgerEntry,
  HarmonyLedgerEntryType
} from "../types";
import { useHarmonyLedgerAccess } from "../modules/useHarmonyLedgerAccess";
import { useHarmonyLedgerEntries } from "../modules/useHarmonyLedgerEntries";
import { useConfirm } from "../components/ConfirmDialog";

interface EntryFormState {
  type: HarmonyLedgerEntryType;
  amount: string;
  currency: string;
  description: string;
  source: string;
  category: string;
  notes: string;
  memberName: string;
  groupId: string;
}

const defaultEntryForm: EntryFormState = {
  type: "DONATION",
  amount: "",
  currency: "USD",
  description: "",
  source: "",
  category: "",
  notes: "",
  memberName: "",
  groupId: ""
};

const entryTypeCopy: Record<
  HarmonyLedgerEntryType,
  { label: string; helper: string; sourceLabel: string }
> = {
  DONATION: {
    label: "Donation",
    helper: "Track community gifts flowing into Harmony Collective.",
    sourceLabel: "Donor or source"
  },
  INCOME: {
    label: "Income",
    helper: "Log revenue from services, grants, or product sales.",
    sourceLabel: "Client or source"
  },
  EXPENSE: {
    label: "Expense",
    helper: "Record money the collective spends to operate.",
    sourceLabel: "Vendor or payee"
  },
  REIMBURSEMENT: {
    label: "Reimbursement",
    helper: "Capture repayments from members covering shared costs.",
    sourceLabel: "Member"
  }
};

/** Sentinel `group` search-param value for entries with no group allocation. */
const UNALLOCATED_GROUP = "__unallocated";

const formatCurrencyValue = (value: number, currency: string) =>
  new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    maximumFractionDigits: 2
  }).format(value);

/** Effective ledger date: the actual transaction date when known, else the recording day. */
const entryDateOf = (entry: HarmonyLedgerEntry) =>
  entry.occurredAt ?? entry.recordedAt.slice(0, 10);

const formatMonthLabel = (monthKey: string) => {
  const [year, month] = monthKey.split("-").map(Number);
  return new Intl.DateTimeFormat(undefined, {
    month: "long",
    year: "numeric"
  }).format(new Date(year, month - 1, 1));
};

const csvField = (value: string) =>
  /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;

const formatDateTime = (value: string) =>
  new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));

const HarmonyLedgerPage = () => {
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const { data: accessData, isLoading: accessLoading } = useHarmonyLedgerAccess();
  const [entryForm, setEntryForm] = useState<EntryFormState>(defaultEntryForm);
  const [entryError, setEntryError] = useState<string | null>(null);
  const [menuEntryId, setMenuEntryId] = useState<string | null>(null);
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<EntryFormState>(defaultEntryForm);
  const [editError, setEditError] = useState<string | null>(null);
  const [monthFilter, setMonthFilter] = useState("");
  const [searchText, setSearchText] = useState("");
  const [searchParams, setSearchParams] = useSearchParams();
  const groupFilter = searchParams.get("group") ?? "";

  const entriesQuery = useHarmonyLedgerEntries(accessData?.isAdmin ?? false);

  const entryMutation = useMutation({
    mutationFn: (payload: unknown) =>
      api.post<HarmonyLedgerEntry>("/harmony-ledger/entries", payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["harmony-ledger", "entries"] });
      setEntryForm(defaultEntryForm);
      setEntryError(null);
    },
    onError: (error: unknown) => {
      if (error instanceof ApiError) {
        setEntryError(error.message);
      } else {
        setEntryError("Failed to record entry");
      }
    }
  });

  const updateEntryGroupMutation = useMutation({
    mutationFn: (payload: { entryId: string; recordedAt: string; groupId?: string | null }) =>
      api.patch<HarmonyLedgerEntry>(`/harmony-ledger/entries/${payload.entryId}`, {
        recordedAt: payload.recordedAt,
        groupId: payload.groupId ?? null
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["harmony-ledger", "entries"] });
    }
  });

  const editEntryMutation = useMutation({
    mutationFn: (payload: { entryId: string; body: Record<string, unknown> }) =>
      api.patch<HarmonyLedgerEntry>(
        `/harmony-ledger/entries/${payload.entryId}`,
        payload.body
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["harmony-ledger", "entries"] });
      setEditingEntryId(null);
      setEditError(null);
    },
    onError: (error: unknown) => {
      if (error instanceof ApiError) {
        setEditError(error.message);
      } else {
        setEditError("Failed to update entry");
      }
    }
  });

  const deleteEntryMutation = useMutation({
    mutationFn: (payload: { entryId: string; recordedAt: string }) =>
      api.delete(`/harmony-ledger/entries/${payload.entryId}`, {
        recordedAt: payload.recordedAt
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["harmony-ledger", "entries"] });
    }
  });

  const totals = entriesQuery.data?.totals;
  const entriesData = entriesQuery.data;
  const entries = useMemo(() => entriesData?.entries ?? [], [entriesData]);
  const groups = useMemo(() => entriesData?.groups ?? [], [entriesData]);
  const activeGroups = groups.filter((group) => group.isActive);
  const metricsCurrency = entries[0]?.currency ?? "USD";
  const monthOptions = useMemo(() => {
    const keys = new Set<string>();
    for (const entry of entries) {
      keys.add(entryDateOf(entry).slice(0, 7));
    }
    return [...keys].sort().reverse();
  }, [entries]);
  const normalizedSearch = searchText.trim().toLowerCase();
  const setGroupFilter = (value: string) => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (value) {
          next.set("group", value);
        } else {
          next.delete("group");
        }
        return next;
      },
      { replace: true }
    );
  };
  // Groups worth filtering by: active ones, plus archived ones that still own entries.
  const groupFilterOptions = useMemo(() => {
    const entryGroupIds = new Set<string>();
    for (const entry of entries) {
      if (entry.groupId) entryGroupIds.add(entry.groupId);
    }
    return groups.filter(
      (group) => group.isActive || entryGroupIds.has(group.groupId)
    );
  }, [entries, groups]);
  const groupFilterLabel =
    groupFilter === UNALLOCATED_GROUP
      ? "Unallocated"
      : groupFilter
        ? groups.find((group) => group.groupId === groupFilter)?.name ??
          "Unknown group"
        : "";
  const filtersActive =
    monthFilter !== "" || normalizedSearch !== "" || groupFilter !== "";
  const filteredEntries = useMemo(() => {
    if (!filtersActive) return entries;
    return entries.filter((entry) => {
      if (monthFilter && entryDateOf(entry).slice(0, 7) !== monthFilter) {
        return false;
      }
      if (groupFilter === UNALLOCATED_GROUP) {
        if (entry.groupId) return false;
      } else if (groupFilter && entry.groupId !== groupFilter) {
        return false;
      }
      if (!normalizedSearch) return true;
      return [
        entry.description,
        entry.source,
        entry.category,
        entry.memberName,
        entry.groupName,
        entry.type,
        entryTypeCopy[entry.type].label
      ].some((value) => value?.toLowerCase().includes(normalizedSearch));
    });
  }, [entries, filtersActive, groupFilter, monthFilter, normalizedSearch]);
  const filteredTotals = useMemo(() => {
    const sums = { donations: 0, income: 0, expenses: 0, reimbursements: 0, net: 0 };
    for (const entry of filteredEntries) {
      if (entry.type === "DONATION") sums.donations += entry.amount;
      else if (entry.type === "INCOME") sums.income += entry.amount;
      else if (entry.type === "EXPENSE") sums.expenses += entry.amount;
      else sums.reimbursements += entry.amount;
    }
    sums.net = sums.donations + sums.income + sums.reimbursements - sums.expenses;
    return sums;
  }, [filteredEntries]);

  const counterpartyLabel = entryTypeCopy[entryForm.type].sourceLabel;

  const handleEntrySubmit = (event: FormEvent) => {
    event.preventDefault();
    setEntryError(null);
    const amount = Number(entryForm.amount);
    if (!entryForm.amount || Number.isNaN(amount) || amount <= 0) {
      setEntryError("Enter a positive amount");
      return;
    }

    const payload = {
      type: entryForm.type,
      amount,
      currency: entryForm.currency || "USD",
      description: entryForm.description || undefined,
      source: entryForm.source || undefined,
      category: entryForm.category || undefined,
      notes: entryForm.notes || undefined,
      memberName: entryForm.memberName || undefined,
      groupId: entryForm.groupId || undefined
    };
    entryMutation.mutate(payload);
  };

  const handleEntryGroupChange = (
    entry: HarmonyLedgerEntry,
    groupId: string
  ) => {
    updateEntryGroupMutation.mutate({
      entryId: entry.entryId,
      recordedAt: entry.recordedAt,
      groupId: groupId || null
    });
    setMenuEntryId(null);
  };

  const startEditEntry = (entry: HarmonyLedgerEntry) => {
    setEditForm({
      type: entry.type,
      amount: String(entry.amount),
      currency: entry.currency,
      description: entry.description ?? "",
      source: entry.source ?? "",
      category: entry.category ?? "",
      notes: entry.notes ?? "",
      memberName: entry.memberName ?? "",
      groupId: entry.groupId ?? ""
    });
    setEditError(null);
    setEditingEntryId(entry.entryId);
    setMenuEntryId(null);
  };

  const cancelEditEntry = () => {
    setEditingEntryId(null);
    setEditError(null);
  };

  const handleEditSubmit = (event: FormEvent) => {
    event.preventDefault();
    setEditError(null);
    const entry = entries.find((item) => item.entryId === editingEntryId);
    if (!entry) return;
    const amount = Number(editForm.amount);
    if (!editForm.amount || Number.isNaN(amount) || amount <= 0) {
      setEditError("Enter a positive amount");
      return;
    }
    if (!editForm.currency.trim()) {
      setEditError("Enter a currency code");
      return;
    }

    // Send only what changed; null clears a text field server-side.
    const body: Record<string, unknown> = { recordedAt: entry.recordedAt };
    if (editForm.type !== entry.type) body.type = editForm.type;
    if (amount !== entry.amount) body.amount = amount;
    if (editForm.currency !== entry.currency) body.currency = editForm.currency;
    const textFields = ["description", "source", "category", "notes", "memberName"] as const;
    for (const field of textFields) {
      const next = editForm[field];
      if (next !== (entry[field] ?? "")) {
        body[field] = next === "" ? null : next;
      }
    }
    if ((editForm.groupId || null) !== (entry.groupId ?? null)) {
      body.groupId = editForm.groupId || null;
    }

    if (Object.keys(body).length === 1) {
      // Nothing changed — just close the editor.
      cancelEditEntry();
      return;
    }
    editEntryMutation.mutate({ entryId: entry.entryId, body });
  };

  const handleDeleteEntry = async (entry: HarmonyLedgerEntry) => {
    const ok = await confirm({
      title: `Delete "${entry.description ?? "Untitled"}"?`,
      body: "This cannot be undone.",
      confirmLabel: "Delete",
      tone: "danger"
    });
    if (!ok) return;
    deleteEntryMutation.mutate({
      entryId: entry.entryId,
      recordedAt: entry.recordedAt
    });
    setMenuEntryId(null);
  };

  const clearFilters = () => {
    setMonthFilter("");
    setSearchText("");
    setGroupFilter("");
  };

  const handleExportCsv = () => {
    if (!filteredEntries.length) return;
    const header = [
      "date",
      "type",
      "amount",
      "currency",
      "description",
      "source",
      "category",
      "group",
      "member",
      "notes",
      "recorded_by",
      "recorded_at"
    ];
    const rows = filteredEntries.map((entry) => [
      entryDateOf(entry),
      entry.type,
      String(entry.amount),
      entry.currency,
      entry.description ?? "",
      entry.source ?? "",
      entry.category ?? "",
      entry.groupName ??
        groups.find((group) => group.groupId === entry.groupId)?.name ??
        "",
      entry.memberName ?? "",
      entry.notes ?? "",
      entry.recordedByName ?? entry.recordedBy,
      entry.recordedAt
    ]);
    const csv = [header, ...rows]
      .map((row) => row.map(csvField).join(","))
      .join("\n");
    const suffix = monthFilter || new Date().toISOString().slice(0, 10);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `harmony-ledger-${suffix}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  };

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

  if (!accessData?.allowed || !accessData.isAdmin) {
    return (
      <div className="hl-page">
        <HarmonySubNav />
        <section className="hl-hero">
          <span className="hl-hero__eyebrow">Harmony Collective · private</span>
          <h1 className="hl-hero__title">
            Admins only <em>back here.</em>
          </h1>
          <p className="hl-hero__net">
            {accessData?.allowed
              ? "The full ledger is managed by admins — your overview has everything else."
              : "If you should have access, ask Hunter to add you."}
          </p>
          <div className="hl-hero__rule" aria-hidden="true" />
        </section>
      </div>
    );
  }

  return (
    <div className="hl-page">
      <HarmonySubNav />
      <section className="card">
        <div className="section-title">
          <div>
            <h2>Record Activity</h2>
            <p className="muted">{entryTypeCopy[entryForm.type].helper}</p>
          </div>
          {totals && (
            <div className="pill" style={{ background: "#DCFCE7", color: "#15803d" }}>
              Net {formatCurrencyValue(totals.net, metricsCurrency)}
            </div>
          )}
        </div>
        <form onSubmit={handleEntrySubmit} className="list" style={{ marginTop: "1rem" }}>
          <div className="input-group">
            <label htmlFor="entry-type">Type</label>
            <select
              id="entry-type"
              value={entryForm.type}
              onChange={(event) =>
                setEntryForm((prev) => ({ ...prev, type: event.target.value as HarmonyLedgerEntryType }))
              }
            >
              {Object.entries(entryTypeCopy).map(([value, meta]) => (
                <option key={value} value={value}>
                  {meta.label}
                </option>
              ))}
            </select>
          </div>
          <div className="input-group">
            <label htmlFor="entry-amount">Amount</label>
            <input
              id="entry-amount"
              type="number"
              min="0"
              step="0.01"
              required
              value={entryForm.amount}
              onChange={(event) => setEntryForm((prev) => ({ ...prev, amount: event.target.value }))}
            />
          </div>
          <div className="input-group">
            <label htmlFor="entry-description">Description</label>
            <input
              id="entry-description"
              value={entryForm.description}
              placeholder="e.g., Jazz Night fundraiser"
              onChange={(event) => setEntryForm((prev) => ({ ...prev, description: event.target.value }))}
            />
          </div>
          <div className="input-group">
            <label htmlFor="entry-source">{counterpartyLabel}</label>
            <input
              id="entry-source"
              value={entryForm.source}
              onChange={(event) => setEntryForm((prev) => ({ ...prev, source: event.target.value }))}
            />
          </div>
          <div className="input-group">
            <label htmlFor="entry-group">Group allocation</label>
            <select
              id="entry-group"
              value={entryForm.groupId}
              onChange={(event) => setEntryForm((prev) => ({ ...prev, groupId: event.target.value }))}
            >
              <option value="">General (no group)</option>
              {activeGroups.map((group) => (
                <option key={group.groupId} value={group.groupId}>
                  {group.name}
                </option>
              ))}
            </select>
          </div>
          <div className="input-group">
            <label htmlFor="entry-category">Category (optional)</label>
            <input
              id="entry-category"
              value={entryForm.category}
              onChange={(event) => setEntryForm((prev) => ({ ...prev, category: event.target.value }))}
            />
          </div>
          {entryForm.type === "REIMBURSEMENT" && (
            <div className="input-group">
              <label htmlFor="entry-member">Member (optional)</label>
              <input
                id="entry-member"
                value={entryForm.memberName}
                onChange={(event) => setEntryForm((prev) => ({ ...prev, memberName: event.target.value }))}
              />
            </div>
          )}
          <div className="input-group">
            <label htmlFor="entry-notes">Notes</label>
            <textarea
              id="entry-notes"
              value={entryForm.notes}
              onChange={(event) => setEntryForm((prev) => ({ ...prev, notes: event.target.value }))}
              rows={3}
            />
          </div>
          {entryError && <p className="error">{entryError}</p>}
          <button type="submit" disabled={entryMutation.isPending}>
            Save entry
          </button>
        </form>
      </section>

      <section className="card">
        <div className="section-title">
          <div>
            <h2>Ledger Entries</h2>
            <p className="muted">All Harmony Collective transactions.</p>
          </div>
          <button
            type="button"
            className="ghost"
            onClick={handleExportCsv}
            disabled={filteredEntries.length === 0}
            title={
              filteredEntries.length === 0
                ? "No entries to export"
                : "Download the entries below as CSV"
            }
          >
            Export CSV
          </button>
        </div>
        {entries.length > 0 && (
          <div className="hl-filter-bar">
            <select
              value={monthFilter}
              onChange={(event) => setMonthFilter(event.target.value)}
              aria-label="Filter by month"
            >
              <option value="">All time</option>
              {monthOptions.map((key) => (
                <option key={key} value={key}>
                  {formatMonthLabel(key)}
                </option>
              ))}
            </select>
            <select
              value={groupFilter}
              onChange={(event) => setGroupFilter(event.target.value)}
              aria-label="Filter by group"
            >
              <option value="">All groups</option>
              <option value={UNALLOCATED_GROUP}>Unallocated</option>
              {groupFilterOptions.map((group) => (
                <option key={group.groupId} value={group.groupId}>
                  {group.isActive ? group.name : `${group.name} (archived)`}
                </option>
              ))}
              {groupFilter &&
                groupFilter !== UNALLOCATED_GROUP &&
                !groupFilterOptions.some(
                  (group) => group.groupId === groupFilter
                ) && (
                  <option value={groupFilter}>
                    {(groups.find((group) => group.groupId === groupFilter)
                      ?.name ?? "Unknown group") + " (archived)"}
                  </option>
                )}
            </select>
            <input
              type="search"
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
              placeholder="Search description, source, group…"
              aria-label="Search entries"
            />
            {filtersActive && (
              <button type="button" className="ghost" onClick={clearFilters}>
                Clear filters
              </button>
            )}
          </div>
        )}
        {filtersActive && (
          <p className="hl-filter-summary">
            <strong>
              Filtered · {monthFilter ? formatMonthLabel(monthFilter) : "All time"}
              {groupFilterLabel ? ` · ${groupFilterLabel}` : ""}
              {normalizedSearch ? ` · “${searchText.trim()}”` : ""} ·{" "}
              {filteredEntries.length}{" "}
              {filteredEntries.length === 1 ? "entry" : "entries"}
            </strong>
            {" — "}
            Donations {formatCurrencyValue(filteredTotals.donations, metricsCurrency)} ·{" "}
            Income {formatCurrencyValue(filteredTotals.income, metricsCurrency)} ·{" "}
            Expenses {formatCurrencyValue(filteredTotals.expenses, metricsCurrency)} ·{" "}
            Reimbursements {formatCurrencyValue(filteredTotals.reimbursements, metricsCurrency)} ·{" "}
            Net {formatCurrencyValue(filteredTotals.net, metricsCurrency)}
          </p>
        )}
        {entriesQuery.isLoading ? (
          <p className="muted">Loading ledger…</p>
        ) : entries.length === 0 ? (
          <p className="muted">Nothing recorded yet. Add your first entry above.</p>
        ) : filteredEntries.length === 0 ? (
          <p className="muted">No entries match the current filters.</p>
        ) : (
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th style={{ width: "15%" }}>Date</th>
                  <th style={{ width: "10%" }}>Type</th>
                  <th>Description</th>
                  <th style={{ width: "15%" }}>Source</th>
                  <th style={{ width: "16%" }}>Group</th>
                  <th style={{ width: "15%" }}>Amount</th>
                  <th style={{ width: "8%" }}></th>
                </tr>
              </thead>
              <tbody>
                {filteredEntries.map((entry) => (
                  <Fragment key={entry.entryId}>
                    <tr>
                      <td>{formatDateTime(entry.recordedAt)}</td>
                      <td>{entryTypeCopy[entry.type].label}</td>
                      <td>
                        <strong>{entry.description || "Untitled"}</strong>
                        {entry.category && (
                          <p className="muted" style={{ margin: 0 }}>
                            {entry.category}
                          </p>
                        )}
                        {entry.notes && (
                          <p className="muted" style={{ margin: 0 }}>{entry.notes}</p>
                        )}
                      </td>
                      <td>
                        <p style={{ margin: 0 }}>{entry.source || entry.memberName || "—"}</p>
                        <p className="muted" style={{ margin: 0 }}>
                          Recorded by {entry.recordedByName ?? entry.recordedBy}
                        </p>
                      </td>
                      <td>
                        <select
                          value={entry.groupId ?? ""}
                          onChange={(event) =>
                            handleEntryGroupChange(entry, event.target.value)
                          }
                          disabled={updateEntryGroupMutation.isPending}
                        >
                          <option value="">Unallocated</option>
                          {activeGroups.map((group) => (
                            <option key={group.groupId} value={group.groupId}>
                              {group.name}
                            </option>
                          ))}
                          {entry.groupId &&
                            !activeGroups.some((group) => group.groupId === entry.groupId) && (
                              <option value={entry.groupId}>
                                {(groups.find((group) => group.groupId === entry.groupId)?.name ??
                                  entry.groupName ??
                                  "Unknown group") + " (archived)"}
                              </option>
                            )}
                        </select>
                      </td>
                      <td>
                        {formatCurrencyValue(entry.amount, entry.currency)}
                      </td>
                      <td className="entry-actions">
                        <button
                          type="button"
                          className="icon-button"
                          onClick={() =>
                            setMenuEntryId((current) => (current === entry.entryId ? null : entry.entryId))
                          }
                        >
                          ⋮
                        </button>
                        {menuEntryId === entry.entryId && (
                          <div className="entry-menu">
                            <button
                              type="button"
                              onClick={() => startEditEntry(entry)}
                            >
                              Edit entry
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteEntry(entry)}
                              disabled={deleteEntryMutation.isPending}
                            >
                              Delete entry
                            </button>
                            <button
                              type="button"
                              onClick={() => setMenuEntryId(null)}
                            >
                              Cancel
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                    {editingEntryId === entry.entryId && (
                      <tr className="hl-entry-edit-row">
                        <td colSpan={7}>
                          <form onSubmit={handleEditSubmit} className="hl-entry-edit">
                            <div className="hl-entry-edit__grid">
                              <div className="input-group">
                                <label htmlFor="edit-entry-type">Type</label>
                                <select
                                  id="edit-entry-type"
                                  value={editForm.type}
                                  onChange={(event) =>
                                    setEditForm((prev) => ({
                                      ...prev,
                                      type: event.target.value as HarmonyLedgerEntryType
                                    }))
                                  }
                                  disabled={editEntryMutation.isPending}
                                >
                                  {Object.entries(entryTypeCopy).map(([value, meta]) => (
                                    <option key={value} value={value}>
                                      {meta.label}
                                    </option>
                                  ))}
                                </select>
                              </div>
                              <div className="input-group">
                                <label htmlFor="edit-entry-amount">Amount</label>
                                <input
                                  id="edit-entry-amount"
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  required
                                  value={editForm.amount}
                                  onChange={(event) =>
                                    setEditForm((prev) => ({ ...prev, amount: event.target.value }))
                                  }
                                  disabled={editEntryMutation.isPending}
                                />
                              </div>
                              <div className="input-group">
                                <label htmlFor="edit-entry-currency">Currency</label>
                                <input
                                  id="edit-entry-currency"
                                  value={editForm.currency}
                                  placeholder="USD"
                                  onChange={(event) =>
                                    setEditForm((prev) => ({ ...prev, currency: event.target.value }))
                                  }
                                  disabled={editEntryMutation.isPending}
                                />
                              </div>
                              <div className="input-group">
                                <label htmlFor="edit-entry-group">Group allocation</label>
                                <select
                                  id="edit-entry-group"
                                  value={editForm.groupId}
                                  onChange={(event) =>
                                    setEditForm((prev) => ({ ...prev, groupId: event.target.value }))
                                  }
                                  disabled={editEntryMutation.isPending}
                                >
                                  <option value="">Unallocated</option>
                                  {activeGroups.map((group) => (
                                    <option key={group.groupId} value={group.groupId}>
                                      {group.name}
                                    </option>
                                  ))}
                                  {editForm.groupId &&
                                    !activeGroups.some(
                                      (group) => group.groupId === editForm.groupId
                                    ) && (
                                      <option value={editForm.groupId}>
                                        {(groups.find(
                                          (group) => group.groupId === editForm.groupId
                                        )?.name ?? "Unknown group") + " (archived)"}
                                      </option>
                                    )}
                                </select>
                              </div>
                              <div className="input-group">
                                <label htmlFor="edit-entry-description">Description</label>
                                <input
                                  id="edit-entry-description"
                                  value={editForm.description}
                                  onChange={(event) =>
                                    setEditForm((prev) => ({ ...prev, description: event.target.value }))
                                  }
                                  disabled={editEntryMutation.isPending}
                                />
                              </div>
                              <div className="input-group">
                                <label htmlFor="edit-entry-source">
                                  {entryTypeCopy[editForm.type].sourceLabel}
                                </label>
                                <input
                                  id="edit-entry-source"
                                  value={editForm.source}
                                  onChange={(event) =>
                                    setEditForm((prev) => ({ ...prev, source: event.target.value }))
                                  }
                                  disabled={editEntryMutation.isPending}
                                />
                              </div>
                              <div className="input-group">
                                <label htmlFor="edit-entry-category">Category</label>
                                <input
                                  id="edit-entry-category"
                                  value={editForm.category}
                                  onChange={(event) =>
                                    setEditForm((prev) => ({ ...prev, category: event.target.value }))
                                  }
                                  disabled={editEntryMutation.isPending}
                                />
                              </div>
                              <div className="input-group">
                                <label htmlFor="edit-entry-member">Member name</label>
                                <input
                                  id="edit-entry-member"
                                  value={editForm.memberName}
                                  onChange={(event) =>
                                    setEditForm((prev) => ({ ...prev, memberName: event.target.value }))
                                  }
                                  disabled={editEntryMutation.isPending}
                                />
                              </div>
                              <div className="input-group hl-entry-edit__wide">
                                <label htmlFor="edit-entry-notes">Notes</label>
                                <textarea
                                  id="edit-entry-notes"
                                  rows={2}
                                  value={editForm.notes}
                                  onChange={(event) =>
                                    setEditForm((prev) => ({ ...prev, notes: event.target.value }))
                                  }
                                  disabled={editEntryMutation.isPending}
                                />
                              </div>
                            </div>
                            {editError && <p className="error">{editError}</p>}
                            <div className="hl-entry-edit__actions">
                              <button type="submit" disabled={editEntryMutation.isPending}>
                                {editEntryMutation.isPending ? "Saving…" : "Save changes"}
                              </button>
                              <button
                                type="button"
                                className="ghost"
                                onClick={cancelEditEntry}
                                disabled={editEntryMutation.isPending}
                              >
                                Cancel
                              </button>
                            </div>
                          </form>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
};

export default HarmonyLedgerPage;
