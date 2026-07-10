import { FormEvent, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../lib/api";
import HarmonySubNav from "../components/HarmonySubNav";
import {
  HarmonyLedgerEntryType,
  HarmonyLedgerGroup,
  HarmonyLedgerTransfer,
  HarmonyRecurringCadence,
  HarmonyRecurringTemplate
} from "../types";
import { useHarmonyLedgerAccess } from "../modules/useHarmonyLedgerAccess";
import { useHarmonyLedgerEntries } from "../modules/useHarmonyLedgerEntries";
import { useHarmonyRecurringTemplates } from "../modules/useHarmonyRecurringTemplates";
import { useConfirm } from "../components/ConfirmDialog";

interface TransferFormState {
  fromGroupId: string;
  toGroupId: string;
  amount: string;
  note: string;
}

interface RecurringFormState {
  type: HarmonyLedgerEntryType;
  amount: string;
  description: string;
  category: string;
  groupId: string;
  cadence: HarmonyRecurringCadence;
}

const defaultRecurringForm: RecurringFormState = {
  type: "DONATION",
  amount: "",
  description: "",
  category: "",
  groupId: "",
  cadence: "monthly"
};

const cadenceCopy: Record<HarmonyRecurringCadence, { label: string; unit: string }> = {
  weekly: { label: "Weekly", unit: "week" },
  monthly: { label: "Monthly", unit: "month" }
};

const entryTypeLabels: Record<HarmonyLedgerEntryType, string> = {
  DONATION: "Donation",
  INCOME: "Income",
  EXPENSE: "Expense",
  REIMBURSEMENT: "Reimbursement"
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

const formatShortDate = (value: string) =>
  new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric"
  }).format(new Date(value));

