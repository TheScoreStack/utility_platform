import { FormEvent, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { api, ApiError, searchUsers as searchUsersRequest } from "../lib/api";
import type { Trip, TripListResponse, UserProfile } from "../types";
import { getInitials, seedAvatar } from "../lib/avatarPalette";
import { formatTripRange, formatTripStamp } from "../lib/tripFormat";

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


const tripTone = (trip: TripWithStatus): "owe" | "owed" | "neutral" => {
  if ((trip.outstandingBalance ?? 0) > 0) return "owe";
  if ((trip.owedToYou ?? 0) > 0) return "owed";
  return "neutral";
};

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

  const allTrips = useMemo<TripWithStatus[]>(
    () => (data?.trips ?? []) as TripWithStatus[],
    [data]
  );
  const trips = useMemo(
    () => allTrips.filter((trip) => !trip.archivedAt),
    [allTrips]
  );
  const archivedTrips = useMemo(
    () =>
      allTrips
        .filter((trip) => Boolean(trip.archivedAt))
        .sort((a, b) =>
          (b.archivedAt ?? "").localeCompare(a.archivedAt ?? "")
        ),
    [allTrips]
  );
  const [archivedOpen, setArchivedOpen] = useState(false);

  const stats = useMemo(() => {
    let outstanding = 0;
    let owedBack = 0;
    let pending = 0;
    trips.forEach((trip) => {
      if ((trip.outstandingBalance ?? 0) > 0) outstanding += 1;
      if ((trip.owedToYou ?? 0) > 0) owedBack += 1;
      if (trip.hasPendingActions) pending += 1;
    });
    return { outstanding, owedBack, pending };
  }, [trips]);

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
    onSuccess: (response) => {
      setSearchResults(response.users);
      setSearchMessage(
        response.users.length ? null : "No people found with that email prefix"
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
    setSelectedMembers((prev) =>
      prev.filter((member) => member.userId !== userId)
    );
  };

  return (
    <div className="tl-page">
      {/* HERO */}
      <section className="tl-hero ov-rise ov-rise-1">
        <span className="tl-hero__eyebrow">
          Ledger · {trips.length} {trips.length === 1 ? "active" : "active"}
        </span>
        <h1 className="tl-hero__title">
          Your tabs, <em>kept open.</em>
        </h1>
        <p className="tl-hero__sub">
          {trips.length === 0
            ? "Nothing on the books yet — start a tab on the right."
            : stats.outstanding + stats.owedBack + stats.pending === 0
              ? "Everything's squared up. A rare moment."
              : "A small running record of who's owed what, and who paid last."}
        </p>
        <div className="tl-hero__rule" aria-hidden="true" />

        {trips.length > 0 && (
          <div className="tl-hero__stamps">
            <div className="tl-hero__stamp tl-hero__stamp--owe">
              <span className="tl-hero__stamp-num">{stats.outstanding}</span>
              <span className="tl-hero__stamp-label">You owe in</span>
            </div>
            <div className="tl-hero__stamp tl-hero__stamp--owed">
              <span className="tl-hero__stamp-num">{stats.owedBack}</span>
              <span className="tl-hero__stamp-label">Owed back in</span>
            </div>
            <div className="tl-hero__stamp tl-hero__stamp--pending">
              <span className="tl-hero__stamp-num">{stats.pending}</span>
              <span className="tl-hero__stamp-label">With pending</span>
            </div>
          </div>
        )}

        <span className="tl-hero__folio" aria-hidden="true">
          No.&nbsp;{trips.length}
        </span>
      </section>

      <div className="tl-grid">
        {/* MAIN — trips list */}
        <section className="tl-main ov-rise ov-rise-2">
          <div className="tl-section-head">
            <h2 className="tl-section-head__title">Trips</h2>
            <span className="tl-section-head__count">
              {trips.length} {trips.length === 1 ? "entry" : "entries"}
            </span>
          </div>

          {isLoading ? (
            <div className="tl-list">
              {[0, 1, 2].map((i) => (
                <div key={i} className="tl-card tl-card--skeleton">
                  <span
                    className="skel skel--text"
                    style={{ width: "5rem", height: "0.7rem" }}
                  >
                    &nbsp;
                  </span>
                  <span
                    className="skel skel--title"
                    style={{ width: `${50 + ((i * 17) % 30)}%` }}
                  >
                    &nbsp;
                  </span>
                  <span className="skel skel--text" style={{ width: "10rem" }}>
                    &nbsp;
                  </span>
                </div>
              ))}
            </div>
          ) : trips.length === 0 ? (
            <div className="empty-state">
              <p className="empty-state__title">No trips yet.</p>
              <p className="empty-state__hint">
                Open a new tab on the right — name it after a trip, a dinner,
                or any shared bill.
              </p>
            </div>
          ) : (
            <div className="tl-list">
              {trips.map((trip, idx) => {
                const tone = tripTone(trip);
                const stamp = formatTripStamp(trip.startDate, trip.endDate);
                const range = formatTripRange(trip.startDate, trip.endDate);
                return (
                  <Link
                    key={trip.tripId}
                    to={`/group-expenses/trips/${trip.tripId}`}
                    className={`tl-card tl-card--${tone}`}
                    style={{ animationDelay: `${0.08 * idx}s` }}
                  >
                    <div className="tl-card__top">
                      <span className="tl-card__stamp">
                        {stamp ?? "OPEN TAB"}
                      </span>
                      {trip.hasPendingActions && (
                        <span
                          className="tl-card__pill tl-card__pill--pending"
                          title="Pending confirmations"
                        >
                          <span
                            className="tl-card__pill-dot"
                            aria-hidden="true"
                          />
                          Pending
                        </span>
                      )}
                    </div>

                    <h3 className="tl-card__title">{trip.name}</h3>
                    <p className="tl-card__meta">{range}</p>

                    <div className="tl-card__foot">
                      <div className="tl-card__pills">
                        {tone === "owe" &&
                          typeof trip.outstandingBalance === "number" && (
                            <span className="tl-card__pill tl-card__pill--owe">
                              You owe&nbsp;
                              <strong>
                                {formatCurrencyValue(
                                  trip.outstandingBalance,
                                  trip.currency
                                )}
                              </strong>
                            </span>
                          )}
                        {tone === "owed" &&
                          typeof trip.owedToYou === "number" && (
                            <span className="tl-card__pill tl-card__pill--owed">
                              You&rsquo;re owed&nbsp;
                              <strong>
                                {formatCurrencyValue(
                                  trip.owedToYou,
                                  trip.currency
                                )}
                              </strong>
                            </span>
                          )}
                        {tone === "neutral" && (
                          <span className="tl-card__pill tl-card__pill--neutral">
                            All squared up
                          </span>
                        )}
                      </div>
                      <span className="tl-card__open">Open →</span>
                    </div>

                    <span className="tl-card__stripe" aria-hidden="true" />
                  </Link>
                );
              })}
            </div>
          )}

          {archivedTrips.length > 0 && (
            <div className="tl-archived">
              <button
                type="button"
                className="tl-archived__toggle"
                onClick={() => setArchivedOpen((v) => !v)}
                aria-expanded={archivedOpen}
              >
                <span className="tl-archived__title">
                  <span
                    className={`tl-archived__chevron ${
                      archivedOpen ? "tl-archived__chevron--open" : ""
                    }`}
                  >
                    ▸
                  </span>
                  Archived
                </span>
                <span className="tl-archived__count">
                  {archivedTrips.length}{" "}
                  {archivedTrips.length === 1 ? "tab" : "tabs"}
                </span>
              </button>
              {archivedOpen && (
                <div className="tl-archived__list">
                  {archivedTrips.map((trip) => {
                    const stamp = formatTripStamp(trip.startDate, trip.endDate);
                    const range = formatTripRange(trip.startDate, trip.endDate);
                    return (
                      <Link
                        key={trip.tripId}
                        to={`/group-expenses/trips/${trip.tripId}`}
                        className="tl-card tl-card--neutral tl-card--archived"
                      >
                        <div className="tl-card__top">
                          <span className="tl-card__stamp">
                            {stamp ?? "OPEN TAB"}
                          </span>
                          <span className="tl-card__archived-tag">
                            Closed
                          </span>
                        </div>
                        <h3 className="tl-card__title">{trip.name}</h3>
                        <p className="tl-card__meta">{range}</p>
                        <div className="tl-card__foot">
                          <div className="tl-card__pills">
                            <span className="tl-card__pill tl-card__pill--neutral">
                              Archived
                            </span>
                          </div>
                          <span className="tl-card__open">Reopen →</span>
                        </div>
                        <span className="tl-card__stripe" aria-hidden="true" />
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </section>

        {/* ASIDE — create */}
        <aside className="tl-aside ov-rise ov-rise-3">
          <div className="tl-aside__head">
            <h2 className="tl-aside__title">
              Start a <em>new tab.</em>
            </h2>
            <p className="tl-aside__sub">
              Name it. Date it (or not). Invite the people who were there.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="tl-form">
            <div className="input-group">
              <label htmlFor="trip-name">Name</label>
              <input
                id="trip-name"
                value={form.name}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, name: event.target.value }))
                }
                placeholder="Nashville Tour 2024"
              />
            </div>

            <div className="input-group">
              <label>
                Dates{" "}
                <span
                  className="muted"
                  style={{ fontSize: "0.8rem", fontWeight: 400 }}
                >
                  · optional
                </span>
              </label>
              <div className="input-row">
                <input
                  type="date"
                  value={form.startDate}
                  onChange={(event) =>
                    setForm((prev) => ({
                      ...prev,
                      startDate: event.target.value
                    }))
                  }
                />
                <input
                  type="date"
                  value={form.endDate}
                  onChange={(event) =>
                    setForm((prev) => ({
                      ...prev,
                      endDate: event.target.value
                    }))
                  }
                />
              </div>
            </div>

            <div className="tl-divider" aria-hidden="true" />

            <div className="input-group">
              <label>
                Invite people
                <span
                  className="muted"
                  style={{ fontSize: "0.8rem", fontWeight: 400 }}
                >
                  {" "}
                  · optional
                </span>
              </label>
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
                <button
                  type="button"
                  className="secondary"
                  disabled={searchMutation.isPending}
                  onClick={runSearch}
                >
                  {searchMutation.isPending ? "Searching…" : "Search"}
                </button>
              </div>

              {searchMessage && (
                <p className="tl-form__msg muted">{searchMessage}</p>
              )}

              {searchResults.length > 0 && (
                <div className="tl-search-results">
                  {searchResults.map((user) => {
                    const name = user.displayName ?? user.email ?? "Unnamed";
                    const palette = seedAvatar(user.userId);
                    const added = selectedMembers.some(
                      (member) => member.userId === user.userId
                    );
                    return (
                      <div key={user.userId} className="tl-search-result">
                        <div
                          className="tl-search-result__avatar"
                          style={{
                            background: palette.bg,
                            color: palette.fg
                          }}
                          aria-hidden="true"
                        >
                          {getInitials(name)}
                        </div>
                        <div className="tl-search-result__body">
                          <span className="tl-search-result__name">{name}</span>
                          {user.email && (
                            <span className="tl-search-result__email">
                              {user.email}
                            </span>
                          )}
                        </div>
                        <button
                          type="button"
                          className="tl-search-result__add"
                          onClick={() => addSelectedMember(user)}
                          disabled={added}
                        >
                          {added ? "✓ added" : "Add"}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}

              {selectedMembers.length > 0 && (
                <>
                  <p className="tl-chips__label">
                    Bringing along ({selectedMembers.length})
                  </p>
                  <div className="tl-chips">
                    {selectedMembers.map((member) => {
                      const name =
                        member.displayName ??
                        member.email ??
                        member.userId;
                      const palette = seedAvatar(member.userId);
                      return (
                        <span
                          key={member.userId}
                          className="tl-chip"
                          title={member.email ?? undefined}
                        >
                          <span
                            className="tl-chip__avatar"
                            style={{
                              background: palette.bg,
                              color: palette.fg
                            }}
                            aria-hidden="true"
                          >
                            {getInitials(name)}
                          </span>
                          <span className="tl-chip__name">{name}</span>
                          <button
                            type="button"
                            className="tl-chip__remove"
                            onClick={() =>
                              removeSelectedMember(member.userId)
                            }
                            aria-label={`Remove ${name}`}
                          >
                            ×
                          </button>
                        </span>
                      );
                    })}
                  </div>
                </>
              )}
            </div>

            {error && <p className="tl-form__error">{error}</p>}

            <button
              type="submit"
              className="primary tl-form__submit"
              disabled={createMutation.isPending}
            >
              {createMutation.isPending ? "Opening tab…" : "Open this tab →"}
            </button>
          </form>
        </aside>
      </div>
    </div>
  );
};

export default TripListPage;
