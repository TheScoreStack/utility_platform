// Stack Meet — organizer home. Lists the meets you organize or answered,
// and opens new ones. Layout mirrors the Group Expenses list page: serif
// hero, main list column, create-aside on the right.

import { FormEvent, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { api, ApiError } from "../lib/api";
import { meetApi } from "../lib/meetApi";
import type { CreateMeetEventInput } from "../lib/meetApi";
import type { MeetEventSummary, MeetListResponse, MeetMode } from "../types";
import {
  browserTimezone,
  formatMeetDateSpan,
  formatMinute,
  timezoneOptions
} from "../lib/meetFormat";
import MeetDatePicker from "../components/meet/MeetDatePicker";

interface CreateFormState {
  title: string;
  mode: MeetMode;
  dates: string[];
  startHour: number;
  endHour: number;
  slotMinutes: number;
  timezone: string;
  allowIfNeedBe: boolean;
}

const defaultForm = (): CreateFormState => ({
  title: "",
  mode: "time-grid",
  dates: [],
  startHour: 9,
  endHour: 17,
  slotMinutes: 30,
  timezone: browserTimezone(),
  allowIfNeedBe: true
});

const MeetListPage = () => {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [form, setForm] = useState<CreateFormState>(defaultForm);
  const [error, setError] = useState<string | null>(null);
  const zones = useMemo(() => timezoneOptions(), []);

  const {
    data,
    isLoading,
    error: listError,
    refetch
  } = useQuery({
    queryKey: ["meet", "events"],
    queryFn: () => api.get<MeetListResponse>("/meet/events")
  });

  const events = useMemo(() => data?.events ?? [], [data]);
  const openCount = events.filter((e) => e.status === "open").length;
  const finalizedCount = events.length - openCount;

  const createMutation = useMutation({
    mutationFn: (input: CreateMeetEventInput) => meetApi.create(input),
    onSuccess: ({ event }) => {
      queryClient.invalidateQueries({ queryKey: ["meet", "events"] });
      setForm(defaultForm());
      navigate(`/meet/events/${event.eventId}`);
    },
    onError: (err: unknown) => {
      setError(
        err instanceof ApiError ? err.message : "Failed to create the meet"
      );
    }
  });

  const toggleDate = (date: string) => {
    setForm((prev) => ({
      ...prev,
      dates: prev.dates.includes(date)
        ? prev.dates.filter((d) => d !== date)
        : [...prev.dates, date].sort()
    }));
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    if (!form.title.trim()) {
      setError("Give the meet a title");
      return;
    }
    if (form.dates.length === 0) {
      setError("Pick at least one candidate day");
      return;
    }
    if (form.mode === "time-grid" && form.startHour >= form.endHour) {
      setError("The window must end after it starts");
      return;
    }
    const input: CreateMeetEventInput = {
      title: form.title.trim(),
      mode: form.mode,
      timezone: form.timezone,
      dates: [...form.dates].sort(),
      settings: { allowIfNeedBe: form.allowIfNeedBe }
    };
    if (form.mode === "time-grid") {
      input.startMinute = form.startHour * 60;
      input.endMinute = form.endHour * 60;
      input.slotMinutes = form.slotMinutes;
    }
    createMutation.mutate(input);
  };

  const statusPill = (meet: MeetEventSummary) =>
    meet.status === "finalized" ? (
      <span className="meet-pill meet-pill--finalized">Finalized</span>
    ) : (
      <span className="meet-pill meet-pill--open">
        <span className="meet-pill__dot" aria-hidden="true" />
        Collecting times
      </span>
    );

  return (
    <div className="meet-page">
      {/* HERO */}
      <section className="meet-hero ov-rise ov-rise-1">
        <span className="meet-hero__eyebrow">
          Scheduling · {openCount} open
        </span>
        <h1 className="meet-hero__title">
          Find a time <em>everyone can make.</em>
        </h1>
        <p className="meet-hero__sub">
          {events.length === 0
            ? "Propose a few days, share one link, and watch the group light up the grid."
            : openCount === 0
              ? "Everything on the docket is settled. Enjoy the calm."
              : "Grids fill in as people respond — the brightest cells are your best bets."}
        </p>
        <div className="meet-hero__rule" aria-hidden="true" />
        {events.length > 0 && (
          <div className="meet-hero__stamps">
            <div className="meet-hero__stamp meet-hero__stamp--open">
              <span className="meet-hero__stamp-num">{openCount}</span>
              <span className="meet-hero__stamp-label">Collecting</span>
            </div>
            <div className="meet-hero__stamp meet-hero__stamp--done">
              <span className="meet-hero__stamp-num">{finalizedCount}</span>
              <span className="meet-hero__stamp-label">Finalized</span>
            </div>
          </div>
        )}
      </section>

      <div className="meet-columns">
        {/* MAIN — meets list */}
        <section className="meet-main ov-rise ov-rise-2">
          <div className="meet-section-head">
            <h2 className="meet-section-head__title">Your meets</h2>
            <span className="meet-section-head__count">
              {events.length} {events.length === 1 ? "entry" : "entries"}
            </span>
          </div>

          {isLoading ? (
            <div className="meet-list">
              {[0, 1].map((i) => (
                <div key={i} className="meet-card meet-card--skeleton">
                  <span
                    className="skel skel--text"
                    style={{ width: "5rem", height: "0.7rem" }}
                  >
                    &nbsp;
                  </span>
                  <span
                    className="skel skel--title"
                    style={{ width: `${45 + ((i * 23) % 30)}%` }}
                  >
                    &nbsp;
                  </span>
                </div>
              ))}
            </div>
          ) : listError ? (
            <div className="empty-state">
              <p className="empty-state__title">
                Your meets could not be loaded.
              </p>
              <p className="empty-state__hint">
                {listError instanceof ApiError
                  ? listError.message
                  : "Check your connection and try again."}
              </p>
              <button
                type="button"
                className="secondary"
                onClick={() => refetch()}
              >
                Try again
              </button>
            </div>
          ) : events.length === 0 ? (
            <div className="empty-state">
              <p className="empty-state__title">Nothing to schedule yet.</p>
              <p className="empty-state__hint">
                Open a meet on the right — offer a few days, then send the
                link to anyone. They answer without an account.
              </p>
            </div>
          ) : (
            <div className="meet-list">
              {events.map((meet, idx) => {
                const span = formatMeetDateSpan(meet.firstDate, meet.lastDate);
                return (
                  <Link
                    key={meet.eventId}
                    to={`/meet/events/${meet.eventId}`}
                    className={`meet-card ${
                      meet.status === "finalized" ? "meet-card--finalized" : ""
                    }`}
                    style={{ animationDelay: `${0.08 * idx}s` }}
                  >
                    <div className="meet-card__top">
                      <span className="meet-card__stamp">
                        {meet.mode === "all-day" ? "Days" : "Time grid"}
                        {span ? ` · ${span}` : ""}
                      </span>
                      {statusPill(meet)}
                    </div>
                    <h3 className="meet-card__title">{meet.title}</h3>
                    <div className="meet-card__foot">
                      <span className="meet-card__role">
                        {meet.role === "organizer"
                          ? "You organize"
                          : "You responded"}
                      </span>
                      <span className="meet-card__open">Open →</span>
                    </div>
                    <span className="meet-card__stripe" aria-hidden="true" />
                  </Link>
                );
              })}
            </div>
          )}
        </section>

        {/* ASIDE — create */}
        <aside className="meet-aside ov-rise ov-rise-3">
          <div className="meet-aside__head">
            <h2 className="meet-aside__title">
              Open a <em>new meet.</em>
            </h2>
            <p className="meet-aside__sub">
              Offer the days, set the window, share one link.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="meet-form">
            <div className="input-group">
              <label htmlFor="meet-title">Title</label>
              <input
                id="meet-title"
                value={form.title}
                maxLength={200}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, title: e.target.value }))
                }
                placeholder="Band practice, next week"
              />
            </div>

            <div className="input-group">
              <label>Kind of answer</label>
              <div className="meet-seg" role="group" aria-label="Meet mode">
                <button
                  type="button"
                  className={
                    form.mode === "time-grid" ? "meet-seg__btn meet-seg__btn--on" : "meet-seg__btn"
                  }
                  onClick={() =>
                    setForm((prev) => ({ ...prev, mode: "time-grid" }))
                  }
                >
                  Hours in a day
                </button>
                <button
                  type="button"
                  className={
                    form.mode === "all-day" ? "meet-seg__btn meet-seg__btn--on" : "meet-seg__btn"
                  }
                  onClick={() =>
                    setForm((prev) => ({ ...prev, mode: "all-day" }))
                  }
                >
                  Whole days
                </button>
              </div>
            </div>

            <div className="input-group">
              <label>Candidate days</label>
              <MeetDatePicker selected={form.dates} onToggle={toggleDate} />
            </div>

            {form.mode === "time-grid" && (
              <>
                <div className="input-group">
                  <label>Daily window</label>
                  <div className="input-row">
                    <select
                      aria-label="Window start"
                      value={form.startHour}
                      onChange={(e) =>
                        setForm((prev) => ({
                          ...prev,
                          startHour: Number(e.target.value)
                        }))
                      }
                    >
                      {Array.from({ length: 24 }, (_, h) => (
                        <option key={h} value={h}>
                          {formatMinute(h * 60)}
                        </option>
                      ))}
                    </select>
                    <select
                      aria-label="Window end"
                      value={form.endHour}
                      onChange={(e) =>
                        setForm((prev) => ({
                          ...prev,
                          endHour: Number(e.target.value)
                        }))
                      }
                    >
                      {Array.from({ length: 24 }, (_, i) => i + 1).map((h) => (
                        <option key={h} value={h}>
                          {h === 24 ? "midnight" : formatMinute(h * 60)}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="input-group">
                  <label htmlFor="meet-slot">Slot size</label>
                  <select
                    id="meet-slot"
                    value={form.slotMinutes}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        slotMinutes: Number(e.target.value)
                      }))
                    }
                  >
                    <option value={15}>15 minutes</option>
                    <option value={30}>30 minutes</option>
                    <option value={60}>1 hour</option>
                  </select>
                </div>
              </>
            )}

            <div className="input-group">
              <label htmlFor="meet-tz">Timezone</label>
              <select
                id="meet-tz"
                value={form.timezone}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, timezone: e.target.value }))
                }
              >
                {zones.map((zone) => (
                  <option key={zone} value={zone}>
                    {zone.replace(/_/g, " ")}
                  </option>
                ))}
              </select>
            </div>

            <label className="meet-check">
              <input
                type="checkbox"
                checked={form.allowIfNeedBe}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    allowIfNeedBe: e.target.checked
                  }))
                }
              />
              <span>
                Allow &ldquo;if need be&rdquo; answers
                <span className="meet-check__hint">
                  A softer yes — counts for half in the rankings.
                </span>
              </span>
            </label>

            {error && <p className="meet-form__error">{error}</p>}

            <button
              type="submit"
              className="primary meet-form__submit"
              disabled={createMutation.isPending}
            >
              {createMutation.isPending ? "Opening…" : "Open this meet →"}
            </button>
          </form>
        </aside>
      </div>
    </div>
  );
};

export default MeetListPage;
