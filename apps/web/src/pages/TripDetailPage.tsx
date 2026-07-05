import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import { useAuthenticator } from "@aws-amplify/ui-react";
import { type CreateExpenseInput, type ExpensePrefill } from "../components/AddExpenseForm";
import { type SettlementPrefill } from "../components/SettlementForm";
import { api, ApiError, searchUsers as searchUsersRequest } from "../lib/api";
import { computeSettlementSuggestions } from "../lib/settlementSuggestions";
import { TripDetailSkeleton } from "../components/trip/TripDetailSkeleton";
import { UndoToast } from "../components/trip/UndoToast";
import { OverviewTab } from "../components/trip/OverviewTab";
import { ExpensesTab } from "../components/trip/ExpensesTab";
import { SettlementsTab } from "../components/trip/SettlementsTab";
import { ActivityTab } from "../components/trip/ActivityTab";
import { PeopleTab, type PaymentMethodsInput } from "../components/trip/PeopleTab";
import type {
  TripSummary,
  Expense,
  Settlement,
  Trip,
  PaymentMethods
} from "../types";

type TripTab = "overview" | "expenses" | "settlements" | "activity" | "people";

type TripDetailsFormState = {
  name: string;
  startDate: string;
  endDate: string;
};

type DetailsMessage = {
  type: "success" | "error";
  text: string;
};

type TripUpdateInput = {
  name?: string;
  startDate?: string | null;
  endDate?: string | null;
};

function useDebouncedValue<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const handle = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(handle);
  }, [value, delay]);

  return debouncedValue;
}