const HarmonyManagePage = () => {
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const { data: accessData, isLoading: accessLoading } = useHarmonyLedgerAccess();
  const isAdmin = accessData?.isAdmin ?? false;

  const [transferError, setTransferError] = useState<string | null>(null);
  const [transferForm, setTransferForm] = useState<TransferFormState>({
    fromGroupId: "",
    toGroupId: "",
    amount: "",
    note: ""
  });
  const [menuTransferId, setMenuTransferId] = useState<string | null>(null);
  const [newGroupName, setNewGroupName] = useState("");
  const [addGroupError, setAddGroupError] = useState<string | null>(null);
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [editingGroupName, setEditingGroupName] = useState("");
  const [groupErrors, setGroupErrors] = useState<Record<string, string>>({});
  const [recurringForm, setRecurringForm] = useState<RecurringFormState>(defaultRecurringForm);
  const [recurringError, setRecurringError] = useState<string | null>(null);
  const [recurringRowErrors, setRecurringRowErrors] = useState<Record<string, string>>({});

  const entriesQuery = useHarmonyLedgerEntries(isAdmin);
  const recurringQuery = useHarmonyRecurringTemplates(isAdmin);

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

  const createRecurringMutation = useMutation({
    mutationFn: (payload: unknown) =>
      api.post<HarmonyRecurringTemplate>("/harmony-ledger/recurring", payload),
    onSuccess: () => {
      // Entries only change when the schedule fires, so just refresh templates.
      queryClient.invalidateQueries({ queryKey: ["harmony-ledger", "recurring"] });
      setRecurringForm(defaultRecurringForm);
      setRecurringError(null);
    },
    onError: (error: unknown) => {
      if (error instanceof ApiError) {
        setRecurringError(error.message);
      } else {
        setRecurringError("Unable to add recurring entry");
      }
    }
  });

  const clearRecurringRowError = (templateId: string) => {
    setRecurringRowErrors((prev) => {
      if (!(templateId in prev)) return prev;
      const next = { ...prev };
      delete next[templateId];
      return next;
    });
  };

  const updateRecurringMutation = useMutation({
    mutationFn: (payload: { templateId: string; body: { isActive?: boolean } }) =>
      api.patch<HarmonyRecurringTemplate>(
        `/harmony-ledger/recurring/${payload.templateId}`,
        payload.body
      ),
    onMutate: (payload) => clearRecurringRowError(payload.templateId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["harmony-ledger", "recurring"] });
    },
    onError: (error: unknown, payload) => {
      setRecurringRowErrors((prev) => ({
        ...prev,
        [payload.templateId]:
          error instanceof ApiError ? error.message : "Unable to update recurring entry"
      }));
    }
  });

  const deleteRecurringMutation = useMutation({
    mutationFn: (templateId: string) =>
      api.delete(`/harmony-ledger/recurring/${templateId}`),
    onMutate: (templateId) => clearRecurringRowError(templateId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["harmony-ledger", "recurring"] });
    },
    onError: (error: unknown, templateId) => {
      setRecurringRowErrors((prev) => ({
        ...prev,
        [templateId]:
          error instanceof ApiError ? error.message : "Unable to delete recurring entry"
      }));
    }
  });

  const busyTemplateId = updateRecurringMutation.isPending
    ? updateRecurringMutation.variables?.templateId ?? null
    : deleteRecurringMutation.isPending
      ? deleteRecurringMutation.variables ?? null
      : null;

  const groups = entriesQuery.data?.groups ?? [];
  const activeGroups = groups.filter((group) => group.isActive);
  const transfers = entriesQuery.data?.transfers ?? [];
  const recurringTemplates = recurringQuery.data?.templates ?? [];

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

  const handleRecurringSubmit = (event: FormEvent) => {
    event.preventDefault();
    setRecurringError(null);
    const amount = Number(recurringForm.amount);
    if (!recurringForm.amount || Number.isNaN(amount) || amount <= 0) {
      setRecurringError("Enter a positive amount");
      return;
    }
    createRecurringMutation.mutate({
      type: recurringForm.type,
      amount,
      description: recurringForm.description || undefined,
      category: recurringForm.category || undefined,
      groupId: recurringForm.groupId || undefined,
      cadence: recurringForm.cadence
    });
  };

  const toggleRecurringActive = (template: HarmonyRecurringTemplate) => {
    updateRecurringMutation.mutate({
      templateId: template.templateId,
      body: { isActive: !template.isActive }
    });
  };

  const handleDeleteRecurring = async (template: HarmonyRecurringTemplate) => {
    const ok = await confirm({
      title: `Delete "${template.description ?? entryTypeLabels[template.type]}"?`,
      body: "Future scheduled entries stop. Entries it already posted are kept.",
      confirmLabel: "Delete",
      tone: "danger"
    });
    if (!ok) return;
    deleteRecurringMutation.mutate(template.templateId);
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

  if (!accessData?.allowed || !isAdmin) {
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
              ? "Transfers, recurring entries, and groups are managed by admins."
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

      <section className="card">
        <div className="section-title">
          <div>
            <h2>Recurring</h2>
            <p className="muted">
              Entries that post themselves on a weekly or monthly schedule.
            </p>
          </div>
        </div>
        {recurringQuery.isLoading ? (
          <p className="muted">Loading recurring entries…</p>
        ) : recurringTemplates.length === 0 ? (
          <p className="muted">No recurring entries yet. Add your first one below.</p>
        ) : (
          <div className="list">
            {recurringTemplates.map((template) => {
              const busy = busyTemplateId === template.templateId;
              const groupLabel =
                template.groupName ??
                groups.find((group) => group.groupId === template.groupId)?.name ??
                "Unallocated";
              return (
                <div key={template.templateId}>
                  <div className="pill-row">
                    <div>
                      <p style={{ margin: 0, fontWeight: 600 }}>
                        {template.description || entryTypeLabels[template.type]}
                        {!template.isActive && (
                          <span
                            className="pill"
                            style={{
                              marginLeft: "0.5rem",
                              background: "rgba(148, 163, 184, 0.18)",
                              color: "#94a3b8"
                            }}
                          >
                            Paused
                          </span>
                        )}
                      </p>
                      <p className="muted" style={{ margin: 0 }}>
                        {entryTypeLabels[template.type]} ·{" "}
                        {formatCurrencyValue(template.amount, template.currency)} ·{" "}
                        {groupLabel} · {cadenceCopy[template.cadence].label} · next:{" "}
                        {formatShortDate(template.nextRunAt)}
                      </p>
                    </div>
                    <div className="hl-txn-actions">
                      <button
                        type="button"
                        className="ghost"
                        onClick={() => toggleRecurringActive(template)}
                        disabled={busy}
                      >
                        {busy && updateRecurringMutation.isPending
                          ? "Saving…"
                          : template.isActive
                            ? "Pause"
                            : "Resume"}
                      </button>
                      <button
                        type="button"
                        className="ghost"
                        onClick={() => handleDeleteRecurring(template)}
                        disabled={busy}
                      >
                        {busy && deleteRecurringMutation.isPending ? "Deleting…" : "Delete"}
                      </button>
                    </div>
                  </div>
                  {recurringRowErrors[template.templateId] && (
                    <p className="error" style={{ margin: "0.35rem 0 0" }}>
                      {recurringRowErrors[template.templateId]}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}
        <hr />
        <form onSubmit={handleRecurringSubmit} className="list">
          <div className="input-group">
            <label htmlFor="recurring-type">Type</label>
            <select
              id="recurring-type"
              value={recurringForm.type}
              onChange={(event) =>
                setRecurringForm((prev) => ({
                  ...prev,
                  type: event.target.value as HarmonyLedgerEntryType
                }))
              }
              disabled={createRecurringMutation.isPending}
            >
              {Object.entries(entryTypeLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div className="input-group">
            <label htmlFor="recurring-amount">Amount</label>
            <input
              id="recurring-amount"
              type="number"
              min="0"
              step="0.01"
              required
              value={recurringForm.amount}
              onChange={(event) =>
                setRecurringForm((prev) => ({ ...prev, amount: event.target.value }))
              }
              disabled={createRecurringMutation.isPending}
            />
          </div>
          <div className="input-group">
            <label htmlFor="recurring-description">Description</label>
            <input
              id="recurring-description"
              value={recurringForm.description}
              placeholder="e.g., Rehearsal space rent"
              onChange={(event) =>
                setRecurringForm((prev) => ({ ...prev, description: event.target.value }))
              }
              disabled={createRecurringMutation.isPending}
            />
          </div>
          <div className="input-group">
            <label htmlFor="recurring-category">Category (optional)</label>
            <input
              id="recurring-category"
              value={recurringForm.category}
              onChange={(event) =>
                setRecurringForm((prev) => ({ ...prev, category: event.target.value }))
              }
              disabled={createRecurringMutation.isPending}
            />
          </div>
          <div className="input-group">
            <label htmlFor="recurring-group">Group allocation</label>
            <select
              id="recurring-group"
              value={recurringForm.groupId}
              onChange={(event) =>
                setRecurringForm((prev) => ({ ...prev, groupId: event.target.value }))
              }
              disabled={createRecurringMutation.isPending}
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
            <label htmlFor="recurring-cadence">Cadence</label>
            <select
              id="recurring-cadence"
              value={recurringForm.cadence}
              onChange={(event) =>
                setRecurringForm((prev) => ({
                  ...prev,
                  cadence: event.target.value as HarmonyRecurringCadence
                }))
              }
              disabled={createRecurringMutation.isPending}
            >
              {Object.entries(cadenceCopy).map(([value, meta]) => (
                <option key={value} value={value}>
                  {meta.label}
                </option>
              ))}
            </select>
          </div>
          {recurringError && <p className="error">{recurringError}</p>}
          <button type="submit" disabled={createRecurringMutation.isPending}>
            {createRecurringMutation.isPending ? "Adding…" : "Add recurring entry"}
          </button>
          <p className="muted" style={{ margin: 0 }}>
            Posts automatically each {cadenceCopy[recurringForm.cadence].unit}, starting
            next cycle.
          </p>
        </form>
      </section>

      <section className="card">
        <div className="section-title">
          <div>
            <h2>Groups</h2>
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
    </div>
  );
};

export default HarmonyManagePage;
