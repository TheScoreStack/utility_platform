import { FormEvent, Fragment, useMemo, useState } from "react";
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
  HarmonyLedgerGroup,
  HarmonyLedgerGroupSummary,
  HarmonyLedgerTransfer
} from "../types";
import { useHarmonyLedgerAccess } from "../modules/useHarmonyLedgerAccess";
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
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<EntryFormState>(defaultEntryForm);
  const [editError, setEditError] = useState<string | null>(null);
  const [selectedUserId, setSelectedUserId] = useState<string>("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [monthFilter, setMonthFilter] = useState("");
  const [searchText, setSearchText] = useState("");
  const [newGroupName, setNewGroupName] = useState("");
  const [addGroupError, setAddGroupError] = useState<string | null>(null);
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [editingGroupName, setEditingGroupName] = useState("");
  const [groupErrors, setGroupErrors] = useState<Record<string, string>>({});

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

  const createGroupMutation = useMutation({
    mutationFn: (payload: { name: string }) =>
      api.post<HarmonyLedgerGroup>("/harmony-ledger/groups", payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["harmony-ledger", "entries"] });
      setNewGroupName("");
      setAddGroupError(null);
    },
    onError: (error: unknown) => {
      if (error instanceof ApiError) {
        setAddGroupError(error.message);
      } else {
        setAddGroupError("Unable to add group");
      }
    }
  });

  const updateGroupMutation = useMutation({
    mutationFn: (payload: {
      groupId: string;
      body: { name?: string; isActive?: boolean };
    }) =>
      api.patch<HarmonyLedgerGroup>(
        `/harmony-ledger/groups/${payload.groupId}`,
        payload.body
      ),
    onMutate: (payload) => {
      setGroupErrors((prev) => {
        if (!(payload.groupId in prev)) return prev;
        const next = { ...prev };
        delete next[payload.groupId];
        return next;
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["harmony-ledger", "entries"] });
      setEditingGroupId(null);
    },
    onError: (error: unknown, payload) => {
      setGroupErrors((prev) => ({
        ...prev,
        [payload.groupId]:
          error instanceof ApiError ? error.message : "Unable to update group"
      }));
    }
  });
  const busyGroupId = updateGroupMutation.isPending
    ? updateGroupMutation.variables?.groupId ?? null
    : null;

  const totals = entriesQuery.data?.totals;
  const entriesData = entriesQuery.data;
  const entries = useMemo(() => entriesData?.entries ?? [], [entriesData]);
  const groups = useMemo(() => entriesData?.groups ?? [], [entriesData]);
  const activeGroups = groups.filter((group) => group.isActive);
  const groupSummaries = useMemo(
    () => entriesData?.groupSummaries ?? [],
    [entriesData]
  );
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
  const monthOptions = useMemo(() => {
    const keys = new Set<string>();
    for (const entry of entries) {
      keys.add(entryDateOf(entry).slice(0, 7));
    }
    return [...keys].sort().reverse();
  }, [entries]);
  const normalizedSearch = searchText.trim().toLowerCase();
  const filtersActive = monthFilter !== "" || normalizedSearch !== "";
  const filteredEntries = useMemo(() => {
    if (!filtersActive) return entries;
    return entries.filter((entry) => {
      if (monthFilter && entryDateOf(entry).slice(0, 7) !== monthFilter) {
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
  }, [entries, filtersActive, monthFilter, normalizedSearch]);
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

  const handleDeleteTransfer = async (transfer: HarmonyLedgerTransfer) => {
    const ok = await confirm({
      title: "Delete this transfer?",
      body: "This cannot be undone.",
      confirmLabel: "Delete",
      tone: "danger"
    });
    if (!ok) return;
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

  const clearFilters = () => {
    setMonthFilter("");
    setSearchText("");
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

  const handleAddGroup = (event: FormEvent) => {
    event.preventDefault();
    setAddGroupError(null);
    const name = newGroupName.trim();
    if (!name) {
      setAddGroupError("Enter a group name");
      return;
    }
    createGroupMutation.mutate({ name });
  };

  const startRenameGroup = (group: HarmonyLedgerGroup) => {
    setEditingGroupId(group.groupId);
    setEditingGroupName(group.name);
    setGroupErrors((prev) => {
      if (!(group.groupId in prev)) return prev;
      const next = { ...prev };
      delete next[group.groupId];
      return next;
    });
  };

  const cancelRenameGroup = () => {
    setEditingGroupId(null);
    setEditingGroupName("");
  };

  const handleRenameSubmit = (event: FormEvent, group: HarmonyLedgerGroup) => {
    event.preventDefault();
    const name = editingGroupName.trim();
    if (!name) {
      setGroupErrors((prev) => ({ ...prev, [group.groupId]: "Enter a group name" }));
      return;
    }
    if (name === group.name) {
      cancelRenameGroup();
      return;
    }
    updateGroupMutation.mutate({ groupId: group.groupId, body: { name } });
  };

  const toggleGroupActive = (group: HarmonyLedgerGroup) => {
    updateGroupMutation.mutate({
      groupId: group.groupId,
      body: { isActive: !group.isActive }
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
              {activeGroups.map((group) => (
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
              {activeGroups.map((group) => (
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

      {accessData.isAdmin && (
        <section className="card">
          <div className="section-title">
            <div>
              <h2>Manage Groups</h2>
              <p className="muted">
                Archiving hides a group from pickers but keeps its history — entries keep their group.
              </p>
            </div>
          </div>
          {groups.length === 0 ? (
            <p className="muted">No groups yet. Add your first one below.</p>
          ) : (
            <div className="list">
              {groups.map((group) => {
                const busy = busyGroupId === group.groupId;
                return (
                  <div key={group.groupId}>
                    <div className="pill-row">
                      {editingGroupId === group.groupId ? (
                        <form
                          className="hl-group-manage__form"
                          onSubmit={(event) => handleRenameSubmit(event, group)}
                        >
                          <input
                            value={editingGroupName}
                            onChange={(event) => setEditingGroupName(event.target.value)}
                            aria-label={`Rename ${group.name}`}
                            disabled={busy}
                            autoFocus
                          />
                          <button type="submit" disabled={busy}>
                            {busy ? "Saving…" : "Save"}
                          </button>
                          <button
                            type="button"
                            className="ghost"
                            onClick={cancelRenameGroup}
                            disabled={busy}
                          >
                            Cancel
                          </button>
                        </form>
                      ) : (
                        <>
                          <div>
                            <p style={{ margin: 0, fontWeight: 600 }}>
                              {group.name}
                              {!group.isActive && (
                                <span
                                  className="pill"
                                  style={{
                                    marginLeft: "0.5rem",
                                    background: "rgba(148, 163, 184, 0.18)",
                                    color: "#94a3b8"
                                  }}
                                >
                                  Archived
                                </span>
                              )}
                            </p>
                          </div>
                          <div className="hl-txn-actions">
                            <button
                              type="button"
                              className="ghost"
                              onClick={() => startRenameGroup(group)}
                              disabled={busy}
                            >
                              Rename
                            </button>
                            <button
                              type="button"
                              className="ghost"
                              onClick={() => toggleGroupActive(group)}
                              disabled={busy}
                            >
                              {busy ? "Saving…" : group.isActive ? "Archive" : "Unarchive"}
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                    {groupErrors[group.groupId] && (
                      <p className="error" style={{ margin: "0.35rem 0 0" }}>
                        {groupErrors[group.groupId]}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          <hr />
          <form className="hl-group-manage__form" onSubmit={handleAddGroup}>
            <input
              value={newGroupName}
              placeholder="New group name"
              aria-label="New group name"
              onChange={(event) => setNewGroupName(event.target.value)}
              disabled={createGroupMutation.isPending}
            />
            <button type="submit" disabled={createGroupMutation.isPending}>
              {createGroupMutation.isPending ? "Adding…" : "Add group"}
            </button>
          </form>
          {addGroupError && (
            <p className="error" style={{ margin: "0.5rem 0 0" }}>
              {addGroupError}
            </p>
          )}
        </section>
      )}

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
