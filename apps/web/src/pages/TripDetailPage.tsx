import { CSSProperties, FormEvent, ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import { useAuthenticator } from "@aws-amplify/ui-react";
import AddExpenseForm, { type CreateExpenseInput, type ExpensePrefill } from "../components/AddExpenseForm";
import SettlementForm, { type SettlementPrefill } from "../components/SettlementForm";
import { CategoryBadge } from "../components/CategoryBadge";
import { normalizeCategoryKey, resolveExpenseCategory } from "../lib/expenseCategories";
import { api, ApiError, searchUsers as searchUsersRequest } from "../lib/api";
import type {
  TripSummary,
  Expense,
  Settlement,
  UserProfile,
  BalanceRow,
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
type PaymentMethodsInput = {
  venmo?: string | null;
  paypal?: string | null;
  zelle?: string | null;
};

function useDebouncedValue<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const handle = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(handle);
  }, [value, delay]);

  return debouncedValue;
}

const computeSettlementSuggestions = (balances: BalanceRow[]) => {
  const creditors: Array<{ memberId: string; amount: number }> = [];
  const debtors: Array<{ memberId: string; amount: number }> = [];

  balances.forEach((balance) => {
    if (balance.balance > 0.01) {
      creditors.push({ memberId: balance.memberId, amount: balance.balance });
    } else if (balance.balance < -0.01) {
      debtors.push({ memberId: balance.memberId, amount: Math.abs(balance.balance) });
    }
  });

  if (!creditors.length || !debtors.length) {
    return [] as Array<{ from: string; to: string; amount: number }>;
  }

  const suggestions: Array<{ from: string; to: string; amount: number }> = [];
  let creditorIndex = 0;
  let debtorIndex = 0;

  while (creditorIndex < creditors.length && debtorIndex < debtors.length) {
    const creditor = creditors[creditorIndex];
    const debtor = debtors[debtorIndex];
    const amount = Math.min(creditor.amount, debtor.amount);

    suggestions.push({
      from: debtor.memberId,
      to: creditor.memberId,
      amount: Math.round(amount * 100) / 100
    });

    creditor.amount -= amount;
    debtor.amount -= amount;

    if (creditor.amount <= 0.01) {
      creditorIndex += 1;
    }
    if (debtor.amount <= 0.01) {
      debtorIndex += 1;
    }
  }

  return suggestions;
};

const formatDate = (isoString: string) => {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) {
    return "Unknown date";
  }

  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short"
    }).format(date);
  } catch {
    return date.toLocaleString();
  }
};

const formatTime = (isoString: string): string => {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return "";
  try {
    return new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
      minute: "2-digit"
    }).format(date);
  } catch {
    return date.toLocaleTimeString();
  }
};

const localDayKey = (isoString: string): string => {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return "unknown";
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

const formatDayLabel = (isoString: string): { primary: string; secondary?: string } => {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return { primary: "Unknown date" };
  const today = new Date();
  const todayKey = localDayKey(today.toISOString());
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const yesterdayKey = localDayKey(yesterday.toISOString());
  const dayKey = localDayKey(isoString);

  const dateLabel = (() => {
    if (dayKey === todayKey) return "Today";
    if (dayKey === yesterdayKey) return "Yesterday";
    try {
      const includeYear = date.getFullYear() !== today.getFullYear();
      return new Intl.DateTimeFormat(undefined, {
        weekday: "long",
        month: "long",
        day: "numeric",
        ...(includeYear ? { year: "numeric" } : {})
      }).format(date);
    } catch {
      return date.toDateString();
    }
  })();

  let secondary: string | undefined;
  try {
    secondary = new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric"
    }).format(date);
    if (dayKey === todayKey || dayKey === yesterdayKey) {
      // For Today/Yesterday, secondary already adds value (the actual date)
    } else {
      // For full date labels the secondary would be redundant
      secondary = undefined;
    }
  } catch {
    secondary = undefined;
  }

  return { primary: dateLabel, secondary };
};

