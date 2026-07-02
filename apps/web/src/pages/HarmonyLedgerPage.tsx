import { FormEvent, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../lib/api";
import HarmonySubNav from "../components/HarmonySubNav";
import UserSelect from "../components/UserSelect";
import { seedAvatar } from "../lib/avatarPalette";
import {
  HarmonyLedgerAccessRecord,
  HarmonyLedgerAccessResponse,
  HarmonyLedgerEntriesResponse,
  HarmonyLedgerEntry,
  HarmonyLedgerEntryType,
  HarmonyLedgerGroupSummary,
  HarmonyLedgerTransfer
} from "../types";
import { useHarmonyLedgerAccess } from "../modules/useHarmonyLedgerAccess";

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

interface TransferFormState {
  fromGroupId: string;
  toGroupId: string;
  amount: string;
  note: string;
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

const formatCurrencyValue = (value: number, currency: string) =>
  new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    maximumFractionDigits: 2
  }).format(value);

const formatDateTime = (value: string) =>
  new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));

const HarmonyLedgerPage = () => {
  const queryClient = useQueryClient();
  const { data: accessData, isLoading: accessLoading } = useHarmonyLedgerAccess();
  const [entryForm, setEntryForm] = useState<EntryFormState>(defaultEntryForm);
  const [entryError, setEntryError] = useState<string | null>(null);
  const [accessError, setAccessError] = useState<string | null>(null);
  const [transferError, setTransferError] = useState<string | null>(null);
  const [transferForm, setTransferForm] = useState<TransferFormState>({
    fromGroupId: "",
    toGroupId: "",
    amount: "",
    note: ""
  });
  const [menuEntryId, setMenuEntryId] = useState<string | null>(null);
  const [menuTransferId, setMenuTransferId] = useState<string | null>(null);
  const [selectedUserId, setSelectedUserId] = useState<string>("");
  const [isAdmin, setIsAdmin] = useState(false);

  const entriesQuery = useQuery({
    queryKey: ["harmony-ledger", "entries"],
    queryFn: () => api.get<HarmonyLedgerEntriesResponse>("/harmony-ledger/entries"),
    enabled: accessData?.allowed ?? false
  });

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

  const addAccessMutation = useMutation({
    mutationFn: (payload: unknown) =>
      api.post<HarmonyLedgerAccessRecord>("/harmony-ledger/access", payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["harmony-ledger", "access"] });
      setSelectedUserId("");
      setIsAdmin(false);
      setAccessError(null);
    },
    onError: (error: unknown) => {
      if (error instanceof ApiError) {
        setAccessError(error.message);
      } else {
        setAccessError("Unable to invite member");
      }
    }
  });

  const removeAccessMutation = useMutation({
    mutationFn: (accessId: string) => api.delete(`/harmony-ledger/access/${accessId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["harmony-ledger", "access"] });
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

  const deleteEntryMutation = useMutation({
    mutationFn: (payload: { entryId: string; recordedAt: string }) =>
      api.delete(`/harmony-ledger/entries/${payload.entryId}`, {
        recordedAt: payload.recordedAt
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["harmony-ledger", "entries"] });
    }
  });

  const transferMutation = useMutation({
    mutationFn: (payload: { fromGroupId?: string; toGroupId?: string; amount: number; note?: string }) =>
      api.post<HarmonyLedgerTransfer>("/harmony-ledger/transfers", payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["harmony-ledger", "entries"] });
      setTransferForm({ fromGroupId: "", toGroupId: "", amount: "", note: "" });
      setTransferError(null);
    },
    onError: (error: unknown) => {
      if (error instanceof ApiError) {
        setTransferError(error.message);
      } else {
        setTransferError("Unable to move funds");
      }
    }
  });

  const deleteTransferMutation = useMutation({
    mutationFn: (payload: { transferId: string; createdAt: string }) =>
      api.delete(`/harmony-ledger/transfers/${payload.transferId}`, {
        createdAt: payload.createdAt
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["harmony-ledger", "entries"] });
    }
  });

  const totals = entriesQuery.data?.totals;
  const entries = entriesQuery.data?.entries ?? [];
  const groups = entriesQuery.data?.groups ?? [];
  const groupSummaries = entriesQuery.data?.groupSummaries ?? [];
  const unallocated = entriesQuery.data?.unallocated;
  const transfers = entriesQuery.data?.transfers ?? [];
  const groupSummaryMap = useMemo(() => {
    const map = new Map<string, HarmonyLedgerGroupSummary>();
    for (const summary of groupSummaries) {
      map.set(summary.groupId, summary);
    }
    return map;
  }, [groupSummaries]);
  const groupMetrics = useMemo(() => {
    if (!groups.length) {
      return [] as HarmonyLedgerGroupSummary[];
    }
    return groups.map((group) =>
      groupSummaryMap.get(group.groupId) ?? {
        groupId: group.groupId,
        name: group.name,
        donations: 0,
        income: 0,
        expenses: 0,
        reimbursements: 0,
        transfersIn: 0,
        transfersOut: 0,
        net: 0
      }
    );
  }, [groups, groupSummaryMap]);
  const metricsCurrency = entries[0]?.currency ?? "USD";
  const unallocatedInflow = unallocated
    ? unallocated.donations + unallocated.income + unallocated.reimbursements + unallocated.transfersIn
    : 0;
  const unallocatedOutflow = unallocated
    ? unallocated.expenses + unallocated.transfersOut
    : 0;

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

  const handleDeleteEntry = (entry: HarmonyLedgerEntry) => {
    if (!window.confirm(`Delete "${entry.description ?? "Untitled"}"? This cannot be undone.`)) {
      return;
    }
    deleteEntryMutation.mutate({
      entryId: entry.entryId,
      recordedAt: entry.recordedAt
    });
    setMenuEntryId(null);
  };

  const handleDeleteTransfer = (transfer: HarmonyLedgerTransfer) => {
    if (!window.confirm("Delete this transfer?")) {
      return;
    }
    deleteTransferMutation.mutate({
      transferId: transfer.transferId,
      createdAt: transfer.createdAt
    });
    setMenuTransferId(null);
  };

  const handleAccessSubmit = (event: FormEvent) => {
    event.preventDefault();
    setAccessError(null);
    if (!selectedUserId) {
      setAccessError("Select a person to add");
      return;
    }
    addAccessMutation.mutate({
      userId: selectedUserId,
      isAdmin
    });
  };

  const handleTransferSubmit = (event: FormEvent) => {
    event.preventDefault();
    setTransferError(null);
    const amount = Number(transferForm.amount);
    if (!transferForm.amount || Number.isNaN(amount) || amount <= 0) {
      setTransferError("Enter a positive transfer amount");
      return;
    }
    if (transferForm.fromGroupId === transferForm.toGroupId) {
      setTransferError("Choose different source and destination");
      return;
    }
    if (!transferForm.fromGroupId && !transferForm.toGroupId) {
      setTransferError("Select at least one group to adjust");
      return;
    }
    transferMutation.mutate({
      fromGroupId: transferForm.fromGroupId || undefined,
      toGroupId: transferForm.toGroupId || undefined,
      amount,
      note: transferForm.note || undefined
    });
  };

  const renderAccessSection = (data: HarmonyLedgerAccessResponse) => {
    if (!data.allowed) {
      return null;
    }

    return (
      <section className="card">
        <div className="section-title">
          <div>
            <h2>Harmony Collective Access</h2>
            <p className="muted">Manage who can view this private ledger.</p>
          </div>
        </div>
        {!data.members?.length ? (
          <p className="muted">No teammates have access yet.</p>
        ) : (
          <div className="list">
            {data.members?.map((record) => (
              <div key={record.accessId} className="pill-row">
                <div>
                  <p style={{ margin: 0, fontWeight: 600 }}>{record.displayName ?? record.email ?? record.userId}</p>
                  <p className="muted" style={{ margin: 0 }}>
                    {record.email || "Pending email"} • {record.isAdmin ? "Admin" : "Member"}
                  </p>
                </div>
                {data.isAdmin && record.accessId !== data.currentAccessId && (
                  <button
                    className="ghost"
                    type="button"
                    onClick={() => removeAccessMutation.mutate(record.accessId)}
                    disabled={removeAccessMutation.isPending}
                  >
                    Remove
                  </button>
                )}
                {record.accessId === data.currentAccessId && (
                  <span className="pill" style={{ background: "#E0F2FE", color: "#0369a1" }}>
                    You
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
        <hr />
        <form onSubmit={handleAccessSubmit} className="list">
          <UserSelect
            value={selectedUserId}
            onChange={setSelectedUserId}
            disabled={!data.isAdmin}
          />
          <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <input
              type="checkbox"
              checked={isAdmin}
              onChange={(event) => setIsAdmin(event.target.checked)}
              disabled={!data.isAdmin}
            />
            Grant admin privileges
          </label>
          {accessError && <p className="error">{accessError}</p>}
          <button type="submit" disabled={!data.isAdmin || addAccessMutation.isPending}>
            Invite member
          </button>
          {!data.isAdmin && (
            <p className="muted" style={{ margin: 0 }}>
              Only admins can invite others. Ask Hunter to promote you if needed.
            </p>
          )}
        </form>
      </section>
    );
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

  return (
    <div className="hl-page">
      <HarmonySubNav />
      <div className="grid-two">
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
          {totals ? (
            <div className="metrics-row">
              <div>
                <p className="muted">Donations</p>
                <strong>{formatCurrencyValue(totals.donations, metricsCurrency)}</strong>
              </div>
              <div>
                <p className="muted">Income</p>
                <strong>{formatCurrencyValue(totals.income, metricsCurrency)}</strong>
              </div>
              <div>
                <p className="muted">Expenses</p>
                <strong>{formatCurrencyValue(totals.expenses, metricsCurrency)}</strong>
              </div>
              <div>
                <p className="muted">Reimbursements</p>
                <strong>{formatCurrencyValue(totals.reimbursements, metricsCurrency)}</strong>
              </div>
            </div>
          ) : (
            <p className="muted">No ledger data yet.</p>
          )}
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
                {groups.map((group) => (
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
        {renderAccessSection(accessData)}
      </div>

      <section className="card">
        <div className="section-title">
          <div>
            <h2>Unallocated Funds</h2>
            <p className="muted">Money not yet assigned to a Harmony group.</p>
          </div>
          {unallocated && (
            <div className="pill" style={{ background: "#E0E7FF", color: "#312E81" }}>
              {formatCurrencyValue(unallocated.net, metricsCurrency)} net
            </div>
          )}
        </div>
        {unallocated ? (
          <div className="group-summary-grid">
            <div className="group-summary-card">
              <div className="group-summary-details">
                <span>Inflow</span>
                <strong>{formatCurrencyValue(unallocatedInflow, metricsCurrency)}</strong>
              </div>
              <div className="group-summary-details">
                <span>Outflow</span>
                <strong>{formatCurrencyValue(unallocatedOutflow, metricsCurrency)}</strong>
              </div>
              <p className="muted" style={{ marginTop: "0.5rem" }}>
                Use the group selector in the table below to allocate any of these entries.
              </p>
            </div>
          </div>
        ) : (
          <p className="muted">No unallocated entries yet.</p>
        )}
      </section>

      <section className="card">
        <div className="section-title">
          <div>
            <h2>Transfer Funds</h2>
            <p className="muted">Shift balance between groups without creating new cash movement.</p>
          </div>
        </div>
        <form onSubmit={handleTransferSubmit} className="list">
          <div className="input-group">
            <label htmlFor="transfer-from">From (optional)</label>
            <select
              id="transfer-from"
              value={transferForm.fromGroupId}
              onChange={(event) => setTransferForm((prev) => ({ ...prev, fromGroupId: event.target.value }))}
              disabled={transferMutation.isPending}
            >
              <option value="">Unallocated</option>
              {groups.map((group) => (
                <option key={group.groupId} value={group.groupId}>
                  {group.name}
                </option>
              ))}
            </select>
          </div>
          <div className="input-group">
            <label htmlFor="transfer-to">To (optional)</label>
            <select
              id="transfer-to"
              value={transferForm.toGroupId}
              onChange={(event) => setTransferForm((prev) => ({ ...prev, toGroupId: event.target.value }))}
              disabled={transferMutation.isPending}
            >
              <option value="">Unallocated</option>
              {groups.map((group) => (
                <option key={group.groupId} value={group.groupId}>
                  {group.name}
                </option>
              ))}
            </select>
          </div>
          <div className="input-group">
            <label htmlFor="transfer-amount">Amount</label>
            <input
              id="transfer-amount"
              type="number"
              min="0"
              step="0.01"
              value={transferForm.amount}
              onChange={(event) => setTransferForm((prev) => ({ ...prev, amount: event.target.value }))}
              disabled={transferMutation.isPending}
              required
            />
          </div>
          <div className="input-group">
            <label htmlFor="transfer-note">Note (optional)</label>
            <textarea
              id="transfer-note"
              rows={2}
              value={transferForm.note}
              onChange={(event) => setTransferForm((prev) => ({ ...prev, note: event.target.value }))}
              disabled={transferMutation.isPending}
            />
          </div>
          {transferError && <p className="error">{transferError}</p>}
          <button type="submit" disabled={transferMutation.isPending}>
            Move funds
          </button>
          <p className="muted" style={{ margin: 0 }}>
            Leave either dropdown on &ldquo;Unallocated&rdquo; to move money in or out of the general pool.
          </p>
        </form>
      </section>

      {groupMetrics.length > 0 && (
        <section className="hl-section">
          <div className="hl-section-head">
            <h2 className="hl-section-head__title">Group allocations</h2>
            <span className="hl-section-head__count">
              {groupMetrics.length} {groupMetrics.length === 1 ? "group" : "groups"}
            </span>
          </div>
          <div className="hl-group-list">
            {groupMetrics.map((group, idx) => {
              const palette = seedAvatar(group.groupId);
              const inflow =
                group.donations + group.income + group.reimbursements + group.transfersIn;
              const outflow = group.expenses + group.transfersOut;
              const positive = group.net > 0.01;
              const negative = group.net < -0.01;
              const tintClass = positive
                ? "hl-group--owed"
                : negative
                  ? "hl-group--owe"
                  : "hl-group--neutral";
              return (
                <article
                  key={group.groupId}
                  className={`hl-group ${tintClass}`}
                  style={{ animationDelay: `${0.06 * idx}s` }}
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
                          ↑ {formatCurrencyValue(inflow, metricsCurrency)}
                        </span>
                        <span className="hl-group__flow hl-group__flow--out">
                          ↓ {formatCurrencyValue(outflow, metricsCurrency)}
                        </span>
                      </p>
                    </div>
                    <span
                      className={`hl-group__net hl-group__net--${positive ? "owed" : negative ? "owe" : "neutral"}`}
                    >
                      {formatCurrencyValue(group.net, metricsCurrency)}
                    </span>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      )}

      <section className="card">
        <div className="section-title">
          <div>
            <h2>Ledger Entries</h2>
            <p className="muted">All Harmony Collective transactions.</p>
          </div>
        </div>
        {entriesQuery.isLoading ? (
          <p className="muted">Loading ledger…</p>
        ) : entries.length === 0 ? (
          <p className="muted">Nothing recorded yet. Add your first entry above.</p>
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
                {entries.map((entry) => (
                  <tr key={entry.entryId}>
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
                        {groups.map((group) => (
                          <option key={group.groupId} value={group.groupId}>
                            {group.name}
                          </option>
                        ))}
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
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {transfers.length > 0 && (
        <section className="card">
          <div className="section-title">
            <div>
              <h2>Transfer History</h2>
              <p className="muted">Recent reallocations between groups.</p>
            </div>
          </div>
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th style={{ width: "20%" }}>Date</th>
                  <th style={{ width: "20%" }}>From</th>
                  <th style={{ width: "20%" }}>To</th>
                  <th style={{ width: "15%" }}>Amount</th>
                  <th>Note</th>
                  <th style={{ width: "8%" }}></th>
                </tr>
              </thead>
              <tbody>
                {transfers.map((transfer) => (
                  <tr key={transfer.transferId}>
                    <td>{formatDateTime(transfer.createdAt)}</td>
                    <td>{transfer.fromGroupName ?? "Unallocated"}</td>
                    <td>{transfer.toGroupName ?? "Unallocated"}</td>
                    <td>{formatCurrencyValue(transfer.amount, transfer.currency)}</td>
                    <td>{transfer.note ?? "—"}</td>
                    <td className="entry-actions">
                      <button
                        type="button"
                        className="icon-button"
                        onClick={() =>
                          setMenuTransferId((current) =>
                            current === transfer.transferId ? null : transfer.transferId
                          )
                        }
                      >
                        ⋮
                      </button>
                      {menuTransferId === transfer.transferId && (
                        <div className="entry-menu">
                          <button
                            type="button"
                            onClick={() => handleDeleteTransfer(transfer)}
                            disabled={deleteTransferMutation.isPending}
                          >
                            Delete transfer
                          </button>
                          <button type="button" onClick={() => setMenuTransferId(null)}>
                            Cancel
                          </button>
                        </div>
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

export default HarmonyLedgerPage;
