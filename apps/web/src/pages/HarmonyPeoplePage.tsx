import { FormEvent, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../lib/api";
import HarmonySubNav from "../components/HarmonySubNav";
import UserSelect from "../components/UserSelect";
import { HarmonyLedgerAccessRecord, HarmonyLedgerRole } from "../types";
import { useHarmonyLedgerAccess } from "../modules/useHarmonyLedgerAccess";
import { useConfirm } from "../components/ConfirmDialog";

const roleCopy: Record<string, { label: string; helper: string }> = {
  VIEWER: { label: "Viewer", helper: "Sees the overview — nothing else" },
  ADMIN: { label: "Admin", helper: "Full access: ledger, statements, people" }
};

const roleOf = (record: HarmonyLedgerAccessRecord): HarmonyLedgerRole =>
  record.role === "ADMIN" || record.isAdmin ? "ADMIN" : "VIEWER";

const HarmonyPeoplePage = () => {
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const { data: accessData, isLoading: accessLoading } = useHarmonyLedgerAccess();
  const isAdmin = accessData?.isAdmin ?? false;

  const [selectedUserId, setSelectedUserId] = useState<string>("");
  const [newMemberRole, setNewMemberRole] = useState<HarmonyLedgerRole>("VIEWER");
  const [accessError, setAccessError] = useState<string | null>(null);

  const invalidateAccess = () =>
    queryClient.invalidateQueries({ queryKey: ["harmony-ledger", "access"] });

  const addAccessMutation = useMutation({
    mutationFn: (payload: unknown) =>
      api.post<HarmonyLedgerAccessRecord>("/harmony-ledger/access", payload),
    onSuccess: () => {
      invalidateAccess();
      setSelectedUserId("");
      setNewMemberRole("VIEWER");
      setAccessError(null);
    },
    onError: (error: unknown) => {
      setAccessError(
        error instanceof ApiError ? error.message : "Unable to add this person"
      );
    }
  });

  const updateAccessRoleMutation = useMutation({
    mutationFn: (payload: { accessId: string; role: HarmonyLedgerRole }) =>
      api.patch<HarmonyLedgerAccessRecord>(
        `/harmony-ledger/access/${payload.accessId}`,
        { role: payload.role }
      ),
    onSuccess: () => {
      invalidateAccess();
      setAccessError(null);
    },
    onError: (error: unknown) => {
      setAccessError(
        error instanceof ApiError ? error.message : "Unable to change role"
      );
    }
  });

  const removeAccessMutation = useMutation({
    mutationFn: (accessId: string) => api.delete(`/harmony-ledger/access/${accessId}`),
    onSuccess: () => {
      invalidateAccess();
      setAccessError(null);
    },
    onError: (error: unknown) => {
      setAccessError(
        error instanceof ApiError ? error.message : "Unable to remove access"
      );
    }
  });

  const handleAccessSubmit = (event: FormEvent) => {
    event.preventDefault();
    setAccessError(null);
    if (!selectedUserId) {
      setAccessError("Select a person to add");
      return;
    }
    addAccessMutation.mutate({
      userId: selectedUserId,
      role: newMemberRole
    });
  };

  const handleRemove = async (record: HarmonyLedgerAccessRecord) => {
    const name = record.displayName ?? record.email ?? record.userId;
    const ok = await confirm({
      title: `Remove ${name}?`,
      body: "They lose access to Harmony Collective immediately. Entries they recorded are kept.",
      confirmLabel: "Remove",
      tone: "danger"
    });
    if (!ok) return;
    removeAccessMutation.mutate(record.accessId);
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
              ? "Only admins can manage who has access."
              : "If you should have access, ask Hunter to add you."}
          </p>
          <div className="hl-hero__rule" aria-hidden="true" />
        </section>
      </div>
    );
  }

  const members = accessData.members ?? [];

  return (
    <div className="hl-page">
      <HarmonySubNav />

      <section className="card">
        <div className="section-title">
          <div>
            <h2>People</h2>
            <p className="muted">
              Viewers see the overview only; admins run the books.
            </p>
          </div>
        </div>
        {members.length === 0 ? (
          <p className="muted">No one has access yet.</p>
        ) : (
          <div className="list">
            {members.map((record) => {
              const role = roleOf(record);
              const isSelf = record.accessId === accessData.currentAccessId;
              return (
                <div key={record.accessId} className="pill-row">
                  <div>
                    <p style={{ margin: 0, fontWeight: 600 }}>
                      {record.displayName ?? record.email ?? record.userId}
                    </p>
                    <p className="muted" style={{ margin: 0 }}>
                      {record.email || "Pending email"} · {roleCopy[role].label}
                      {record.addedByName ? ` · added by ${record.addedByName}` : ""}
                    </p>
                  </div>
                  {isSelf ? (
                    <span className="pill" style={{ background: "#E0F2FE", color: "#0369a1" }}>
                      You
                    </span>
                  ) : (
                    <div className="hl-txn-actions">
                      <select
                        value={role}
                        onChange={(event) =>
                          updateAccessRoleMutation.mutate({
                            accessId: record.accessId,
                            role: event.target.value as HarmonyLedgerRole
                          })
                        }
                        disabled={updateAccessRoleMutation.isPending}
                        aria-label={`Role for ${record.displayName ?? record.email ?? record.userId}`}
                      >
                        {Object.entries(roleCopy).map(([value, meta]) => (
                          <option key={value} value={value}>
                            {meta.label}
                          </option>
                        ))}
                      </select>
                      <button
                        className="ghost"
                        type="button"
                        onClick={() => handleRemove(record)}
                        disabled={removeAccessMutation.isPending}
                      >
                        Remove
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
        <hr />
        <form onSubmit={handleAccessSubmit} className="list">
          <UserSelect value={selectedUserId} onChange={setSelectedUserId} />
          <div className="input-group">
            <label htmlFor="access-role">Role</label>
            <select
              id="access-role"
              value={newMemberRole}
              onChange={(event) =>
                setNewMemberRole(event.target.value as HarmonyLedgerRole)
              }
            >
              {Object.entries(roleCopy).map(([value, meta]) => (
                <option key={value} value={value}>
                  {meta.label}
                </option>
              ))}
            </select>
            <p className="muted" style={{ margin: 0 }}>
              {roleCopy[newMemberRole].helper}.
            </p>
          </div>
          {accessError && <p className="error">{accessError}</p>}
          <button type="submit" disabled={addAccessMutation.isPending}>
            {addAccessMutation.isPending ? "Adding…" : "Add person"}
          </button>
        </form>
      </section>
    </div>
  );
};

export default HarmonyPeoplePage;