const TripDetailSkeleton = () => (
  <div className="trip-detail">
    <section className="card" style={{ marginBottom: "1rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.55rem" }}>
          <span className="skel skel--title" style={{ width: "220px" }}>&nbsp;</span>
          <span className="skel skel--text" style={{ width: "150px" }}>&nbsp;</span>
        </div>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <span className="skel skel--pill" style={{ width: "120px" }}>&nbsp;</span>
        </div>
      </div>
      <div style={{ marginTop: "1rem", display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
        {["overview", "expenses", "settlements", "people"].map((id) => (
          <span key={id} className="skel skel--pill" style={{ width: `${80 + (id.length % 3) * 14}px` }}>&nbsp;</span>
        ))}
      </div>
    </section>

    <div className="ov-grid">
      <section
        className="ov-hero"
        style={{ gridColumn: "1 / -1", background: "rgba(15,23,42,0.7)" }}
      >
        <div className="skel-hero">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: "1.5rem" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.55rem", flex: 1, minWidth: 0 }}>
              <span className="skel skel--text" style={{ width: "120px", height: "0.7rem" }}>&nbsp;</span>
              <span className="skel skel-hero__amount">&nbsp;</span>
              <span className="skel skel--text" style={{ width: "150px" }}>&nbsp;</span>
            </div>
            <span className="skel skel--pill" style={{ width: "160px", height: "2.6rem" }}>&nbsp;</span>
          </div>
          <div className="skel-stamps">
            {[0, 1, 2].map((i) => (
              <div key={i} className="skel-stamp">
                <span className="skel skel--text" style={{ width: "80px", height: "0.7rem" }}>&nbsp;</span>
                <span className="skel skel--title" style={{ width: "100px" }}>&nbsp;</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section>
        <div className="ov-section-head">
          <span className="skel skel--title" style={{ width: "110px" }}>&nbsp;</span>
        </div>
        <div className="ov-suggestion-list">
          {[0, 1, 2].map((i) => (
            <div key={i} className="ov-suggestion">
              <div className="skel-row">
                <span className="skel skel--circle" style={{ width: "38px", height: "38px" }}>&nbsp;</span>
                <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
                  <span className="skel skel--text" style={{ width: "50px", height: "0.6rem" }}>&nbsp;</span>
                  <span className="skel skel--text" style={{ width: "90px" }}>&nbsp;</span>
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "0.35rem" }}>
                <span className="skel skel--title" style={{ width: "80px" }}>&nbsp;</span>
                <span className="skel skel--text" style={{ width: "120px", height: "0.5rem" }}>&nbsp;</span>
              </div>
              <span className="skel skel--pill" style={{ width: "90px" }}>&nbsp;</span>
            </div>
          ))}
        </div>
      </section>

      <section>
        <div className="ov-section-head">
          <span className="skel skel--title" style={{ width: "100px" }}>&nbsp;</span>
        </div>
        <div className="ov-balance-list">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="ov-balance-row" style={{ cursor: "default" }}>
              <span className="skel skel--circle" style={{ width: "32px", height: "32px" }}>&nbsp;</span>
              <div className="ov-balance-row__body">
                <span className="skel skel--text" style={{ width: `${110 + (i * 17) % 60}px` }}>&nbsp;</span>
                <div className="ov-balance-row__bar">
                  <span
                    className="skel ov-balance-row__bar-fill"
                    style={{ width: `${30 + (i * 18) % 55}%`, animation: "skelShimmer 1.6s ease-in-out infinite" }}
                  />
                </div>
              </div>
              <span className="skel skel--text" style={{ width: "60px" }}>&nbsp;</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  </div>
);

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

  const { data, isLoading, error, refetch, isFetching } = useQuery({
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

  const handleRepeatExpense = useCallback((expense: Expense) => {
    const taxAmount = expense.tax ?? 0;
    const tipAmount = expense.tip ?? 0;
    const subtotal = Math.max(0, expense.total - taxAmount - tipAmount);
    const shareCount = expense.sharedWithMemberIds.length;
    const evenShare = shareCount > 0 ? expense.total / shareCount : 0;
    const isEven =
      shareCount > 0 &&
      expense.allocations.length === shareCount &&
      expense.allocations.every((a) => Math.abs(a.amount - evenShare) <= 0.02);

    setExpensePrefill({
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
      allocations: isEven
        ? undefined
        : Object.fromEntries(expense.allocations.map((a) => [a.memberId, a.amount.toFixed(2)]))
    });
    setActiveTab("expenses");
  }, []);

  const createExpenseMutation = useMutation({
    mutationFn: (payload: CreateExpenseInput) =>
      api.post<Expense>(`/trips/${tripId}/expenses`, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
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

  const deleteExpenseMutation = useMutation<void, unknown, { expenseId: string; description: string }>({
    mutationFn: ({ expenseId }) => {
      if (!tripId) {
        throw new Error("Trip not found");
      }
      return api.delete<void>(`/trips/${tripId}/expenses/${expenseId}`);
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey });
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

  const addMemberMutation = useMutation({
    mutationFn: (payload: { members: { userId: string }[] }) =>
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

  const settlementAmountFormatter = useMemo(
    () =>
      new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: data?.trip?.currency ?? "USD",
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      }),
    [data?.trip?.currency]
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
          <div style={{ display: "flex", gap: "0.5rem" }}>
            {canManageMembers && !isEditingDetails && (
              <button type="button" className="secondary" onClick={handleStartEditingDetails}>
                Edit details
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
          onCreateExpense={(input) =>
            createExpenseMutation.mutateAsync(input)
          }
          isCreating={createExpenseMutation.isPending}
          membersById={membersById}
          onDeleteExpense={(expenseId, description) =>
            deleteExpenseMutation.mutateAsync({ expenseId, description })
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
          currentUserId={effectiveCurrentUserId}
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

// ---------- Overview helpers ----------

const AVATAR_PALETTE: Array<{ bg: string; fg: string }> = [
  { bg: "linear-gradient(135deg, #f472b6 0%, #ec4899 100%)", fg: "#fdf2f8" },
  { bg: "linear-gradient(135deg, #60a5fa 0%, #2563eb 100%)", fg: "#dbeafe" },
  { bg: "linear-gradient(135deg, #34d399 0%, #059669 100%)", fg: "#d1fae5" },
  { bg: "linear-gradient(135deg, #fbbf24 0%, #d97706 100%)", fg: "#fef3c7" },
  { bg: "linear-gradient(135deg, #a78bfa 0%, #7c3aed 100%)", fg: "#ede9fe" },
  { bg: "linear-gradient(135deg, #f87171 0%, #dc2626 100%)", fg: "#fee2e2" },
  { bg: "linear-gradient(135deg, #22d3ee 0%, #0891b2 100%)", fg: "#cffafe" },
  { bg: "linear-gradient(135deg, #fb923c 0%, #ea580c 100%)", fg: "#ffedd5" }
];

const hashString = (s: string): number => {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
};

const seedAvatar = (memberId: string) =>
  AVATAR_PALETTE[hashString(memberId) % AVATAR_PALETTE.length];

const getInitials = (name: string): string => {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
};

interface OvAvatarProps {
  name: string;
  memberId: string;
  size?: "sm" | "md";
  isSelf?: boolean;
}

const OvAvatar = ({ name, memberId, size = "md", isSelf }: OvAvatarProps) => {
  const palette = seedAvatar(memberId);
  return (
    <div
      className={`ov-avatar ${size === "sm" ? "ov-avatar--sm" : ""} ${isSelf ? "ov-avatar--self" : ""}`}
      style={{ background: palette.bg, color: palette.fg }}
      aria-hidden="true"
    >
      {getInitials(name)}
    </div>
  );
};

interface OvCategoryChartProps {
  expenses: TripSummary["expenses"];
  totalSpent: number;
  currencyFormatter: Intl.NumberFormat;
}

const OvCategoryChart = ({
  expenses,
  totalSpent,
  currencyFormatter
}: OvCategoryChartProps) => {
  const segments = useMemo(() => {
    const totals = new Map<
      string,
      { key: string; label: string; icon: string; color: string; amount: number }
    >();
    expenses.forEach((expense) => {
      const resolved = resolveExpenseCategory(expense.category);
      const key = resolved?.id ?? (normalizeCategoryKey(expense.category) || "unset");
      const label = resolved?.label ?? (expense.category?.trim() || "Uncategorized");
      const icon = resolved?.icon ?? "✦";
      const color = resolved?.color ?? "#94a3b8";
      const existing = totals.get(key);
      if (existing) {
        existing.amount += expense.total;
      } else {
        totals.set(key, { key, label, icon, color, amount: expense.total });
      }
    });
    return Array.from(totals.values()).sort((a, b) => b.amount - a.amount);
  }, [expenses]);

  if (segments.length === 0 || totalSpent <= 0) {
    return (
      <div className="cat-chart">
        <div className="cat-chart__empty">
          Add expenses to see a category breakdown.
        </div>
      </div>
    );
  }

  let cursor = 0;
  const arcs = segments.map((seg) => {
    const percent = (seg.amount / totalSpent) * 100;
    const arc = { ...seg, percent, startPercent: cursor };
    cursor += percent;
    return arc;
  });
  const visibleArcs = arcs.slice(0, 5);
  const hiddenCount = arcs.length - visibleArcs.length;
  const hiddenAmount =
    hiddenCount > 0
      ? arcs.slice(5).reduce((sum, a) => sum + a.amount, 0)
      : 0;

  return (
    <div className="cat-chart">
      <div className="cat-chart__top">
        <div className="cat-chart__donut">
          <svg viewBox="0 0 100 100" style={{ width: "100%", height: "100%" }}>
            <circle
              cx="50"
              cy="50"
              r="42"
              fill="none"
              stroke="rgba(148, 163, 184, 0.10)"
              strokeWidth="13"
            />
            <g transform="rotate(-90 50 50)">
              {arcs.map((arc) => {
                const dashLen = Math.max(0.5, arc.percent - 1.2);
                return (
                  <circle
                    key={arc.key}
                    cx="50"
                    cy="50"
                    r="42"
                    pathLength={100}
                    fill="none"
                    stroke={arc.color}
                    strokeWidth="13"
                    strokeLinecap="butt"
                    strokeDasharray={`${dashLen} ${100 - dashLen}`}
                    strokeDashoffset={-arc.startPercent}
                    opacity={0.9}
                  />
                );
              })}
            </g>
          </svg>
          <div className="cat-chart__center">
            <span className="cat-chart__center-amount">
              {currencyFormatter.format(totalSpent)}
            </span>
            <span className="cat-chart__center-label">spent</span>
          </div>
        </div>
        <div className="cat-chart__legend">
          {visibleArcs.map((arc) => (
            <div key={arc.key} className="cat-chart__row">
              <span className="cat-chart__swatch" style={{ background: arc.color }} />
              <span className="cat-chart__name" title={arc.label}>
                <span aria-hidden="true">{arc.icon}</span>
                {arc.label}
              </span>
              <span className="cat-chart__amount">
                {currencyFormatter.format(arc.amount)}
              </span>
            </div>
          ))}
          {hiddenCount > 0 && (
            <div className="cat-chart__row" style={{ color: "#64748b" }}>
              <span
                className="cat-chart__swatch"
                style={{ background: "rgba(148,163,184,0.4)" }}
              />
              <span className="cat-chart__name" style={{ fontStyle: "italic" }}>
                + {hiddenCount} more
              </span>
              <span className="cat-chart__amount">
                {currencyFormatter.format(hiddenAmount)}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const OvFlowArc = ({ tone }: { tone: "owe" | "owed" | "neutral" }) => {
  const color =
    tone === "owe" ? "#fb923c" : tone === "owed" ? "#34d399" : "#94a3b8";
  return (
    <svg
      viewBox="0 0 100 18"
      preserveAspectRatio="none"
      style={{ width: "100%", height: "100%", overflow: "visible" }}
      aria-hidden="true"
    >
      <path
        d="M 4 12 Q 50 -4 96 12"
        fill="none"
        stroke={color}
        strokeWidth="1.4"
        strokeDasharray="2 4"
        strokeLinecap="round"
        opacity="0.75"
      />
      <polygon points="98,12 92,8 92,16" fill={color} opacity="0.95" />
      <circle cx="4" cy="12" r="1.6" fill={color} opacity="0.95" />
    </svg>
  );
};

interface OverviewTabProps {
  balances: BalanceRow[];
  membersById: Record<string, string>;
  settlementSuggestions: Array<{ from: string; to: string; amount: number }>;
  currency: string;
  expenses: TripSummary["expenses"];
  currentUserId?: string;
  pendingSettlements: TripSummary["settlements"];
  onUseSuggestion: (suggestion: { from: string; to: string; amount: number }) => void;
  onGoToSettlements: () => void;
}

const OverviewTab = ({
  balances,
  membersById,
  settlementSuggestions,
  currency,
  expenses,
  currentUserId,
  pendingSettlements,
  onUseSuggestion,
  onGoToSettlements
}: OverviewTabProps) => {
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);
  const detailRef = useRef<HTMLDivElement | null>(null);
  const currencyFormatter = useMemo(
    () =>
      new Intl.NumberFormat(undefined, {
        style: "currency",
        currency,
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      }),
    [currency]
  );

  const expensesByMember = useMemo(() => {
    const map: Record<string, Array<{ expense: Expense; share: number; isPayer: boolean }>> = {};

    expenses.forEach((expense) => {
      expense.allocations.forEach((allocation) => {
        map[allocation.memberId] = map[allocation.memberId] ?? [];
        map[allocation.memberId].push({
          expense,
          share: allocation.amount,
          isPayer: expense.paidByMemberId === allocation.memberId
        });
      });

      if (!expense.allocations.some((allocation) => allocation.memberId === expense.paidByMemberId)) {
        map[expense.paidByMemberId] = map[expense.paidByMemberId] ?? [];
        map[expense.paidByMemberId].push({
          expense,
          share: 0,
          isPayer: true
        });
      }
    });

    return map;
  }, [expenses]);

  const selectedMemberExpenses = useMemo(
    () => (selectedMemberId ? expensesByMember[selectedMemberId] ?? [] : []),
    [expensesByMember, selectedMemberId]
  );

  const selectedMemberTotal = useMemo(
    () => selectedMemberExpenses.reduce((sum, entry) => sum + entry.share, 0),
    [selectedMemberExpenses]
  );

  const selectedMemberName = selectedMemberId ? membersById[selectedMemberId] ?? selectedMemberId : null;

  useEffect(() => {
    if (selectedMemberId && detailRef.current) {
      detailRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [selectedMemberId]);

  const groupTotalSpent = useMemo(
    () => expenses.reduce((sum, expense) => sum + (expense.total ?? 0), 0),
    [expenses]
  );

  const currentUserBalance = useMemo(() => {
    if (!currentUserId) return null;
    const row = balances.find((balance) => balance.memberId === currentUserId);
    return row ? row.balance : null;
  }, [balances, currentUserId]);

  const currentUserUnsettledCount = useMemo(() => {
    if (!currentUserId) return pendingSettlements.length;
    return pendingSettlements.filter(
      (s) => s.fromMemberId === currentUserId || s.toMemberId === currentUserId
    ).length;
  }, [pendingSettlements, currentUserId]);

  const yourTotalShare = useMemo(() => {
    if (!currentUserId) return 0;
    let total = 0;
    expenses.forEach((expense) => {
      expense.allocations.forEach((allocation) => {
        if (allocation.memberId === currentUserId) {
          total += allocation.amount;
        }
      });
    });
    return total;
  }, [expenses, currentUserId]);

  const maxAbsBalance = useMemo(
    () =>
      balances.reduce((max, balance) => Math.max(max, Math.abs(balance.balance)), 0),
    [balances]
  );

  const primarySuggestionForUser = useMemo(() => {
    if (!currentUserId) return settlementSuggestions[0] ?? null;
    const owes = settlementSuggestions
      .filter((s) => s.from === currentUserId)
      .sort((a, b) => b.amount - a.amount)[0];
    if (owes) return owes;
    const owed = settlementSuggestions
      .filter((s) => s.to === currentUserId)
      .sort((a, b) => b.amount - a.amount)[0];
    if (owed) return owed;
    return settlementSuggestions[0] ?? null;
  }, [settlementSuggestions, currentUserId]);

  const heroTone: "owe" | "owed" | "settled" =
    currentUserBalance === null || Math.abs(currentUserBalance) < 0.01
      ? "settled"
      : currentUserBalance > 0
        ? "owed"
        : "owe";

  const balanceStatus =
    currentUserBalance === null
      ? "you're not part of this trip"
      : Math.abs(currentUserBalance) < 0.01
        ? "all square — nothing to settle"
        : currentUserBalance > 0
          ? "you're owed"
          : "you owe";

  const balanceDisplay =
    currentUserBalance === null
      ? "—"
      : currencyFormatter.format(Math.abs(currentUserBalance));

  const settleUpDisabled = !primarySuggestionForUser;
  const handleSettleUpClick = () => {
    if (primarySuggestionForUser) {
      onUseSuggestion(primarySuggestionForUser);
    } else {
      onGoToSettlements();
    }
  };
  const settleUpLabel = !primarySuggestionForUser
    ? "All settled ✓"
    : primarySuggestionForUser.from === currentUserId
      ? `Settle ${currencyFormatter.format(primarySuggestionForUser.amount)} →`
      : primarySuggestionForUser.to === currentUserId
        ? "View settlements →"
        : "Settle group →";

  return (
    <div className="ov-grid">
      {/* ── HERO ─────────────────────────────────────────────── */}
      <section className={`ov-hero ov-hero--${heroTone} ov-rise ov-rise-1`}>
        <div className="ov-hero__top">
          <div className="ov-hero__lockup">
            <span className="ov-hero__eyebrow">Where you stand</span>
            <span className={`ov-hero__amount ov-hero__amount--${heroTone}`}>
              {balanceDisplay}
            </span>
            <span className="ov-hero__status">{balanceStatus}</span>
          </div>
          <button
            type="button"
            className={`ov-cta ov-cta--${heroTone}`}
            disabled={settleUpDisabled}
            onClick={handleSettleUpClick}
          >
            {settleUpLabel}
          </button>
        </div>

        <div className="ov-stamps">
          <div className="ov-stamp">
            <span className="ov-stamp__label">Group spent</span>
            <span className="ov-stamp__value">
              {currencyFormatter.format(groupTotalSpent)}
            </span>
          </div>
          {currentUserId && (
            <div className="ov-stamp">
              <span className="ov-stamp__label">Your share</span>
              <span className="ov-stamp__value">
                {currencyFormatter.format(yourTotalShare)}
              </span>
            </div>
          )}
          <div className="ov-stamp">
            <span className="ov-stamp__label">Unsettled</span>
            <span className="ov-stamp__value">{currentUserUnsettledCount}</span>
          </div>
        </div>
      </section>

      {/* ── SUGGESTIONS (primary column) ─────────────────────── */}
      <section className="ov-rise ov-rise-2">
        <div className="ov-section-head">
          <h2>{settlementSuggestions.length === 0 ? "All settled up" : "Settle up"}</h2>
          {settlementSuggestions.length > 0 && (
            <span className="ov-todo-pill">
              {settlementSuggestions.length} {settlementSuggestions.length === 1 ? "payment" : "payments"}
            </span>
          )}
        </div>

        {settlementSuggestions.length === 0 ? (
          <div className="ov-celebration">
            <div className="ov-celebration__mark">✓</div>
            <p className="ov-celebration__text">The ledger is clear.</p>
          </div>
        ) : (
          <>
            <div className="ov-suggestion-list">
              {settlementSuggestions.map((suggestion, index) => {
                const isFromUser = currentUserId === suggestion.from;
                const isToUser = currentUserId === suggestion.to;
                const tone: "owe" | "owed" | "neutral" = isFromUser
                  ? "owe"
                  : isToUser
                    ? "owed"
                    : "neutral";
                const modifier = isFromUser
                  ? "ov-suggestion--owe-self"
                  : isToUser
                    ? "ov-suggestion--owed-self"
                    : "";
                const fromName = membersById[suggestion.from] ?? suggestion.from;
                const toName = membersById[suggestion.to] ?? suggestion.to;
                const actionClass =
                  tone === "owe"
                    ? "ov-suggestion__action--owe"
                    : tone === "owed"
                      ? "ov-suggestion__action--owed"
                      : "ov-suggestion__action--neutral";

                return (
                  <div
                    key={`${suggestion.from}-${suggestion.to}-${index}`}
                    className={`ov-suggestion ${modifier}`}
                  >
                    <div className="ov-suggestion__person">
                      <OvAvatar
                        name={fromName}
                        memberId={suggestion.from}
                        isSelf={isFromUser}
                      />
                      <div className="ov-suggestion__person-body">
                        <span className="ov-suggestion__role">
                          {isFromUser ? "You owe" : "Pays"}
                        </span>
                        <span className="ov-suggestion__name">
                          {isFromUser ? <em style={{ fontStyle: "italic", color: "#f8fafc" }}>You</em> : fromName}
                        </span>
                      </div>
                    </div>

                    <div className="ov-suggestion__flow">
                      <span className="ov-suggestion__amount">
                        {currencyFormatter.format(suggestion.amount)}
                      </span>
                      <div className="ov-suggestion__arc">
                        <OvFlowArc tone={tone} />
                      </div>
                      <span className="ov-suggestion__to">
                        to {isToUser ? <em>you</em> : toName}
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={() => onUseSuggestion(suggestion)}
                      className={`ov-suggestion__action ${actionClass}`}
                    >
                      Record →
                    </button>
                  </div>
                );
              })}
            </div>
            <p
              className="muted"
              style={{ marginTop: "0.85rem", fontSize: "0.82rem" }}
            >
              These payments would zero out the current balances.
            </p>
          </>
        )}
      </section>

      {/* ── BALANCES (recessive column) ──────────────────────── */}
      <section className="ov-rise ov-rise-3">
        <div className="ov-section-head">
          <h2>Balances</h2>
          <span className="muted" style={{ fontSize: "0.82rem" }}>
            {balances.length} {balances.length === 1 ? "person" : "people"}
          </span>
        </div>

        {balances.length === 0 ? (
          <p className="muted" style={{ fontStyle: "italic" }}>
            Add expenses to see how the ledger shakes out.
          </p>
        ) : (
          <div className="ov-balance-list">
            {balances.map((balance) => {
              const isSelf = balance.memberId === currentUserId;
              const isSelected = selectedMemberId === balance.memberId;
              const memberName = membersById[balance.memberId] ?? balance.memberId;
              const isZero = Math.abs(balance.balance) < 0.01;
              const positive = balance.balance > 0;
              const barWidth =
                maxAbsBalance > 0
                  ? Math.min(100, (Math.abs(balance.balance) / maxAbsBalance) * 100)
                  : 0;
              const amountClass = isZero
                ? "ov-balance-row__amount--zero"
                : positive
                  ? "ov-balance-row__amount--owed"
                  : "ov-balance-row__amount--owe";

              return (
                <button
                  key={balance.memberId}
                  type="button"
                  onClick={() =>
                    setSelectedMemberId((current) =>
                      current === balance.memberId ? null : balance.memberId
                    )
                  }
                  className={`ov-balance-row ${isSelected ? "ov-balance-row--selected" : ""}`}
                >
                  <OvAvatar
                    name={memberName}
                    memberId={balance.memberId}
                    size="sm"
                    isSelf={isSelf}
                  />
                  <div className="ov-balance-row__body">
                    <span className="ov-balance-row__name">
                      {memberName}
                      {isSelf && <span className="ov-balance-row__self">· you</span>}
                    </span>
                    <div className="ov-balance-row__bar">
                      <div
                        className="ov-balance-row__bar-fill"
                        style={{
                          width: `${barWidth}%`,
                          left: 0,
                          background: isZero
                            ? "rgba(148,163,184,0.3)"
                            : positive
                              ? "linear-gradient(90deg, var(--owed) 0%, rgba(52,211,153,0.55) 100%)"
                              : "linear-gradient(90deg, var(--owe) 0%, rgba(251,146,60,0.55) 100%)"
                        }}
                      />
                    </div>
                  </div>
                  <span className={`ov-balance-row__amount ${amountClass}`}>
                    {isZero
                      ? "0.00"
                      : `${positive ? "+" : "−"}${currencyFormatter.format(Math.abs(balance.balance))}`}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {selectedMemberId && (
          <div className="ov-detail" ref={detailRef}>
            <div className="ov-detail__head">
              <h3 className="ov-detail__name">{selectedMemberName}</h3>
              <span className="muted" style={{ fontSize: "0.82rem" }}>
                {selectedMemberExpenses.length} items · {currencyFormatter.format(selectedMemberTotal)}
              </span>
            </div>
            {selectedMemberExpenses.length === 0 ? (
              <p className="muted" style={{ margin: 0, fontStyle: "italic" }}>
                Nothing allocated to this person yet.
              </p>
            ) : (
              <div className="ov-detail__list">
                {selectedMemberExpenses.map(({ expense, share, isPayer }) => (
                  <div key={expense.expenseId} className="ov-detail__item">
                    <div className="ov-detail__item-body">
                      <span className="ov-detail__item-title">{expense.description}</span>
                      <span className="ov-detail__item-meta">
                        {formatDate(expense.createdAt)} · Paid by{" "}
                        {membersById[expense.paidByMemberId] ?? expense.paidByMemberId}
                      </span>
                      {expense.category && (
                        <div style={{ marginTop: "0.25rem" }}>
                          <CategoryBadge category={expense.category} />
                        </div>
                      )}
                    </div>
                    <div className="ov-detail__item-right">
                      <span
                        className={`ov-detail__share ${share > 0 ? "" : "ov-detail__share--zero"}`}
                      >
                        {share > 0 ? currencyFormatter.format(share) : "no share"}
                      </span>
                      <span className="muted" style={{ fontSize: "0.76rem" }}>
                        of {currencyFormatter.format(expense.total)}
                      </span>
                      {isPayer && (
                        <span
                          className="pill"
                          style={{
                            background: "rgba(56,189,248,0.16)",
                            color: "#bae6fd",
                            fontSize: "0.7rem",
                            marginTop: "0.2rem"
                          }}
                        >
                          Payer
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <OvCategoryChart
          expenses={expenses}
          totalSpent={groupTotalSpent}
          currencyFormatter={currencyFormatter}
        />
      </section>
    </div>
  );
};

// ---------- Soft delete UI ----------

interface UndoToastProps {
  nonce: number;
  title: string;
  onUndo: () => void;
  onDismiss: () => void;
  durationMs?: number;
}

const UndoToast = ({ nonce, title, onUndo, onDismiss, durationMs = 6000 }: UndoToastProps) => {
  useEffect(() => {
    const t = setTimeout(onDismiss, durationMs);
    return () => clearTimeout(t);
  }, [nonce, durationMs, onDismiss]);

  return (
    <div
      key={nonce}
      className="undo-toast"
      role="status"
      aria-live="polite"
      style={{ "--toast-duration": `${durationMs}ms` } as CSSProperties}
    >
      <span className="undo-toast__icon" aria-hidden="true">🗑</span>
      <div className="undo-toast__body">
        <span className="undo-toast__title">{title}</span>
        <span className="undo-toast__hint">Removed — undoable</span>
      </div>
      <button type="button" className="undo-toast__action" onClick={onUndo}>
        Undo
      </button>
      <button
        type="button"
        className="undo-toast__close"
        aria-label="Dismiss"
        onClick={onDismiss}
      >
        ×
      </button>
    </div>
  );
};

interface RecentlyDeletedListProps {
  label: string;
  emptyHint: string;
  items: Array<{
    id: string;
    title: ReactNode;
    meta: string;
  }>;
  onRestore: (id: string) => Promise<void>;
  onPurge: (id: string) => Promise<void>;
  restoringId?: string;
  purgingId?: string;
}

const RecentlyDeletedList = ({
  label,
  emptyHint,
  items,
  onRestore,
  onPurge,
  restoringId,
  purgingId
}: RecentlyDeletedListProps) => {
  const [open, setOpen] = useState(false);
  if (items.length === 0) return null;

  return (
    <div className="trash">
      <button
        type="button"
        className="trash__header"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="trash__title">
          <span className={`trash__chevron ${open ? "trash__chevron--open" : ""}`}>▸</span>
          Recently deleted {label.toLowerCase()}
          <span className="trash__count">{items.length}</span>
        </span>
        <span className="muted" style={{ fontSize: "0.78rem" }}>
          {open ? "hide" : emptyHint}
        </span>
      </button>
      {open && (
        <div className="trash__list">
          {items.map((item) => (
            <div key={item.id} className="trash__row">
              <div className="trash__row-body">
                <span className="trash__row-title">{item.title}</span>
                <span className="trash__row-meta">{item.meta}</span>
              </div>
              <div className="trash__row-actions">
                <button
                  type="button"
                  className="trash__row-restore"
                  disabled={restoringId === item.id}
                  onClick={() => onRestore(item.id).catch(() => {})}
                >
                  {restoringId === item.id ? "Restoring…" : "Restore"}
                </button>
                <button
                  type="button"
                  className="trash__row-purge"
                  disabled={purgingId === item.id}
                  title="Permanently delete — cannot be undone"
                  onClick={() => {
                    if (!window.confirm("Permanently delete? This cannot be undone.")) return;
                    onPurge(item.id).catch(() => {});
                  }}
                >
                  {purgingId === item.id ? "…" : "Delete forever"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

interface ExpensesTabProps {
  receipts: TripSummary["receipts"];
  tripId: string;
  members: TripSummary["members"];
  expenses: TripSummary["expenses"];
  currency: string;
  onCreateExpense: (payload: CreateExpenseInput) => Promise<unknown>;
  isCreating: boolean;
  membersById: Record<string, string>;
  onDeleteExpense: (expenseId: string, description: string) => Promise<void>;
  deletePending: boolean;
  deletingExpenseId?: string;
  currentUserId?: string;
  expensePrefill?: ExpensePrefill | null;
  onExpensePrefillConsumed?: () => void;
  onRepeatExpense: (expense: Expense) => void;
  deletedExpenses: Expense[];
  onRestoreExpense: (expenseId: string) => Promise<void>;
  onPurgeExpense: (expenseId: string) => Promise<void>;
  restoringExpenseId?: string;
  purgingExpenseId?: string;
}

const ExpensesTab = ({
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
  deletedExpenses,
  onRestoreExpense,
  onPurgeExpense,
  restoringExpenseId,
  purgingExpenseId
}: ExpensesTabProps) => {
  const [memberFilter, setMemberFilter] = useState<string>("all");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");
  const [viewingReceiptId, setViewingReceiptId] = useState<string | null>(null);
  const [viewReceiptError, setViewReceiptError] = useState<string | null>(null);
  const [expandedReceiptId, setExpandedReceiptId] = useState<string | null>(null);
  const [receiptPreviewCache, setReceiptPreviewCache] = useState<
    Record<string, { url: string; title: string; type: string | null }>
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

      return true;
    });
  }, [expenses, memberFilter, categoryFilter, dateFrom, dateTo]);

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

  const sharedLabel = (count: number) =>
    `Shared with ${count} ${count === 1 ? "person" : "people"}`;

  const resetFilters = () => {
    setMemberFilter("all");
    setCategoryFilter("all");
    setDateFrom("");
    setDateTo("");
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
          <h2>Log Expense</h2>
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
        />
      </section>

      <section className="card" style={{ gridColumn: "1 / -1" }}>
        <div className="section-title">
          <h2>Expense History</h2>
          <span className="muted">{expenses.length} recorded</span>
        </div>
        {expenses.length === 0 ? (
          <p className="muted">No expenses yet.</p>
        ) : (
          <div className="list" style={{ gap: "1.5rem" }}>
            <div
              className="card"
              style={{
                padding: "1rem 1.5rem",
                borderRadius: "0.9rem",
                border: "1px solid rgba(148,163,184,0.12)",
                background: "rgba(15,23,42,0.4)",
                backdropFilter: "blur(12px)",
                display: "flex",
                flexDirection: "column",
                gap: "0.9rem"
              }}
            >
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: "0.75rem"
                }}
              >
                <div className="input-group" style={{ minWidth: "160px" }}>
                  <label>Person</label>
                  <select value={memberFilter} onChange={(event) => setMemberFilter(event.target.value)}>
                    <option value="all">All</option>
                    {members.map((member) => (
                      <option key={member.memberId} value={member.memberId}>
                        {membersById[member.memberId] ?? member.memberId}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="input-group" style={{ minWidth: "160px" }}>
                  <label>Category</label>
                  <select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}>
                    <option value="all">All</option>
                    {categories.map((cat) => (
                      <option key={cat.key} value={cat.key}>
                        {cat.icon} {cat.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="input-group" style={{ minWidth: "140px" }}>
                  <label>From</label>
                  <input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} />
                </div>
                <div className="input-group" style={{ minWidth: "140px" }}>
                  <label>To</label>
                  <input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} />
                </div>
              </div>
              {(() => {
                const activeCount =
                  (memberFilter !== "all" ? 1 : 0) +
                  (categoryFilter !== "all" ? 1 : 0) +
                  (dateFrom ? 1 : 0) +
                  (dateTo ? 1 : 0);
                return (
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
                      <span className="muted" style={{ fontSize: "0.9rem" }}>
                        Showing {filteredExpenses.length} of {expenses.length} expenses
                      </span>
                      {activeCount > 0 && (
                        <button
                          type="button"
                          className="filter-clear"
                          onClick={resetFilters}
                          title="Clear all active filters"
                        >
                          <span className="filter-clear__x" aria-hidden="true">×</span>
                          Clear <span className="filter-clear__count">{activeCount}</span> {activeCount === 1 ? "filter" : "filters"}
                        </button>
                      )}
                    </div>
                    <strong style={{ fontFamily: "var(--serif)", fontSize: "1.1rem" }}>
                      {formatCurrency.format(filteredTotal)}
                    </strong>
                  </div>
                );
              })()}
            </div>
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
                        {day.expenses.map((expense) => {
                    const badges: string[] = [];
                    if (typeof expense.tax === "number" && expense.tax > 0) {
                      badges.push(`Tax ${formatCurrency.format(expense.tax)}`);
                    }
                    if (typeof expense.tip === "number" && expense.tip > 0) {
                      badges.push(`Tip ${formatCurrency.format(expense.tip)}`);
                    }
                    const previewData = expense.receiptId
                      ? receiptPreviewCache[expense.receiptId]
                      : undefined;
                    const isLoadingPreview =
                      viewingReceiptId === expense.receiptId;

                    return (
                      <div
                        key={expense.expenseId}
                        className="card"
                        style={{
                          padding: "1.35rem 1.6rem",
                          borderRadius: "1.1rem",
                          border: "1px solid rgba(148,163,184,0.12)",
                          background: "rgba(15,23,42,0.65)",
                          boxShadow: "0 25px 45px -35px rgba(15,15,35,0.75)",
                          backdropFilter: "blur(10px)",
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
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            borderTop: "1px solid rgba(148,163,184,0.12)",
                            paddingTop: "0.8rem"
                          }}
                        >
                          <span className="muted" style={{ fontSize: "0.85rem" }}>
                            {sharedLabel(expense.sharedWithMemberIds.length)}
                          </span>
                          <div style={{ display: "flex", gap: "0.5rem" }}>
                            {expense.receiptId && (
                              <button
                                className="secondary"
                                style={{ paddingInline: "0.65rem", fontSize: "0.85rem" }}
                                disabled={
                                  viewingReceiptId === expense.receiptId ||
                                  receiptMetadata.status.get(expense.receiptId) === "FAILED" ||
                                  (!previewData &&
                                    (receiptMetadata.status.get(expense.receiptId) !== "COMPLETED" ||
                                      !receiptMetadata.storage.get(expense.receiptId)))
                                }
                                onClick={() => {
                                  if (!expense.receiptId) return;
                                  if (previewData) {
                                    window.open(previewData.url, "_blank", "noopener");
                                    return;
                                  }
                                  void handleViewReceipt(expense.receiptId);
                                }}
                              >
                                {previewData
                                  ? "Open full size"
                                  : isLoadingPreview
                                  ? "Loading…"
                                  : receiptMetadata.status.get(expense.receiptId) === "FAILED"
                                  ? "Unavailable"
                                  : "Load preview"}
                              </button>
                            )}
                            <button
                              type="button"
                              className="secondary"
                              style={{
                                paddingInline: "0.7rem",
                                fontSize: "0.85rem",
                                display: "inline-flex",
                                alignItems: "center",
                                gap: "0.3rem"
                              }}
                              title="Clone this expense into the form"
                              onClick={() => onRepeatExpense(expense)}
                            >
                              <span aria-hidden="true">↻</span> Repeat
                            </button>
                            <button
                              type="button"
                              className="secondary"
                              style={{
                                paddingInline: "0.7rem",
                                opacity: 0.6,
                                fontSize: "0.85rem"
                              }}
                              disabled={
                                deletePending && deletingExpenseId === expense.expenseId
                              }
                              title="Move to Recently deleted (undoable for now)"
                              onClick={() => {
                                onDeleteExpense(expense.expenseId, expense.description).catch(() => {});
                              }}
                            >
                              Delete
                            </button>
                          </div>
                        </div>
                        {(expense.receiptId && (previewData || isLoadingPreview)) && (
                          <div
                            style={{
                              marginTop: "0.85rem",
                              border: "1px solid rgba(148,163,184,0.14)",
                              borderRadius: "0.9rem",
                              padding: "0.75rem",
                              background: "rgba(15,23,42,0.45)",
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
                        })}
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
                        const attachedTo = receiptMetadata.usage.get(receipt.receiptId);
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
                                    setExpandedReceiptId(null);
                                    return;
                                  }
                                  if (receiptPreviewCache[receipt.receiptId]) {
                                    setExpandedReceiptId(receipt.receiptId);
                                    return;
                                  }
                                  void handleViewReceipt(receipt.receiptId);
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
            </div>
          </div>
        )}
      </section>
    </div>
  );
};

interface SettlementsTabProps {
  currency: string;
  members: TripSummary["members"];
  settlements: TripSummary["settlements"];
  pendingSettlements: TripSummary["settlements"];
  balances: BalanceRow[];
  settlementSuggestions: Array<{ from: string; to: string; amount: number }>;
  onRecord: (payload: {
    fromMemberId: string;
    toMemberId: string;
    amount: number;
    note?: string;
  }) => Promise<unknown>;
  isRecording: boolean;
  onConfirm: (settlementId: string, confirmed: boolean) => void;
  confirmPending: boolean;
  membersById: Record<string, string>;
  onDelete: (settlementId: string, label: string) => Promise<void>;
  deletePending: boolean;
  deletingSettlementId?: string;
  currentUserId?: string;
  paymentMethodsByMember: Record<string, PaymentMethods>;
  prefill?: SettlementPrefill | null;
  onPrefillConsumed?: () => void;
  deletedSettlements: Settlement[];
  onRestoreSettlement: (settlementId: string) => Promise<void>;
  onPurgeSettlement: (settlementId: string) => Promise<void>;
  restoringSettlementId?: string;
  purgingSettlementId?: string;
}

interface StlPayChipProps {
  method: string;
  value: string;
}

const StlPayChip = ({ method, value }: StlPayChipProps) => {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={`stl-row__pay-method ${copied ? "stl-row__pay-method--copied" : ""}`}
      title={`Copy ${value}`}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1400);
        } catch {
          // clipboard write blocked — non-fatal
        }
      }}
    >
      <span className="stl-row__pay-key">{method}</span>
      <span>{copied ? "✓ copied" : value}</span>
    </button>
  );
};

const SettlementsTab = ({
  currency,
  members,
  settlements,
  pendingSettlements,
  balances,
  settlementSuggestions,
  onRecord,
  isRecording,
  onConfirm,
  confirmPending,
  membersById,
  onDelete,
  deletePending,
  deletingSettlementId,
  currentUserId,
  paymentMethodsByMember,
  prefill,
  onPrefillConsumed,
  deletedSettlements,
  onRestoreSettlement,
  onPurgeSettlement,
  restoringSettlementId,
  purgingSettlementId
}: SettlementsTabProps) => {
  const settlementAmountFormatter = useMemo(
    () =>
      new Intl.NumberFormat(undefined, {
        style: "currency",
        currency,
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      }),
    [currency]
  );

  return (
    <div className="grid-two">
      <section className="card">
        <div className="section-title">
          <h2>Record Settlement</h2>
        </div>
        <SettlementForm
          members={members}
          currency={currency}
          isSubmitting={isRecording}
          onSubmit={onRecord}
          currentUserId={currentUserId}
          paymentMethods={paymentMethodsByMember}
          memberBalances={Object.fromEntries(balances.map((balance) => [balance.memberId, balance.balance]))}
          settlementSuggestions={settlementSuggestions}
          prefill={prefill}
          onPrefillConsumed={onPrefillConsumed}
        />
      </section>

      <section className="card" style={{ gridColumn: "1 / -1" }}>
        <div className="section-title">
          <h2>Settlement History</h2>
          <span className="muted">{settlements.length} recorded</span>
        </div>
        {settlements.length === 0 ? (
          <p className="muted" style={{ fontStyle: "italic" }}>
            No settlements recorded yet.
          </p>
        ) : (
          <div className="list">
            {settlements.map((settlement) => {
              const fromName = membersById[settlement.fromMemberId] ?? settlement.fromMemberId;
              const toName = membersById[settlement.toMemberId] ?? settlement.toMemberId;
              const isFromUser = currentUserId === settlement.fromMemberId;
              const isToUser = currentUserId === settlement.toMemberId;
              const confirmed = Boolean(settlement.confirmedAt);
              const rowModifier = !confirmed && isFromUser
                ? "stl-row--owe-self"
                : !confirmed && isToUser
                  ? "stl-row--owed-self"
                  : "";
              const recipientMethods = paymentMethodsByMember[settlement.toMemberId];
              const payableMethods = recipientMethods
                ? (Object.entries(recipientMethods).filter(([, v]) => Boolean(v)) as Array<[string, string]>)
                : [];
              const showPayPanel =
                !confirmed && isFromUser && payableMethods.length > 0;

              const confirmLabel = isFromUser
                ? "I paid this"
                : isToUser
                  ? "Confirm received"
                  : "Mark confirmed";
              const confirmModifier = isFromUser
                ? "stl-confirm--sender"
                : isToUser
                  ? "stl-confirm--receiver"
                  : "stl-confirm--third";

              return (
                <div key={settlement.settlementId} className={`stl-row ${rowModifier}`}>
                  <div className="stl-row__head">
                    <div className="stl-row__person">
                      <OvAvatar
                        name={fromName}
                        memberId={settlement.fromMemberId}
                        size="sm"
                        isSelf={isFromUser}
                      />
                      <div className="stl-row__person-body">
                        <span className="stl-row__role">{confirmed ? "Paid" : "Owes"}</span>
                        <span className="stl-row__name">
                          {isFromUser ? <em style={{ fontStyle: "italic", color: "#f8fafc" }}>You</em> : fromName}
                        </span>
                      </div>
                    </div>

                    <div className="stl-row__center">
                      <span
                        className={`stl-row__amount ${confirmed ? "stl-row__amount--confirmed" : ""}`}
                      >
                        {settlementAmountFormatter.format(settlement.amount)}
                      </span>
                      <div className="stl-row__arc">
                        <OvFlowArc tone={confirmed ? "owed" : isFromUser ? "owe" : isToUser ? "owed" : "neutral"} />
                      </div>
                    </div>

                    <div className="stl-row__person stl-row__person--to">
                      <div className="stl-row__person-body">
                        <span className="stl-row__role">{confirmed ? "Received" : "To"}</span>
                        <span className="stl-row__name">
                          {isToUser ? <em style={{ fontStyle: "italic", color: "#f8fafc" }}>You</em> : toName}
                        </span>
                      </div>
                      <OvAvatar
                        name={toName}
                        memberId={settlement.toMemberId}
                        size="sm"
                        isSelf={isToUser}
                      />
                    </div>
                  </div>

                  {settlement.note && (
                    <p className="stl-row__note">“{settlement.note}”</p>
                  )}

                  <div className="stl-row__meta">
                    <span className={`stl-row__status stl-row__status--${confirmed ? "confirmed" : "pending"}`}>
                      <span className="stl-row__status-dot" />
                      {confirmed ? "Confirmed" : "Pending"}
                    </span>
                    <span>Recorded {formatDate(settlement.createdAt)}</span>
                    {confirmed && settlement.confirmedAt && (
                      <span>· Confirmed {formatDate(settlement.confirmedAt)}</span>
                    )}
                  </div>

                  {showPayPanel && (
                    <div className="stl-row__pay-panel">
                      <span className="stl-row__pay-label">Pay {toName} via</span>
                      <div className="stl-row__pay-methods">
                        {payableMethods.map(([method, value]) => (
                          <StlPayChip key={method} method={method} value={value} />
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="stl-row__actions">
                    {!confirmed && (
                      <button
                        type="button"
                        className={`stl-confirm ${confirmModifier}`}
                        disabled={confirmPending}
                        onClick={() => onConfirm(settlement.settlementId, true)}
                      >
                        {confirmLabel}
                      </button>
                    )}
                    {confirmed && (
                      <button
                        type="button"
                        className="secondary"
                        disabled={confirmPending}
                        onClick={() => onConfirm(settlement.settlementId, false)}
                      >
                        Mark pending
                      </button>
                    )}
                    <button
                      type="button"
                      className="secondary"
                      disabled={deletePending && deletingSettlementId === settlement.settlementId}
                      title="Move to Recently deleted (undoable for now)"
                      onClick={() => {
                        onDelete(settlement.settlementId, `${fromName} → ${toName}`).catch(() => {});
                      }}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {pendingSettlements.length > 0 && (
          <p className="muted" style={{ marginTop: "1rem", fontSize: "0.85rem" }}>
            Pending settlements reduce balances once confirmed.
          </p>
        )}
        <RecentlyDeletedList
          label="Settlements"
          emptyHint={`${deletedSettlements.length} item${deletedSettlements.length === 1 ? "" : "s"}`}
          items={deletedSettlements.map((settlement) => {
            const from = membersById[settlement.fromMemberId] ?? settlement.fromMemberId;
            const to = membersById[settlement.toMemberId] ?? settlement.toMemberId;
            return {
              id: settlement.settlementId,
              title: (
                <>
                  <strong>{settlementAmountFormatter.format(settlement.amount)}</strong> · {from} → {to}
                </>
              ),
              meta: `Deleted ${settlement.deletedAt ? formatDate(settlement.deletedAt) : ""}`
            };
          })}
          onRestore={onRestoreSettlement}
          onPurge={onPurgeSettlement}
          restoringId={restoringSettlementId}
          purgingId={purgingSettlementId}
        />
      </section>
    </div>
  );
};

// ---------- Activity feed ----------

type ActivityKind =
  | "expense_added"
  | "expense_edited"
  | "settlement_recorded"
  | "settlement_confirmed"
  | "member_added";

interface ActivityEvent {
  id: string;
  timestamp: string;
  actorId: string;
  actorName: string;
  kind: ActivityKind;
  amount?: number;
  amountTone?: "positive" | "negative" | "neutral";
  body: ReactNode;
  iconChar: string;
  tone: "owe" | "owed" | "neutral";
}

interface ActivityTabProps {
  expenses: TripSummary["expenses"];
  settlements: TripSummary["settlements"];
  members: TripSummary["members"];
  membersById: Record<string, string>;
  currency: string;
  currentUserId?: string;
}

const ActivityTab = ({
  expenses,
  settlements,
  members,
  membersById,
  currency,
  currentUserId
}: ActivityTabProps) => {
  const currencyFormatter = useMemo(
    () =>
      new Intl.NumberFormat(undefined, {
        style: "currency",
        currency,
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      }),
    [currency]
  );

  const nameOf = useCallback(
    (memberId: string): string => {
      if (memberId === currentUserId) return "You";
      return membersById[memberId] ?? "Someone";
    },
    [membersById, currentUserId]
  );

  const events = useMemo<ActivityEvent[]>(() => {
    const acc: ActivityEvent[] = [];

    expenses.forEach((expense) => {
      const actor = expense.paidByMemberId;
      const actorName = nameOf(actor);
      const resolved = resolveExpenseCategory(expense.category);
      acc.push({
        id: `exp-added-${expense.expenseId}`,
        timestamp: expense.createdAt,
        actorId: actor,
        actorName,
        kind: "expense_added",
        amount: expense.total,
        amountTone: "neutral",
        iconChar: resolved?.icon ?? "🧾",
        tone: "neutral",
        body: (
          <>
            <strong>{actorName}</strong> added{" "}
            <span className="act-amount">{currencyFormatter.format(expense.total)}</span>{" "}
            <em style={{ fontStyle: "italic" }}>“{expense.description}”</em>
            {resolved ? <> · {resolved.label}</> : null}
          </>
        )
      });

      if (
        expense.updatedAt &&
        expense.updatedAt !== expense.createdAt
      ) {
        acc.push({
          id: `exp-edited-${expense.expenseId}`,
          timestamp: expense.updatedAt,
          actorId: actor,
          actorName,
          kind: "expense_edited",
          iconChar: "✎",
          tone: "neutral",
          body: (
            <>
              <strong>{actorName}</strong> edited{" "}
              <em style={{ fontStyle: "italic" }}>“{expense.description}”</em>
            </>
          )
        });
      }
    });

    settlements.forEach((settlement) => {
      const fromName = nameOf(settlement.fromMemberId);
      const toName = nameOf(settlement.toMemberId);
      const involvesMe =
        currentUserId === settlement.fromMemberId || currentUserId === settlement.toMemberId;
      const recordedTone: "owe" | "owed" | "neutral" =
        currentUserId === settlement.fromMemberId
          ? "owe"
          : currentUserId === settlement.toMemberId
            ? "owed"
            : "neutral";
      acc.push({
        id: `stl-rec-${settlement.settlementId}`,
        timestamp: settlement.createdAt,
        actorId: settlement.createdBy ?? settlement.fromMemberId,
        actorName: nameOf(settlement.createdBy ?? settlement.fromMemberId),
        kind: "settlement_recorded",
        amount: settlement.amount,
        iconChar: "→",
        tone: recordedTone,
        body: (
          <>
            <strong>{fromName}</strong> {involvesMe && fromName === "You" ? "marked paying" : "paid"}{" "}
            <strong>{toName}</strong>{" "}
            <span className="act-amount">{currencyFormatter.format(settlement.amount)}</span>
            {!settlement.confirmedAt ? <> · <em style={{ color: "var(--owe)" }}>pending</em></> : null}
          </>
        )
      });

      if (settlement.confirmedAt) {
        const confirmedBy = settlement.toMemberId;
        acc.push({
          id: `stl-conf-${settlement.settlementId}`,
          timestamp: settlement.confirmedAt,
          actorId: confirmedBy,
          actorName: nameOf(confirmedBy),
          kind: "settlement_confirmed",
          amount: settlement.amount,
          iconChar: "✓",
          tone: "owed",
          body: (
            <>
              <strong>{nameOf(confirmedBy)}</strong> confirmed receiving{" "}
              <span className="act-amount act-amount--positive">
                {currencyFormatter.format(settlement.amount)}
              </span>{" "}
              from <strong>{fromName}</strong>
            </>
          )
        });
      }
    });

    members.forEach((member) => {
      if (member.addedBy && member.addedBy !== member.memberId) {
        acc.push({
          id: `mem-${member.memberId}`,
          timestamp: member.createdAt,
          actorId: member.addedBy,
          actorName: nameOf(member.addedBy),
          kind: "member_added",
          iconChar: "+",
          tone: "neutral",
          body: (
            <>
              <strong>{nameOf(member.addedBy)}</strong> added{" "}
              <strong>{nameOf(member.memberId)}</strong> to the group
            </>
          )
        });
      }
    });

    return acc.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  }, [expenses, settlements, members, currencyFormatter, nameOf, currentUserId]);

  const eventsByDay = useMemo(() => {
    const groups = new Map<string, { dayKey: string; ref: string; events: ActivityEvent[] }>();
    events.forEach((event) => {
      const dayKey = localDayKey(event.timestamp);
      const g = groups.get(dayKey);
      if (g) g.events.push(event);
      else groups.set(dayKey, { dayKey, ref: event.timestamp, events: [event] });
    });
    return Array.from(groups.values());
  }, [events]);

  if (events.length === 0) {
    return (
      <section className="card">
        <div className="act-empty">
          <div className="act-empty__mark">∼</div>
          <p className="act-empty__title">Nothing's happened yet.</p>
          <p className="act-empty__hint">
            Add an expense or record a settlement and it'll show up here.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="card">
      <div className="section-title">
        <h2>Activity</h2>
        <span className="muted" style={{ fontSize: "0.85rem" }}>
          {events.length} {events.length === 1 ? "event" : "events"}
        </span>
      </div>
      <div className="act-wrap">
        {eventsByDay.map((day) => {
          const label = formatDayLabel(day.ref);
          return (
            <div key={day.dayKey} className="act-day">
              <div className="act-day__header">
                <span className="act-day__date">
                  {label.primary}
                  {label.secondary && (
                    <small style={{ fontFamily: "Inter, sans-serif", fontStyle: "normal", fontSize: "0.75rem", color: "#64748b", letterSpacing: "0.06em", textTransform: "uppercase", marginLeft: "0.55rem", fontWeight: 500 }}>
                      {label.secondary}
                    </small>
                  )}
                </span>
                <span className="act-day__meta">
                  {day.events.length} {day.events.length === 1 ? "event" : "events"}
                </span>
              </div>
              <div className="act-list">
                {day.events.map((event) => (
                  <div key={event.id} className={`act-row act-row--${event.tone}`}>
                    <OvAvatar
                      name={event.actorName}
                      memberId={event.actorId}
                      size="sm"
                      isSelf={event.actorId === currentUserId}
                    />
                    <div className="act-row__body">
                      <span className="act-row__line">{event.body}</span>
                      <span className="act-row__sub">
                        <span className="act-row__kind-icon" aria-hidden="true">
                          {event.iconChar}
                        </span>
                        {event.kind === "expense_added"
                          ? "expense added"
                          : event.kind === "expense_edited"
                            ? "expense edited"
                            : event.kind === "settlement_recorded"
                              ? "settlement recorded"
                              : event.kind === "settlement_confirmed"
                                ? "settlement confirmed"
                                : "member added"}
                      </span>
                    </div>
                    <span className="act-row__time">{formatTime(event.timestamp)}</span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
};

interface PeopleTabProps {
  members: TripSummary["members"];
  memberSearchTerm: string;
  onMemberSearchTermChange: (value: string) => void;
  searchResults: UserProfile[];
  searchMessage: string | null;
  feedbackMessage: string | null;
  onAddMember: (userId: string) => void;
  addLoading: boolean;
  canManageMembers: boolean;
  ownerId: string;
  onRemoveMember: (memberId: string) => Promise<void>;
  removeLoading: boolean;
  removingMemberId?: string;
  currentUserId?: string;
  membersById: Record<string, string>;
  paymentMethodsByMember: Record<string, PaymentMethods>;
  onSavePaymentMethods: (methods: PaymentMethodsInput) => void;
  paymentMethodsMessage: string | null;
  savingPaymentMethods: boolean;
}

const PeopleTab = ({
  members,
  memberSearchTerm,
  onMemberSearchTermChange,
  searchResults,
  searchMessage,
  feedbackMessage,
  onAddMember,
  addLoading,
  canManageMembers,
  ownerId,
  onRemoveMember,
  removeLoading,
  removingMemberId,
  currentUserId,
  membersById,
  paymentMethodsByMember,
  onSavePaymentMethods,
  paymentMethodsMessage,
  savingPaymentMethods
}: PeopleTabProps) => {
  const editableMemberId = useMemo(
    () => members.find((member) => member.memberId === currentUserId)?.memberId,
    [members, currentUserId]
  );

  const [methodDraft, setMethodDraft] = useState<PaymentMethods>({});

  useEffect(() => {
    if (!editableMemberId) {
      setMethodDraft({});
      return;
    }
    setMethodDraft(paymentMethodsByMember[editableMemberId] ?? {});
  }, [editableMemberId, paymentMethodsByMember]);

  const handleSave = () => {
    if (!editableMemberId) return;
    const payload: PaymentMethodsInput = {
      venmo: (methodDraft.venmo ?? "").trim() || null,
      paypal: (methodDraft.paypal ?? "").trim() || null,
      zelle: (methodDraft.zelle ?? "").trim() || null
    };
    onSavePaymentMethods(payload);
  };

  return (
    <div className="grid-two">
      <section className="card">
        <div className="section-title">
          <h2>People</h2>
        </div>
        <div className="list">
          <div className="input-group">
            <label htmlFor="member-search">Find people</label>
            <input
              id="member-search"
              value={memberSearchTerm}
              onChange={(event) => onMemberSearchTermChange(event.target.value)}
              placeholder="Search by name or email"
            />
          </div>
          {searchMessage && <p className="muted">{searchMessage}</p>}
          {feedbackMessage && (
            <p
              style={{
                color: /fail|cannot|error/i.test(feedbackMessage)
                  ? "#f87171"
                  : "#4ade80"
              }}
            >
              {feedbackMessage}
            </p>
          )}
          {searchResults.length > 0 && (
            <div className="list">
              {searchResults.map((user) => {
                const alreadyMember = members.some((member) => member.memberId === user.userId);
                const label = `${user.displayName ?? user.email ?? user.userId}${user.userId === currentUserId ? " (you)" : ""}`;
                return (
                  <div
                    key={user.userId}
                    className="card"
                    style={{ padding: "0.75rem", display: "flex", justifyContent: "space-between", alignItems: "center" }}
                  >
                    <div>
                      <strong>{label}</strong>
                      {user.email && (
                        <p className="muted" style={{ margin: "0.2rem 0 0" }}>
                          {user.email}
                        </p>
                      )}
                    </div>
                    <button
                      className="secondary"
                      disabled={addLoading || alreadyMember}
                      onClick={() => onAddMember(user.userId)}
                    >
                      {alreadyMember ? "Already added" : "Add"}
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          <div className="card" style={{ padding: "0.75rem", gap: "0.6rem", display: "flex", flexDirection: "column" }}>
            <div className="section-title" style={{ marginBottom: 0 }}>
              <h3 style={{ margin: 0 }}>Payment methods</h3>
              <span className="muted">Visible to this group</span>
            </div>
            <p className="muted" style={{ margin: 0 }}>
              You can only edit your own payment methods. Others will see them when recording a settlement to you.
            </p>
            {!editableMemberId ? (
              <p className="muted" style={{ margin: 0 }}>Join the trip to add your payment methods.</p>
            ) : (
              <>
                <div className="input-group">
                  <label>Venmo</label>
                  <input
                    value={methodDraft.venmo ?? ""}
                    onChange={(event) =>
                      setMethodDraft((current) => ({ ...current, venmo: event.target.value }))
                    }
                    placeholder="@username"
                  />
                </div>
                <div className="input-group">
                  <label>PayPal</label>
                  <input
                    value={methodDraft.paypal ?? ""}
                    onChange={(event) =>
                      setMethodDraft((current) => ({ ...current, paypal: event.target.value }))
                    }
                    placeholder="email@example.com"
                  />
                </div>
                <div className="input-group">
                  <label>Zelle</label>
                  <input
                    value={methodDraft.zelle ?? ""}
                    onChange={(event) =>
                      setMethodDraft((current) => ({ ...current, zelle: event.target.value }))
                    }
                    placeholder="phone or email"
                  />
                </div>
                {paymentMethodsMessage && (
                  <p
                    style={{
                      margin: 0,
                      color: /fail|cannot|error|unable|invalid/i.test(paymentMethodsMessage)
                        ? "#f87171"
                        : "#4ade80"
                    }}
                  >
                    {paymentMethodsMessage}
                  </p>
                )}
                <button
                  type="button"
                  className="secondary"
                  onClick={handleSave}
                  disabled={savingPaymentMethods}
                >
                  {savingPaymentMethods ? "Saving…" : "Save your methods"}
                </button>
              </>
            )}
          </div>
        </div>
      </section>

      <section className="card">
        <div className="section-title">
          <h2>Trip Members</h2>
          <span className="muted">{members.length}</span>
        </div>
        <div className="list">
          {members.map((member) => {
            const canRemove =
              canManageMembers && member.memberId !== ownerId;
            const label = membersById[member.memberId] ?? member.displayName ?? member.email ?? member.memberId;
            const methods = paymentMethodsByMember[member.memberId];
            const hasMethods = Boolean(
              methods && Object.values(methods).some((value) => typeof value === "string" && value.trim())
            );
            return (
              <div
                key={member.memberId}
                className="card"
                style={{
                  padding: "0.75rem 1rem",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: "1rem"
                }}
              >
                <div style={{ flex: 1 }}>
                  <strong>{label}</strong>
                  {member.email && (
                    <p className="muted" style={{ margin: "0.2rem 0 0" }}>
                      {member.email}
                    </p>
                  )}
                  {hasMethods && methods && (
                    <p className="muted" style={{ margin: "0.4rem 0 0", fontSize: "0.85rem" }}>
                      {methods.venmo && <span>Venmo: {methods.venmo} </span>}
                      {methods.paypal && <span>PayPal: {methods.paypal} </span>}
                      {methods.zelle && <span>Zelle: {methods.zelle}</span>}
                    </p>
                  )}
                </div>
                <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                  {canRemove && (
                    <button
                      className="secondary"
                      disabled={
                        removeLoading && removingMemberId === member.memberId
                      }
                      onClick={() => {
                        if (
                          !window.confirm(
                            `Remove ${label} from this trip?`
                          )
                        ) {
                          return;
                        }
                        onRemoveMember(member.memberId).catch(() => {});
                      }}
                    >
                      Remove
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
};

export default TripDetailPage;
