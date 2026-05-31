import { FormEvent, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { api, ApiError, searchUsers as searchUsersRequest } from "../lib/api";
import type { Trip, TripListResponse, UserProfile } from "../types";

interface FormState {
  name: string;
  startDate?: string;
  endDate?: string;
}

const defaultFormState: FormState = {
  name: "",
  startDate: "",
  endDate: ""
};

type TripWithStatus = Trip & {
  outstandingBalance?: number;
  owedToYou?: number;
  hasPendingActions?: boolean;
};

const formatCurrencyValue = (value: number, currency: string) =>
  new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    maximumFractionDigits: 2
  }).format(value);

const TripListPage = () => {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [form, setForm] = useState<FormState>(defaultFormState);
  const [error, setError] = useState<string | null>(null);
  const [selectedMembers, setSelectedMembers] = useState<UserProfile[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [searchResults, setSearchResults] = useState<UserProfile[]>([]);
  const [searchMessage, setSearchMessage] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["trips"],
    queryFn: () => api.get<TripListResponse>("/trips")
  });

  const trips = useMemo<TripWithStatus[]>(() => (data?.trips ?? []) as TripWithStatus[], [data]);
  const outstandingTripCount = useMemo(
    () => trips.filter((trip) => (trip.outstandingBalance ?? 0) > 0).length,
    [trips]
  );
  const pendingTripCount = useMemo(
    () => trips.filter((trip) => trip.hasPendingActions).length,
    [trips]
  );

  const createMutation = useMutation({
    mutationFn: (payload: unknown) => api.post<Trip>("/trips", payload),
    onSuccess: (trip) => {
      queryClient.invalidateQueries({ queryKey: ["trips"] });
      navigate(`/group-expenses/trips/${trip.tripId}`);
      setForm(defaultFormState);
      setSelectedMembers([]);
      setSearchResults([]);
      setSearchTerm("");
    },
    onError: (err: unknown) => {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError("Failed to create group");
      }
    }
  });

  const searchMutation = useMutation({
    mutationFn: (query: string) => searchUsersRequest(query),
    onSuccess: (data) => {
      setSearchResults(data.users);
      setSearchMessage(
        data.users.length ? null : "No people found with that email prefix"
      );
    },
    onError: (err: unknown) => {
      if (err instanceof ApiError) {
        setSearchMessage(err.message);
      } else {
        setSearchMessage("Unable to search users");
      }
    }
  });

  const runSearch = () => {
    setSearchMessage(null);
    if (!searchTerm.trim()) {
      setSearchMessage("Enter at least one character to search");
      return;
    }
    searchMutation.mutate(searchTerm.trim());
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    if (!form.name.trim()) {
      setError("Group name is required");
      return;
    }

    createMutation.mutate({
      name: form.name.trim(),
      startDate: form.startDate || undefined,
      endDate: form.endDate || undefined,
      currency: "USD",
      members: selectedMembers.map((member) => ({ userId: member.userId }))
    });
  };

  const addSelectedMember = (profile: UserProfile) => {
    setSelectedMembers((prev) => {
      if (prev.some((member) => member.userId === profile.userId)) {
        return prev;
      }
      return [...prev, profile];
    });
  };

  const removeSelectedMember = (userId: string) => {
    setSelectedMembers((prev) => prev.filter((member) => member.userId !== userId));
  };

  return (
    <div className="grid-two">
      <section className="card">
        <div className="section-title">
          <h2>Your Groups</h2>
          <span className="muted">{trips.length} active</span>
        </div>
        {trips.length > 0 && (
          <p className="muted" style={{ marginTop: "0.5rem" }}>
            {outstandingTripCount > 0
              ? `You have outstanding payments on ${outstandingTripCount} ${outstandingTripCount === 1 ? "group" : "groups"}.`
              : "No outstanding payments right now."}
            {pendingTripCount > 0 && (
              <>
                {" "}
                {pendingTripCount} {pendingTripCount === 1 ? "group has" : "groups have"} pending confirmations.
              </>
            )}
          </p>
        )}
        {isLoading ? (
          <div className="list">
            {[0, 1, 2].map((i) => (
              <div key={i} className="card" style={{ display: "flex", flexDirection: "column", gap: "0.55rem" }}>
                <span className="skel skel--title" style={{ width: `${140 + (i * 23) % 100}px` }}>&nbsp;</span>
                <span className="skel skel--text" style={{ width: "180px" }}>&nbsp;</span>
                <span className="skel skel--text" style={{ width: "240px" }}>&nbsp;</span>
              </div>
            ))}
          </div>
        ) : trips.length === 0 ? (
          <div className="empty-state">
            <p className="empty-state__title">No groups yet.</p>
            <p className="empty-state__hint">
              Start one above — name it after a trip, a dinner, or any shared bill — and invite people from the People tab.
            </p>
          </div>
        ) : (
          <div className="list">
            {trips.map((trip) => (
              <Link
                key={trip.tripId}
                to={`/group-expenses/trips/${trip.tripId}`}
                className="card"
                style={{ textDecoration: "none" }}
              >
                <h3 style={{ marginTop: 0 }}>{trip.name}</h3>
                <p className="muted" style={{ margin: "0.25rem 0" }}>
                  {trip.startDate ? `${trip.startDate}` : "Flexible dates"}
                  {trip.endDate ? ` → ${trip.endDate}` : ""}
                </p>
                {typeof trip.outstandingBalance === "number" && trip.outstandingBalance > 0 && (
                  <div className="pill" style={{ background: "#FEF3C7", color: "#92400E" }}>
                    You owe • {formatCurrencyValue(trip.outstandingBalance, trip.currency)}
                  </div>
                )}
                {!trip.outstandingBalance &&
                  typeof trip.owedToYou === "number" &&
                  trip.owedToYou > 0 && (
                    <div className="pill" style={{ background: "#DCFCE7", color: "#166534" }}>
                      You're owed • {formatCurrencyValue(trip.owedToYou, trip.currency)}
                    </div>
                  )}
                {trip.hasPendingActions && (
                  <div className="pill" style={{ background: "#E0E7FF", color: "#312E81" }}>
                    Pending confirmations
                  </div>
                )}
              </Link>
            ))}
          </div>
        )}
      </section>

      <section className="card">
        <div className="section-title">
          <h2>Create Group</h2>
        </div>
        <form onSubmit={handleSubmit} className="list">
          <div className="input-group">
            <label htmlFor="trip-name">Group name</label>
            <input
              id="trip-name"
              value={form.name}
              onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
              placeholder="Nashville Tour 2024"
            />
          </div>

          <div className="input-group">
            <label>Dates (optional)</label>
            <div className="input-row">
              <input
                type="date"
                value={form.startDate}
                onChange={(event) => setForm((prev) => ({ ...prev, startDate: event.target.value }))}
              />
              <input
                type="date"
                value={form.endDate}
                onChange={(event) => setForm((prev) => ({ ...prev, endDate: event.target.value }))}
              />
            </div>
          </div>

          <div className="input-group">
            <label>Invite people (optional)</label>
            <div className="input-row">
              <input
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="Search by email"
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    runSearch();
                  }
                }}
              />
              <button type="button" className="secondary" disabled={searchMutation.isPending} onClick={runSearch}>
                {searchMutation.isPending ? "Searching…" : "Search"}
              </button>
            </div>
            {searchMessage && <p className="muted">{searchMessage}</p>}
            {searchResults.length > 0 && (
              <div className="list">
                {searchResults.map((user) => (
                  <div key={user.userId} className="card" style={{ padding: "0.75rem" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div>
                        <strong>{user.displayName ?? user.email ?? "Unnamed"}</strong>
                        {user.email && (
                          <p className="muted" style={{ margin: "0.2rem 0 0" }}>
                            {user.email}
                          </p>
                        )}
                      </div>
                      <button
                        type="button"
                        className="secondary"
                        onClick={() => addSelectedMember(user)}
                        disabled={selectedMembers.some((member) => member.userId === user.userId)}
                      >
                        {selectedMembers.some((member) => member.userId === user.userId)
                          ? "Added"
                          : "Add"}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {selectedMembers.length > 0 && (
              <div className="list">
                <p className="muted" style={{ marginBottom: 0 }}>
                  Selected people
                </p>
                {selectedMembers.map((member) => (
                  <div
                    key={member.userId}
                    className="card"
                    style={{ padding: "0.75rem", display: "flex", justifyContent: "space-between", alignItems: "center" }}
                  >
                    <div>
                      <strong>{member.displayName ?? member.email ?? member.userId}</strong>
                      {member.email && (
                        <p className="muted" style={{ margin: "0.2rem 0 0" }}>
                          {member.email}
                        </p>
                      )}
                    </div>
                    <button type="button" className="secondary" onClick={() => removeSelectedMember(member.userId)}>
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {error && <p style={{ color: "#fda4af" }}>{error}</p>}

          <button type="submit" className="primary" disabled={createMutation.isPending}>
            {createMutation.isPending ? "Creating…" : "Create group"}
          </button>
        </form>
      </section>
    </div>
  );
};

export default TripListPage;