const TripDetailPage = () => {
  const { tripId } = useParams<{ tripId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuthenticator((context) => [context.user]);
  const userAttributes =
    user && "attributes" in user
      ? (user as { attributes?: Record<string, string> }).attributes
      : undefined;
  const loggedInUserId =
    user?.userId ??
    userAttributes?.sub ??
    user?.username ??
    undefined;

  const [activeTab, setActiveTab] = useState<TripTab>("overview");
  const [settlementPrefill, setSettlementPrefill] = useState<SettlementPrefill | null>(null);
  const [expensePrefill, setExpensePrefill] = useState<ExpensePrefill | null>(null);
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);
  const [undoToast, setUndoToast] = useState<{
    nonce: number;
    title: string;
    kind: "expense" | "settlement";
    id: string;
  } | null>(null);
  const [memberSearchTerm, setMemberSearchTerm] = useState("");
  const [memberFeedback, setMemberFeedback] = useState<string | null>(null);
  const [isEditingDetails, setIsEditingDetails] = useState(false);
  const [detailsForm, setDetailsForm] = useState<TripDetailsFormState>({
    name: "",
    startDate: "",
    endDate: ""
  });
  const [detailsMessage, setDetailsMessage] = useState<DetailsMessage | null>(null);
  const [paymentMethodsMessage, setPaymentMethodsMessage] = useState<string | null>(null);

  const queryKey = useMemo(() => ["trip", tripId], [tripId]);

  const { data, isLoading, error, isFetching } = useQuery({
    queryKey,
    queryFn: () => api.get<TripSummary>(`/trips/${tripId}`),
    enabled: Boolean(tripId)
  });

  const syncDetailsFormFromTrip = useCallback(() => {
    if (!data?.trip) return;
    setDetailsForm({
      name: data.trip.name ?? "",
      startDate: data.trip.startDate ?? "",
      endDate: data.trip.endDate ?? ""
    });
  }, [data?.trip?.name, data?.trip?.startDate, data?.trip?.endDate]);

  useEffect(() => {
    syncDetailsFormFromTrip();
  }, [syncDetailsFormFromTrip]);

  const handleTabChange = useCallback(
    (tab: TripTab) => {
      setActiveTab(tab);
      if (tripId) {
        void queryClient.refetchQueries({ queryKey, type: "active" });
      }
    },
    [queryClient, queryKey, tripId]
  );

  const handleUseSuggestion = useCallback(
    (suggestion: { from: string; to: string; amount: number }) => {
      setSettlementPrefill({
        from: suggestion.from,
        to: suggestion.to,
        amount: suggestion.amount,
        nonce: Date.now()
      });
      setActiveTab("settlements");
    },
    []
  );

  const buildExpensePrefill = useCallback((expense: Expense): ExpensePrefill => {
    const taxAmount = expense.tax ?? 0;
    const tipAmount = expense.tip ?? 0;
    const subtotal = Math.max(0, expense.total - taxAmount - tipAmount);
    const hasItems = Boolean(expense.lineItems?.length);
    const shareCount = expense.sharedWithMemberIds.length;
    const evenShare = shareCount > 0 ? expense.total / shareCount : 0;
    const isEven =
      !hasItems &&
      shareCount > 0 &&
      expense.allocations.length === shareCount &&
      expense.allocations.every((a) => Math.abs(a.amount - evenShare) <= 0.02);

    return {
      nonce: Date.now(),
      description: expense.description,
      vendor: expense.vendor,
      category: expense.category,
      subtotal: subtotal.toFixed(2),
      tax: taxAmount > 0 ? taxAmount.toFixed(2) : "",
      tip: tipAmount > 0 ? tipAmount.toFixed(2) : "",
      paidByMemberId: expense.paidByMemberId,
      sharedWithMemberIds: expense.sharedWithMemberIds,
      splitEvenly: isEven,
      allocations:
        isEven || hasItems
          ? undefined
          : Object.fromEntries(expense.allocations.map((a) => [a.memberId, a.amount.toFixed(2)])),
      lineItems: hasItems
        ? expense.lineItems?.map((item) => ({
            description: item.description,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            total: item.total.toFixed(2),
            assignedMemberIds: item.assignedMemberIds
          }))
        : undefined,
      extrasSplitMode: expense.extrasSplitMode
    };
  }, []);

  const handleRepeatExpense = useCallback((expense: Expense) => {
    setEditingExpense(null);
    setExpensePrefill(buildExpensePrefill(expense));
    setActiveTab("expenses");
  }, [buildExpensePrefill]);

  const handleEditExpense = useCallback((expense: Expense) => {
    setEditingExpense(expense);
    setExpensePrefill(buildExpensePrefill(expense));
    setActiveTab("expenses");
  }, [buildExpensePrefill]);

  const createExpenseMutation = useMutation({
    mutationFn: (payload: CreateExpenseInput) =>
      api.post<Expense>(`/trips/${tripId}/expenses`, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
    }
  });

  const updateExpenseMutation = useMutation({
    mutationFn: ({
      expenseId,
      payload
    }: {
      expenseId: string;
      payload: Record<string, unknown>;
    }) => api.patch<void>(`/trips/${tripId}/expenses/${expenseId}`, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
    }
  });

  const handleSubmitExpense = useCallback(
    async (input: CreateExpenseInput) => {
      if (!editingExpense) {
        return createExpenseMutation.mutateAsync(input);
      }
      // PATCH semantics: omitted fields keep their stored value, so cleared
      // optional fields are sent explicitly (empty string / 0 / empty items).
      await updateExpenseMutation.mutateAsync({
        expenseId: editingExpense.expenseId,
        payload: {
          description: input.description,
          vendor: input.vendor ?? "",
          category: input.category ?? "",
          currency: input.currency,
          paidByMemberId: input.paidByMemberId,
          total: input.total,
          tax: input.tax ?? 0,
          tip: input.tip ?? 0,
          sharedWithMemberIds: input.sharedWithMemberIds,
          allocations: input.allocations,
          lineItems: input.lineItems ?? [],
          extrasSplitMode: input.extrasSplitMode,
          remainderMemberId: input.remainderMemberId,
          receiptId: input.receiptId,
          draft: input.draft
        }
      });
      setEditingExpense(null);
    },
    [editingExpense, createExpenseMutation, updateExpenseMutation]
  );

  const publishDraftMutation = useMutation({
    mutationFn: (expenseId: string) =>
      api.patch<void>(`/trips/${tripId}/expenses/${expenseId}`, {
        draft: false
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
    }
  });

  const inviteQuery = useQuery({
    queryKey: ["trip-invite", tripId],
    queryFn: () =>
      api.get<{ invite: import("../types").TripInvite | null }>(
        `/trips/${tripId}/invite`
      ),
    enabled: Boolean(tripId)
  });

  const createInviteMutation = useMutation({
    mutationFn: () => {
      if (!tripId) throw new Error("Trip not found");
      return api.post<{ invite: import("../types").TripInvite }>(
        `/trips/${tripId}/invite`,
        {}
      );
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["trip-invite", tripId] })
  });

  const revokeInviteMutation = useMutation({
    mutationFn: () => {
      if (!tripId) throw new Error("Trip not found");
      return api.delete<void>(`/trips/${tripId}/invite`);
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["trip-invite", tripId] })
  });

  const archiveTripMutation = useMutation({
    mutationFn: () => {
      if (!tripId) throw new Error("Trip not found");
      return api.post<void>(`/trips/${tripId}/archive`, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      queryClient.invalidateQueries({ queryKey: ["trips"] });
    }
  });

  const unarchiveTripMutation = useMutation({
    mutationFn: () => {
      if (!tripId) throw new Error("Trip not found");
      return api.post<void>(`/trips/${tripId}/unarchive`, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      queryClient.invalidateQueries({ queryKey: ["trips"] });
    }
  });

  const updateTripMutation = useMutation({
    mutationFn: (payload: TripUpdateInput) => {
      if (!tripId) {
        throw new Error("Trip not found");
      }
      return api.patch<Trip>(`/trips/${tripId}`, payload);
    },
    onSuccess: (updatedTrip) => {
      queryClient.invalidateQueries({ queryKey });
      setDetailsMessage({ type: "success", text: "Group details updated" });
      setIsEditingDetails(false);
      setDetailsForm({
        name: updatedTrip.name,
        startDate: updatedTrip.startDate ?? "",
        endDate: updatedTrip.endDate ?? ""
      });
    },
    onError: (err: unknown) => {
      if (err instanceof ApiError) {
        setDetailsMessage({ type: "error", text: err.message });
      } else {
        setDetailsMessage({
          type: "error",
          text: "Failed to update group details"
        });
      }
    }
  });

  const deleteExpenseMutation = useMutation<void, unknown, { expenseId: string; description: string; isDraft?: boolean }>({
    mutationFn: ({ expenseId }) => {
      if (!tripId) {
        throw new Error("Trip not found");
      }
      return api.delete<void>(`/trips/${tripId}/expenses/${expenseId}`);
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey });
      // Drafts are purged outright server-side, so there's nothing to undo.
      if (variables.isDraft) return;
      setUndoToast({
        nonce: Date.now(),
        kind: "expense",
        id: variables.expenseId,
        title: `Deleted "${variables.description}"`
      });
    }
  });

  const settlementMutation = useMutation({
    mutationFn: (payload: {
      fromMemberId: string;
      toMemberId: string;
      amount: number;
      note?: string;
    }) => api.post<Settlement>(`/trips/${tripId}/settlements`, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
    }
  });

  const restoreExpenseMutation = useMutation<void, unknown, string>({
    mutationFn: (expenseId: string) => {
      if (!tripId) throw new Error("Trip not found");
      return api.post<void>(`/trips/${tripId}/expenses/${expenseId}/restore`, {});
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey })
  });

  const purgeExpenseMutation = useMutation<void, unknown, string>({
    mutationFn: (expenseId: string) => {
      if (!tripId) throw new Error("Trip not found");
      return api.delete<void>(`/trips/${tripId}/expenses/${expenseId}/purge`);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey })
  });

  const restoreSettlementMutation = useMutation<void, unknown, string>({
    mutationFn: (settlementId: string) => {
      if (!tripId) throw new Error("Trip not found");
      return api.post<void>(`/trips/${tripId}/settlements/${settlementId}/restore`, {});
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey })
  });

  const purgeSettlementMutation = useMutation<void, unknown, string>({
    mutationFn: (settlementId: string) => {
      if (!tripId) throw new Error("Trip not found");
      return api.delete<void>(`/trips/${tripId}/settlements/${settlementId}/purge`);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey })
  });

  const deleteSettlementMutation = useMutation<void, unknown, { settlementId: string; label: string }>({
    mutationFn: ({ settlementId }) => {
      if (!tripId) {
        throw new Error("Trip not found");
      }
      return api.delete<void>(
        `/trips/${tripId}/settlements/${settlementId}`
      );
    },
    onSuccess: (_, variables) => {
      setUndoToast({
        nonce: Date.now(),
        kind: "settlement",
        id: variables.settlementId,
        title: `Deleted settlement (${variables.label})`
      });
      queryClient.invalidateQueries({ queryKey });
    }
  });

  const confirmSettlementMutation = useMutation({
    mutationFn: (payload: { settlementId: string; confirmed: boolean }) =>
      api.patch<void>(
        `/trips/${tripId}/settlements/${payload.settlementId}`,
        { confirmed: payload.confirmed }
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
    }
  });

  const updateSettlementMutation = useMutation({
    mutationFn: (payload: {
      settlementId: string;
      amount: number;
      note: string;
    }) =>
      api.patch<void>(`/trips/${tripId}/settlements/${payload.settlementId}`, {
        amount: payload.amount,
        note: payload.note
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
    }
  });

  const addMemberMutation = useMutation({
    mutationFn: (payload: { members: { userId?: string; name?: string }[] }) =>
      api.post(`/trips/${tripId}/members`, payload),
    onMutate: () => {
      setMemberFeedback(null);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      setMemberFeedback("Member added to group");
    },
    onError: (err: unknown) => {
      if (err instanceof ApiError) {
        setMemberFeedback(err.message);
      } else {
        setMemberFeedback("Failed to add member");
      }
    }
  });

  const removeMemberMutation = useMutation<void, unknown, string>({
    mutationFn: (memberId: string) => {
      if (!tripId) {
        throw new Error("Trip not found");
      }
      return api.delete<void>(`/trips/${tripId}/members/${memberId}`);
    },
    onMutate: () => {
      setMemberFeedback(null);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      setMemberFeedback("Member removed from group");
    },
    onError: (err: unknown) => {
      if (err instanceof ApiError) {
        setMemberFeedback(err.message);
      } else {
        setMemberFeedback("Failed to remove member");
      }
    }
  });

  const savePaymentMethodsMutation = useMutation({
    mutationFn: (payload: PaymentMethodsInput) => {
      if (!tripId) {
        throw new Error("Trip not found");
      }
      return api.patch<void>(`/trips/${tripId}/members/payment-methods`, payload);
    },
    onMutate: () => {
      setPaymentMethodsMessage(null);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      setPaymentMethodsMessage("Payment methods saved");
    },
    onError: (err: unknown) => {
      if (err instanceof ApiError) {
        setPaymentMethodsMessage(err.message);
      } else {
        setPaymentMethodsMessage("Failed to save payment methods");
      }
    }
  });

  const handleSearchTermChange = (value: string) => {
    setMemberSearchTerm(value);
    setMemberFeedback(null);
  };

  const debouncedSearch = useDebouncedValue(memberSearchTerm, 250);
  const trimmedSearch = debouncedSearch.trim();
  const shouldSearch = trimmedSearch.length >= 1;

  const userSearchQuery = useQuery({
    queryKey: ["user-search", trimmedSearch],
    queryFn: () => searchUsersRequest(trimmedSearch).then((res) => res.users),
    enabled: shouldSearch
  });

  const memberSearchResults = shouldSearch ? userSearchQuery.data ?? [] : [];

  const memberSearchMessage = useMemo(() => {
    if (!memberSearchTerm.trim()) {
      return "Start typing to find people by name or email.";
    }

    if (!shouldSearch) {
      return "Keep typing to search.";
    }

    if (userSearchQuery.isFetching) {
      return "Searching…";
    }

    if (userSearchQuery.isError) {
      const err = userSearchQuery.error;
      return err instanceof ApiError ? err.message : "Unable to search users.";
    }

  if (memberSearchResults.length === 0) {
      return "No matches yet.";
    }

    return null;
  }, [memberSearchTerm, shouldSearch, userSearchQuery.isFetching, userSearchQuery.isError, userSearchQuery.error, memberSearchResults.length]);

  const paymentMethodsByMember = useMemo(() => {
    if (!data?.members) return {} as Record<string, PaymentMethods>;
    return Object.fromEntries(
      data.members.map((member) => [
        member.memberId,
        member.paymentMethods ?? {}
      ])
    );
  }, [data?.members]);

  const membersById = useMemo(() => {
    if (!data?.members) return {} as Record<string, string>;
    const currentId = loggedInUserId ?? data.currentUserId;
    return Object.fromEntries(
      data.members.map((member) => [
        member.memberId,
        `${member.displayName ?? member.email ?? member.memberId}${member.memberId === currentId ? " (you)" : ""}`
      ])
    );
  }, [data?.members, data?.currentUserId, loggedInUserId]);

  const settlementSuggestions = useMemo(
    () => computeSettlementSuggestions(data?.balances ?? []),
    [data?.balances]
  );

  const handleSavePaymentMethods = useCallback(
    (methods: PaymentMethodsInput) => {
      savePaymentMethodsMutation.mutate(methods);
    },
    [savePaymentMethodsMutation]
  );

  const handleStartEditingDetails = () => {
    syncDetailsFormFromTrip();
    setDetailsMessage(null);
    setIsEditingDetails(true);
  };

  const handleCancelDetailsEdit = () => {
    syncDetailsFormFromTrip();
    setDetailsMessage(null);
    setIsEditingDetails(false);
  };

  const handleDetailsSubmit = (event: FormEvent) => {
    event.preventDefault();
    setDetailsMessage(null);
    if (!detailsForm.name.trim()) {
      setDetailsMessage({ type: "error", text: "Group name is required" });
      return;
    }

    updateTripMutation.mutate({
      name: detailsForm.name.trim(),
      startDate: detailsForm.startDate ? detailsForm.startDate : null,
      endDate: detailsForm.endDate ? detailsForm.endDate : null
    });
  };

  if (!tripId) {
    return (
      <div className="empty-state">
        <p className="empty-state__title">No group selected.</p>
        <p className="empty-state__hint">Pick one from your trip list to see balances and expenses.</p>
      </div>
    );
  }

  if (isLoading) {
    return <TripDetailSkeleton />;
  }

  if (error || !data) {
    return (
      <div className="empty-state" style={{ borderColor: "rgba(248,113,113,0.35)" }}>
        <p className="empty-state__title" style={{ color: "#fda4af" }}>
          We couldn’t load this group.
        </p>
        <p className="empty-state__hint">
          Check your connection and try again — your data is safe.
        </p>
      </div>
    );
  }

  const { trip, members, expenses, receipts, balances, settlements, pendingSettlements } = data;
  const effectiveCurrentUserId = loggedInUserId ?? data.currentUserId;
  const canManageMembers = trip.ownerId === effectiveCurrentUserId;

  return (
    <div className="trip-detail">
      {trip.archivedAt && (
        <div className="archive-banner ov-rise ov-rise-1">
          <div className="archive-banner__body">
            <span className="archive-banner__eyebrow">Archived</span>
            <p className="archive-banner__title">
              This tab is <em>closed.</em>
            </p>
            <p className="archive-banner__hint">
              You&rsquo;re viewing it read-style; everything still works. Unarchive
              to bring it back to your active list.
            </p>
          </div>
          {canManageMembers && (
            <button
              type="button"
              className="archive-banner__action"
              disabled={unarchiveTripMutation.isPending}
              onClick={() => unarchiveTripMutation.mutate()}
            >
              {unarchiveTripMutation.isPending ? "Reopening…" : "Unarchive ↻"}
            </button>
          )}
        </div>
      )}

      <section className="card" style={{ marginBottom: "1rem" }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: "1rem"
          }}
        >
          <div>
            <h2 style={{ margin: 0 }}>{trip.name}</h2>
            <p className="muted" style={{ margin: "0.5rem 0 0" }}>
              {trip.startDate ? trip.startDate : "Flexible start"}
              {trip.endDate ? ` → ${trip.endDate}` : ""}
            </p>
          </div>
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            {canManageMembers && !isEditingDetails && (
              <button type="button" className="secondary" onClick={handleStartEditingDetails}>
                Edit details
              </button>
            )}
            {!isEditingDetails && (
              <button
                type="button"
                className="secondary"
                title="Open a printable one-page summary"
                onClick={() => navigate(`/group-expenses/trips/${trip.tripId}/summary`)}
              >
                Summary
              </button>
            )}
            {canManageMembers && !isEditingDetails && !trip.archivedAt && (
              <button
                type="button"
                className="secondary"
                title="Archive this trip — it'll move out of your active tabs but stays viewable."
                disabled={archiveTripMutation.isPending}
                onClick={() => {
                  if (!window.confirm(`Archive “${trip.name}”? It'll move to the Archived list. You can unarchive it any time.`)) return;
                  archiveTripMutation.mutate();
                }}
              >
                {archiveTripMutation.isPending ? "Archiving…" : "Archive"}
              </button>
            )}
            <button
              type="button"
              className="secondary"
              onClick={() => navigate("/group-expenses/trips")}
            >
              Back to groups
            </button>
          </div>
        </div>
        {canManageMembers && isEditingDetails && (
          <form
            onSubmit={handleDetailsSubmit}
            className="list"
            style={{ marginTop: "1rem" }}
          >
            <div className="input-group">
              <label htmlFor="group-name">Group name</label>
              <input
                id="group-name"
                value={detailsForm.name}
                onChange={(event) =>
                  setDetailsForm((prev) => ({ ...prev, name: event.target.value }))
                }
                placeholder="Weekend getaway"
                disabled={updateTripMutation.isPending}
              />
            </div>
            <div className="input-group">
              <label>Dates (optional)</label>
              <div className="input-row">
                <input
                  type="date"
                  value={detailsForm.startDate}
                  onChange={(event) =>
                    setDetailsForm((prev) => ({ ...prev, startDate: event.target.value }))
                  }
                  disabled={updateTripMutation.isPending}
                />
                <input
                  type="date"
                  value={detailsForm.endDate}
                  onChange={(event) =>
                    setDetailsForm((prev) => ({ ...prev, endDate: event.target.value }))
                  }
                  disabled={updateTripMutation.isPending}
                />
              </div>
            </div>
            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
              <button type="submit" className="primary" disabled={updateTripMutation.isPending}>
                {updateTripMutation.isPending ? "Saving…" : "Save changes"}
              </button>
              <button
                type="button"
                className="secondary"
                onClick={handleCancelDetailsEdit}
                disabled={updateTripMutation.isPending}
              >
                Cancel
              </button>
            </div>
          </form>
        )}
        {detailsMessage && (
          <p
            style={{
              margin: isEditingDetails ? "0" : "1rem 0 0",
              color: detailsMessage.type === "error" ? "#f87171" : "#4ade80"
            }}
          >
            {detailsMessage.text}
          </p>
        )}
        <div
          className="list"
          style={{ marginTop: "1rem", flexDirection: "row", gap: "0.5rem", flexWrap: "wrap" }}
        >
          {[
            { id: "overview", label: "Overview" },
            { id: "expenses", label: "Expenses" },
            { id: "settlements", label: "Settlements" },
            { id: "activity", label: "Activity" },
            { id: "people", label: "People" }
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={activeTab === tab.id ? "primary" : "secondary"}
              onClick={() => handleTabChange(tab.id as TripTab)}
            >
              {tab.label}
            </button>
          ))}
          {isFetching && !isLoading && (
            <span className="muted" style={{ alignSelf: "center" }}>
              Refreshing…
            </span>
          )}
        </div>
      </section>

      {activeTab === "overview" && (
        <OverviewTab
          balances={balances}
          membersById={membersById}
          settlementSuggestions={settlementSuggestions}
          currency={trip.currency}
          expenses={expenses}
          currentUserId={effectiveCurrentUserId}
          pendingSettlements={pendingSettlements}
          onUseSuggestion={handleUseSuggestion}
          onGoToSettlements={() => handleTabChange("settlements")}
        />
      )}

      {activeTab === "expenses" && (
        <ExpensesTab
          receipts={receipts}
          tripId={trip.tripId}
          members={members}
          expenses={expenses}
          currency={trip.currency}
          onCreateExpense={handleSubmitExpense}
          isCreating={
            createExpenseMutation.isPending || updateExpenseMutation.isPending
          }
          editingExpense={editingExpense}
          draftExpenses={data.draftExpenses ?? []}
          onPublishDraft={(expenseId) =>
            publishDraftMutation.mutateAsync(expenseId)
          }
          publishingExpenseId={
            publishDraftMutation.isPending
              ? publishDraftMutation.variables
              : undefined
          }
          onCancelEditExpense={() => setEditingExpense(null)}
          onEditExpense={handleEditExpense}
          membersById={membersById}
          onDeleteExpense={(expenseId, description, isDraft) =>
            deleteExpenseMutation.mutateAsync({ expenseId, description, isDraft })
          }
          deletePending={deleteExpenseMutation.isPending}
          deletingExpenseId={deleteExpenseMutation.variables?.expenseId}
          currentUserId={effectiveCurrentUserId}
          expensePrefill={expensePrefill}
          onExpensePrefillConsumed={() => setExpensePrefill(null)}
          onRepeatExpense={handleRepeatExpense}
          deletedExpenses={data.deletedExpenses ?? []}
          onRestoreExpense={(expenseId) => restoreExpenseMutation.mutateAsync(expenseId)}
          onPurgeExpense={(expenseId) => purgeExpenseMutation.mutateAsync(expenseId)}
          restoringExpenseId={restoreExpenseMutation.variables}
          purgingExpenseId={purgeExpenseMutation.variables}
          isTripOwner={canManageMembers}
        />
      )}

      {activeTab === "settlements" && (
        <SettlementsTab
          currency={trip.currency}
          members={members}
          settlements={settlements}
          pendingSettlements={pendingSettlements}
          balances={balances}
          settlementSuggestions={settlementSuggestions}
          onRecord={(input) => settlementMutation.mutateAsync(input)}
          isRecording={settlementMutation.isPending}
          onConfirm={(settlementId, confirmed) =>
            confirmSettlementMutation.mutate({ settlementId, confirmed })
          }
          confirmPending={confirmSettlementMutation.isPending}
          membersById={membersById}
          onDelete={(settlementId, label) =>
            deleteSettlementMutation.mutateAsync({ settlementId, label })
          }
          deletePending={deleteSettlementMutation.isPending}
          deletingSettlementId={deleteSettlementMutation.variables?.settlementId}
          onUpdate={(settlementId, amount, note) =>
            updateSettlementMutation.mutateAsync({ settlementId, amount, note })
          }
          updatePending={updateSettlementMutation.isPending}
          currentUserId={effectiveCurrentUserId}
          ownerId={trip.ownerId}
          paymentMethodsByMember={paymentMethodsByMember}
          prefill={settlementPrefill}
          onPrefillConsumed={() => setSettlementPrefill(null)}
          deletedSettlements={data.deletedSettlements ?? []}
          onRestoreSettlement={(settlementId) => restoreSettlementMutation.mutateAsync(settlementId)}
          onPurgeSettlement={(settlementId) => purgeSettlementMutation.mutateAsync(settlementId)}
          restoringSettlementId={restoreSettlementMutation.variables}
          purgingSettlementId={purgeSettlementMutation.variables}
        />
      )}

      {activeTab === "activity" && (
        <ActivityTab
          expenses={expenses}
          settlements={settlements}
          members={members}
          membersById={membersById}
          currency={trip.currency}
          currentUserId={effectiveCurrentUserId}
        />
      )}

      {activeTab === "people" && (
        <PeopleTab
          members={members}
          memberSearchTerm={memberSearchTerm}
          onMemberSearchTermChange={handleSearchTermChange}
          searchResults={memberSearchResults}
          searchMessage={memberSearchMessage}
          feedbackMessage={memberFeedback}
          onAddMember={(userId) => addMemberMutation.mutate({ members: [{ userId }] })}
          onAddPlaceholder={(name) => addMemberMutation.mutate({ members: [{ name }] })}
          addLoading={addMemberMutation.isPending}
          canManageMembers={canManageMembers}
          ownerId={trip.ownerId}
          onRemoveMember={(memberId) =>
            removeMemberMutation.mutateAsync(memberId)
          }
          removeLoading={removeMemberMutation.isPending}
          removingMemberId={removeMemberMutation.variables}
          currentUserId={effectiveCurrentUserId}
          membersById={membersById}
          paymentMethodsByMember={paymentMethodsByMember}
          onSavePaymentMethods={handleSavePaymentMethods}
          paymentMethodsMessage={paymentMethodsMessage}
          savingPaymentMethods={savePaymentMethodsMutation.isPending}
          invite={inviteQuery.data?.invite ?? null}
          inviteLoading={inviteQuery.isLoading}
          onCreateOrRotateInvite={() => createInviteMutation.mutateAsync()}
          onRevokeInvite={() => revokeInviteMutation.mutateAsync()}
          inviteSaving={createInviteMutation.isPending}
          inviteRevoking={revokeInviteMutation.isPending}
        />
      )}

      {undoToast && (
        <UndoToast
          nonce={undoToast.nonce}
          title={undoToast.title}
          onUndo={() => {
            const t = undoToast;
            setUndoToast(null);
            if (t.kind === "expense") {
              void restoreExpenseMutation.mutateAsync(t.id);
            } else {
              void restoreSettlementMutation.mutateAsync(t.id);
            }
          }}
          onDismiss={() => setUndoToast(null)}
        />
      )}
    </div>
  );
};

export default TripDetailPage;
