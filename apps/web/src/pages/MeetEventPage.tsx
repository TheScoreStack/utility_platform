// Stack Meet — event workspace for signed-in users. Paint your own
// availability, flip to the group heat, and (as organizer) finalize a
// window, edit details, or delete the meet. All times are wall-clock in
// the event's timezone; strokes autosave after a short pause.

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router-dom";
import { buildMeetHeatmap } from "@utility-platform/shared";
import { ApiError } from "../lib/api";
import { meetApi } from "../lib/meetApi";
import type { UpdateMeetEventInput } from "../lib/meetApi";
import type {
  MeetAvailability,
  MeetAvailabilityLevel,
  MeetEventDetailResponse,
  MeetSuggestion
} from "../types";
import {
  browserTimezone,
  formatMeetDateFull,
  formatMeetDateSpan,
  formatMeetSlot,
  formatMinute,
  formatMinuteRange
} from "../lib/meetFormat";
import MeetAvailabilityGrid from "../components/meet/MeetAvailabilityGrid";
import type { MeetGridSlot } from "../components/meet/MeetAvailabilityGrid";
import { useConfirm } from "../components/ConfirmDialog";
import { getInitials, seedAvatar } from "../lib/avatarPalette";

interface EditFormState {
  title: string;
  description: string;
  quorum: string;
  allowIfNeedBe: boolean;
  locked: boolean;
}

const MeetEventPage = () => {
  const { eventId = "" } = useParams();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const confirm = useConfirm();

  const queryKey = useMemo(() => ["meet", "event", eventId], [eventId]);
  const { data, isLoading, error } = useQuery({
    queryKey,
    queryFn: () => meetApi.detail(eventId),
    enabled: Boolean(eventId),
    // Version-based GET is cheap; react-query pauses the interval while the
    // tab is in the background, so this only polls when someone is looking.
    // Refetched data never clobbers unsaved paint — the draft-adoption
    // effect below skips while dirty or saving.
    refetchInterval: 5000
  });

  const event = data?.event;
  const participants = useMemo(
    () => data?.participants ?? [],
    [data?.participants]
  );
  // The API includes userId only on the caller's own row.
  const me = useMemo(
    () => participants.find((p) => Boolean(p.userId)),
    [participants]
  );
  const isOrganizer = me?.role === "organizer";
  const finalized = event?.status === "finalized";
  const allowIfNeedBe = event?.settings?.allowIfNeedBe !== false;

  // ---------------------------------------------------- paint + autosave
  const [draft, setDraft] = useState<MeetAvailability | null>(null);
  const [dirty, setDirty] = useState(false);
  const [savedOnce, setSavedOnce] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [paintLevel, setPaintLevel] = useState<MeetAvailabilityLevel>(2);
  const [view, setView] = useState<"paint" | "heat">("paint");
  const [selectedSlot, setSelectedSlot] = useState<MeetGridSlot | null>(null);
  const [copied, setCopied] = useState(false);
  const shareInputRef = useRef<HTMLInputElement>(null);

  const saveMutation = useMutation({
    mutationFn: (availability: MeetAvailability) =>
      meetApi.saveAvailability(eventId, {
        availability,
        timezone: browserTimezone()
      }),
    onSuccess: ({ participant }) => {
      setSavedOnce(true);
      setSaveError(null);
      queryClient.setQueryData<MeetEventDetailResponse>(queryKey, (old) =>
        old
          ? {
              ...old,
              participants: old.participants.some(
                (p) => p.participantId === participant.participantId
              )
                ? old.participants.map((p) =>
                    p.participantId === participant.participantId
                      ? participant
                      : p
                  )
                : [...old.participants, participant]
            }
          : old
      );
      // Suggestions are server-computed — refresh them.
      queryClient.invalidateQueries({ queryKey });
    },
    onError: (err: unknown) => {
      // Keep the strokes marked dirty so the debounce loop retries and the
      // pill never claims "Saved" for a PUT that failed.
      setDirty(true);
      setSaveError(
        err instanceof ApiError
          ? err.message
          : "Could not save your availability — retrying."
      );
    }
  });
  const { mutate: saveAvailability, isPending: savePending } = saveMutation;

  // Adopt the server copy whenever we have no unsaved strokes in flight.
  useEffect(() => {
    if (data && !dirty && !savePending) {
      setDraft(me?.availability ?? {});
    }
  }, [data, me, dirty, savePending]);

  // Debounced autosave: a pause of 900ms after the last stroke commits it.
  useEffect(() => {
    if (!dirty || draft === null) return;
    const timer = setTimeout(() => {
      setDirty(false);
      saveAvailability(draft);
    }, 900);
    return () => clearTimeout(timer);
  }, [dirty, draft, saveAvailability]);

  // A debounced save still pending when the page unmounts must not be
  // dropped — flush it in the cleanup. (Mutations outlive the component.)
  const draftRef = useRef(draft);
  const dirtyRef = useRef(dirty);
  useEffect(() => {
    draftRef.current = draft;
    dirtyRef.current = dirty;
  });
  useEffect(
    () => () => {
      if (dirtyRef.current && draftRef.current !== null) {
        saveAvailability(draftRef.current);
      }
    },
    [saveAvailability]
  );

  // Warn before the tab closes while strokes are unsaved or in flight.
  useEffect(() => {
    if (!dirty && !savePending) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty, savePending]);

  useEffect(() => {
    if (finalized) setView("heat");
  }, [finalized]);

  // -------------------------------------------------------- group heat
  const heatParticipants = useMemo(() => {
    if (!me || draft === null) return participants;
    return participants.map((p) =>
      p.participantId === me.participantId ? { ...p, availability: draft } : p
    );
  }, [participants, me, draft]);

  const heatmap = useMemo(
    () => (event ? buildMeetHeatmap(event, heatParticipants) : undefined),
    [event, heatParticipants]
  );

  const nameOf = useMemo(() => {
    const map = new Map(
      participants.map((p) => [p.participantId, p.displayName])
    );
    return (id: string) => map.get(id) ?? "Someone";
  }, [participants]);

  // ------------------------------------------------- organizer actions
  const [editOpen, setEditOpen] = useState(false);
  const [editForm, setEditForm] = useState<EditFormState | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const patchMutation = useMutation({
    mutationFn: (input: UpdateMeetEventInput) => meetApi.update(eventId, input),
    onSuccess: () => {
      setEditOpen(false);
      queryClient.invalidateQueries({ queryKey });
      queryClient.invalidateQueries({ queryKey: ["meet", "events"] });
    },
    onError: (err: unknown) =>
      setActionError(
        err instanceof ApiError ? err.message : "Failed to save changes"
      )
  });

  const finalizeMutation = useMutation({
    mutationFn: (slot: { date: string; startMinute: number; endMinute: number }) =>
      meetApi.finalize(eventId, slot),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      queryClient.invalidateQueries({ queryKey: ["meet", "events"] });
    },
    onError: (err: unknown) =>
      setActionError(
        err instanceof ApiError ? err.message : "Failed to finalize"
      )
  });

  const reopenMutation = useMutation({
    mutationFn: () => meetApi.reopen(eventId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      queryClient.invalidateQueries({ queryKey: ["meet", "events"] });
    },
    onError: (err: unknown) =>
      setActionError(
        err instanceof ApiError ? err.message : "Failed to reopen"
      )
  });

  const deleteMutation = useMutation({
    mutationFn: () => meetApi.remove(eventId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["meet", "events"] });
      navigate("/meet");
    },
    onError: (err: unknown) =>
      setActionError(
        err instanceof ApiError ? err.message : "Failed to delete"
      )
  });

  // Custom finalize window (organizer, time-grid)
  const [customDate, setCustomDate] = useState("");
  const [customStart, setCustomStart] = useState(-1);
  const [customEnd, setCustomEnd] = useState(-1);

  const openEdit = () => {
    if (!event) return;
    setEditForm({
      title: event.title,
      description: event.description ?? "",
      quorum: event.settings?.quorum ? String(event.settings.quorum) : "",
      allowIfNeedBe: event.settings?.allowIfNeedBe !== false,
      locked: event.settings?.locked === true
    });
    setActionError(null);
    setEditOpen(true);
  };

  const submitEdit = (e: FormEvent) => {
    e.preventDefault();
    if (!editForm || !event) return;
    const quorum = editForm.quorum.trim()
      ? Math.max(0, Number(editForm.quorum))
      : undefined;
    patchMutation.mutate({
      title: editForm.title.trim() || event.title,
      description: editForm.description.trim() || undefined,
      settings: {
        ...event.settings,
        allowIfNeedBe: editForm.allowIfNeedBe,
        locked: editForm.locked,
        quorum: quorum && !Number.isNaN(quorum) ? quorum : undefined
      }
    });
  };

  const handleDelete = async () => {
    if (!event) return;
    const ok = await confirm({
      title: "Delete this meet?",
      body: `“${event.title}” and every response will be removed. The share link stops working immediately.`,
      confirmLabel: "Delete meet",
      tone: "danger"
    });
    if (ok) deleteMutation.mutate();
  };

  const submitCustomFinalize = () => {
    if (!event) return;
    if (event.mode === "all-day") {
      if (!customDate) return;
      finalizeMutation.mutate({
        date: customDate,
        startMinute: 0,
        endMinute: 1440
      });
      return;
    }
    if (!customDate || customStart < 0 || customEnd <= customStart) {
      setActionError("Pick a date and a valid window to finalize");
      return;
    }
    finalizeMutation.mutate({
      date: customDate,
      startMinute: customStart,
      endMinute: customEnd
    });
  };

  const copyShareLink = async () => {
    if (!event) return;
    const url = `${window.location.origin}/m/${event.slug}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      shareInputRef.current?.select();
    }
  };

  // ------------------------------------------------------------ render
  if (isLoading) {
    return (
      <div className="meet-page">
        <section className="meet-hero">
          <span className="skel skel--text" style={{ width: "6rem" }}>
            &nbsp;
          </span>
          <span className="skel skel--title" style={{ width: "50%" }}>
            &nbsp;
          </span>
        </section>
      </div>
    );
  }

  if (error || !event) {
    return (
      <div className="meet-page">
        <div className="empty-state">
          <p className="empty-state__title">This meet could not be loaded.</p>
          <p className="empty-state__hint">
            {error instanceof ApiError ? error.message : "Try again shortly."}
          </p>
          <Link to="/meet" className="meet-backlink">
            ← Back to your meets
          </Link>
        </div>
      </div>
    );
  }

  const shareUrl = `${window.location.origin}/m/${event.slug}`;
  const suggestions = data?.suggestions ?? [];
  const respondedCount = participants.filter((p) => p.respondedAt).length;
  const slotDetail =
    selectedSlot && heatmap ? heatmap.tally[selectedSlot.date] : undefined;
  const timeGridStarts: number[] = [];
  if (event.mode === "time-grid") {
    for (let m = event.startMinute; m < event.endMinute; m += event.slotMinutes) {
      timeGridStarts.push(m);
    }
  }

  const suggestionRow = (s: MeetSuggestion, idx: number) => (
    <div key={`${s.date}-${s.startMinute}-${idx}`} className="meet-suggest">
      <span className="meet-suggest__rank">{idx + 1}</span>
      <div className="meet-suggest__body">
        <span className="meet-suggest__when">
          {formatMeetSlot(s, event.mode)}
        </span>
        <span className="meet-suggest__who">
          {s.availableIds.length} available
          {s.ifNeedBeIds.length > 0 && ` · ${s.ifNeedBeIds.length} if need be`}
          {s.meetsQuorum && " · quorum met"}
        </span>
        <span className="meet-suggest__names muted">
          {[...s.availableIds, ...s.ifNeedBeIds]
            .map(nameOf)
            .slice(0, 6)
            .join(", ")}
          {s.availableIds.length + s.ifNeedBeIds.length > 6 && "…"}
        </span>
      </div>
      {isOrganizer && !finalized && (
        <button
          type="button"
          className="secondary meet-suggest__pick"
          disabled={finalizeMutation.isPending}
          onClick={() =>
            finalizeMutation.mutate({
              date: s.date,
              startMinute: s.startMinute,
              endMinute: s.endMinute
            })
          }
        >
          Finalize
        </button>
      )}
    </div>
  );

  return (
    <div className="meet-page">
      {/* HEADER */}
      <section className="meet-detail-head ov-rise ov-rise-1">
        <div className="meet-detail-head__top">
          <Link to="/meet" className="meet-backlink">
            ← All meets
          </Link>
          <div className="meet-detail-head__pills">
            {event.settings?.locked && (
              <span
                className="meet-pill meet-pill--locked"
                title="New people cannot join"
              >
                Locked
              </span>
            )}
            {finalized ? (
              <span className="meet-pill meet-pill--finalized">Finalized</span>
            ) : (
              <span className="meet-pill meet-pill--open">
                <span className="meet-pill__dot" aria-hidden="true" />
                Collecting times
              </span>
            )}
          </div>
        </div>
        <h1 className="meet-detail-head__title">{event.title}</h1>
        {event.description && (
          <p className="meet-detail-head__desc">{event.description}</p>
        )}
        <div className="meet-detail-head__meta">
          <span>
            {event.dates.length} {event.dates.length === 1 ? "day" : "days"}
            {" · "}
            {formatMeetDateSpan(event.dates[0], event.dates[event.dates.length - 1])}
          </span>
          {event.mode === "time-grid" && (
            <span>{formatMinuteRange(event.startMinute, event.endMinute)}</span>
          )}
          <span className="meet-tz">Times in {event.timezone.replace(/_/g, " ")}</span>
          <span>
            {respondedCount}/{participants.length} responded
          </span>
          {typeof event.settings?.quorum === "number" &&
            event.settings.quorum > 0 && (
              <span>Quorum: {event.settings.quorum}</span>
            )}
        </div>
        {isOrganizer && (
          <div className="meet-detail-head__actions">
            <button type="button" className="ghost" onClick={openEdit}>
              Edit details
            </button>
            {finalized && (
              <button
                type="button"
                className="ghost"
                disabled={reopenMutation.isPending}
                onClick={() => reopenMutation.mutate()}
              >
                Reopen voting
              </button>
            )}
            <button
              type="button"
              className="ghost meet-danger"
              disabled={deleteMutation.isPending}
              onClick={handleDelete}
            >
              Delete
            </button>
          </div>
        )}
        {actionError && <p className="meet-form__error">{actionError}</p>}
      </section>

      {/* FINALIZED BANNER */}
      {finalized && event.finalizedSlot && (
        <section className="meet-final ov-rise ov-rise-1">
          <span className="meet-final__eyebrow">It is settled</span>
          <p className="meet-final__when">
            {formatMeetDateFull(event.finalizedSlot.date)}
            {event.mode === "time-grid" &&
              !(
                event.finalizedSlot.startMinute === 0 &&
                event.finalizedSlot.endMinute === 1440
              ) && (
                <>
                  {" · "}
                  {formatMinuteRange(
                    event.finalizedSlot.startMinute,
                    event.finalizedSlot.endMinute
                  )}
                </>
              )}
          </p>
          <p className="meet-final__tz">{event.timezone.replace(/_/g, " ")}</p>
        </section>
      )}

      {/* EDIT PANEL */}
      {editOpen && editForm && (
        <section className="meet-panel ov-rise ov-rise-1">
          <form onSubmit={submitEdit} className="meet-form">
            <div className="meet-section-head">
              <h2 className="meet-section-head__title">Edit details</h2>
            </div>
            <div className="input-group">
              <label htmlFor="meet-edit-title">Title</label>
              <input
                id="meet-edit-title"
                value={editForm.title}
                maxLength={200}
                onChange={(e) =>
                  setEditForm((prev) =>
                    prev ? { ...prev, title: e.target.value } : prev
                  )
                }
              />
            </div>
            <div className="input-group">
              <label htmlFor="meet-edit-desc">Description</label>
              <textarea
                id="meet-edit-desc"
                rows={3}
                value={editForm.description}
                onChange={(e) =>
                  setEditForm((prev) =>
                    prev ? { ...prev, description: e.target.value } : prev
                  )
                }
              />
            </div>
            <div className="input-group">
              <label htmlFor="meet-edit-quorum">
                Quorum{" "}
                <span className="muted" style={{ fontWeight: 400 }}>
                  · optional headcount target
                </span>
              </label>
              <input
                id="meet-edit-quorum"
                type="number"
                min={0}
                value={editForm.quorum}
                onChange={(e) =>
                  setEditForm((prev) =>
                    prev ? { ...prev, quorum: e.target.value } : prev
                  )
                }
              />
            </div>
            <label className="meet-check">
              <input
                type="checkbox"
                checked={editForm.allowIfNeedBe}
                onChange={(e) =>
                  setEditForm((prev) =>
                    prev ? { ...prev, allowIfNeedBe: e.target.checked } : prev
                  )
                }
              />
              <span>Allow &ldquo;if need be&rdquo; answers</span>
            </label>
            <label className="meet-check">
              <input
                type="checkbox"
                checked={editForm.locked}
                onChange={(e) =>
                  setEditForm((prev) =>
                    prev ? { ...prev, locked: e.target.checked } : prev
                  )
                }
              />
              <span>
                Lock joining
                <span className="meet-check__hint">
                  Existing people can still edit; new people cannot join.
                </span>
              </span>
            </label>
            <div className="input-row">
              <button
                type="submit"
                className="primary"
                disabled={patchMutation.isPending}
              >
                {patchMutation.isPending ? "Saving…" : "Save changes"}
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => setEditOpen(false)}
              >
                Cancel
              </button>
            </div>
          </form>
        </section>
      )}

      <div className="meet-columns meet-columns--detail">
        {/* MAIN — grid */}
        <section className="meet-main ov-rise ov-rise-2">
          <div className="meet-gridcard">
            <div className="meet-gridcard__bar">
              <div className="meet-seg" role="group" aria-label="Grid view">
                <button
                  type="button"
                  className={
                    view === "paint"
                      ? "meet-seg__btn meet-seg__btn--on"
                      : "meet-seg__btn"
                  }
                  onClick={() => setView("paint")}
                >
                  Your availability
                </button>
                <button
                  type="button"
                  className={
                    view === "heat"
                      ? "meet-seg__btn meet-seg__btn--on"
                      : "meet-seg__btn"
                  }
                  onClick={() => setView("heat")}
                >
                  Group heat
                </button>
              </div>
              {view === "paint" ? (
                <div className="meet-gridcard__tools">
                  {allowIfNeedBe && (
                    <div
                      className="meet-brush"
                      role="group"
                      aria-label="Brush level"
                    >
                      <button
                        type="button"
                        className={`meet-brush__btn meet-brush__btn--yes ${
                          paintLevel === 2 ? "meet-brush__btn--on" : ""
                        }`}
                        onClick={() => setPaintLevel(2)}
                      >
                        Available
                      </button>
                      <button
                        type="button"
                        className={`meet-brush__btn meet-brush__btn--inb ${
                          paintLevel === 1 ? "meet-brush__btn--on" : ""
                        }`}
                        onClick={() => setPaintLevel(1)}
                      >
                        If need be
                      </button>
                    </div>
                  )}
                  <span
                    className={`meet-savestate ${
                      saveError && !savePending ? "meet-savestate--error" : ""
                    }`}
                    aria-live="polite"
                  >
                    {savePending
                      ? "Saving…"
                      : saveError
                        ? "Save failed"
                        : dirty
                          ? "Unsaved strokes"
                          : savedOnce || me?.respondedAt
                            ? "Saved"
                            : ""}
                  </span>
                </div>
              ) : (
                <div className="meet-legend" aria-hidden="true">
                  <span className="meet-legend__swatch meet-legend__swatch--low" />
                  <span className="meet-legend__label">few</span>
                  <span className="meet-legend__swatch meet-legend__swatch--high" />
                  <span className="meet-legend__label">everyone</span>
                  <span className="meet-legend__swatch meet-legend__swatch--inb" />
                  <span className="meet-legend__label">if need be</span>
                </div>
              )}
            </div>

            {view === "paint" && saveError && (
              <p className="meet-form__error" role="alert">
                {saveError}
              </p>
            )}

            {view === "paint" && finalized && (
              <p className="meet-gridcard__note muted">
                This meet is finalized — the grid is read-only until the
                organizer reopens it.
              </p>
            )}
            {view === "paint" && !finalized && (
              <p className="meet-gridcard__note muted">
                Drag across the grid to paint when you can make it. Paint the
                same cells again to clear them.
              </p>
            )}

            {view === "paint" ? (
              <MeetAvailabilityGrid
                event={event}
                variant="paint"
                availability={draft ?? {}}
                paintLevel={paintLevel}
                disabled={finalized}
                finalizedSlot={event.finalizedSlot}
                onChange={(next) => {
                  setDraft(next);
                  setDirty(true);
                }}
              />
            ) : (
              <>
                <MeetAvailabilityGrid
                  event={event}
                  variant="heat"
                  heatmap={heatmap}
                  selectedSlot={selectedSlot}
                  onSelectSlot={setSelectedSlot}
                  finalizedSlot={event.finalizedSlot}
                />
                <div className="meet-slotinfo" aria-live="polite">
                  {selectedSlot && slotDetail ? (
                    <>
                      <span className="meet-slotinfo__when">
                        {formatMeetSlot(
                          event.mode === "all-day"
                            ? {
                                date: selectedSlot.date,
                                startMinute: 0,
                                endMinute: 1440
                              }
                            : {
                                date: selectedSlot.date,
                                startMinute:
                                  event.startMinute +
                                  selectedSlot.slotIndex * event.slotMinutes,
                                endMinute:
                                  event.startMinute +
                                  (selectedSlot.slotIndex + 1) *
                                    event.slotMinutes
                              },
                          event.mode
                        )}
                      </span>
                      <span className="meet-slotinfo__names">
                        {(slotDetail.available[selectedSlot.slotIndex] ?? [])
                          .length === 0 &&
                        (slotDetail.ifNeedBe[selectedSlot.slotIndex] ?? [])
                          .length === 0 ? (
                          <span className="muted">No one yet.</span>
                        ) : (
                          <>
                            {(
                              slotDetail.available[selectedSlot.slotIndex] ?? []
                            ).map((id) => (
                              <span
                                key={id}
                                className="meet-namechip meet-namechip--yes"
                              >
                                {nameOf(id)}
                              </span>
                            ))}
                            {(
                              slotDetail.ifNeedBe[selectedSlot.slotIndex] ?? []
                            ).map((id) => (
                              <span
                                key={id}
                                className="meet-namechip meet-namechip--inb"
                              >
                                {nameOf(id)} · if need be
                              </span>
                            ))}
                          </>
                        )}
                      </span>
                    </>
                  ) : (
                    <span className="muted">
                      Tap or hover a cell to see who can make it.
                    </span>
                  )}
                </div>
              </>
            )}
          </div>
        </section>

        {/* ASIDE — share, suggestions, people */}
        <aside className="meet-aside ov-rise ov-rise-3">
          <div className="meet-panel">
            <div className="meet-section-head">
              <h2 className="meet-section-head__title">Share the link</h2>
            </div>
            <p className="muted meet-panel__hint">
              Anyone with the link can answer — no account needed.
            </p>
            <div className="meet-share">
              <input
                ref={shareInputRef}
                readOnly
                value={shareUrl}
                onFocus={(e) => e.currentTarget.select()}
                aria-label="Share link"
              />
              <button type="button" className="secondary" onClick={copyShareLink}>
                {copied ? "Copied ✓" : "Copy"}
              </button>
            </div>
          </div>

          <div className="meet-panel">
            <div className="meet-section-head">
              <h2 className="meet-section-head__title">Best times</h2>
              <span className="meet-section-head__count">Top 3</span>
            </div>
            {suggestions.length === 0 ? (
              <p className="muted meet-panel__hint">
                No overlap yet — suggestions appear once people respond.
              </p>
            ) : (
              <div className="meet-suggest-list">
                {suggestions.map(suggestionRow)}
              </div>
            )}

            {isOrganizer && !finalized && (
              <div className="meet-custom">
                <p className="meet-custom__label">
                  …or finalize a custom window
                </p>
                <div className="input-row">
                  <select
                    aria-label="Finalize date"
                    value={customDate}
                    onChange={(e) => setCustomDate(e.target.value)}
                  >
                    <option value="">Pick a day</option>
                    {event.dates.map((d) => (
                      <option key={d} value={d}>
                        {formatMeetDateFull(d)}
                      </option>
                    ))}
                  </select>
                </div>
                {event.mode === "time-grid" && (
                  <div className="input-row">
                    <select
                      aria-label="Finalize start"
                      value={customStart}
                      onChange={(e) => setCustomStart(Number(e.target.value))}
                    >
                      <option value={-1}>From</option>
                      {timeGridStarts.map((m) => (
                        <option key={m} value={m}>
                          {formatMinute(m)}
                        </option>
                      ))}
                    </select>
                    <select
                      aria-label="Finalize end"
                      value={customEnd}
                      onChange={(e) => setCustomEnd(Number(e.target.value))}
                    >
                      <option value={-1}>Until</option>
                      {timeGridStarts
                        .map((m) => m + event.slotMinutes)
                        .filter((m) => customStart < 0 || m > customStart)
                        .map((m) => (
                          <option key={m} value={m}>
                            {formatMinute(m)}
                          </option>
                        ))}
                    </select>
                  </div>
                )}
                <button
                  type="button"
                  className="secondary"
                  disabled={finalizeMutation.isPending}
                  onClick={submitCustomFinalize}
                >
                  {finalizeMutation.isPending ? "Finalizing…" : "Finalize this window"}
                </button>
              </div>
            )}
          </div>

          <div className="meet-panel">
            <div className="meet-section-head">
              <h2 className="meet-section-head__title">Who&rsquo;s in</h2>
              <span className="meet-section-head__count">
                {participants.length}
              </span>
            </div>
            <div className="meet-people">
              {participants.map((p) => {
                const palette = seedAvatar(p.participantId);
                return (
                  <span
                    key={p.participantId}
                    className={`meet-person ${
                      p.respondedAt ? "" : "meet-person--waiting"
                    }`}
                    title={p.respondedAt ? "Responded" : "No answer yet"}
                  >
                    <span
                      className="meet-person__avatar"
                      style={{ background: palette.bg, color: palette.fg }}
                      aria-hidden="true"
                    >
                      {getInitials(p.displayName)}
                    </span>
                    {p.displayName}
                    {p.role === "organizer" && (
                      <span className="meet-person__role">organizer</span>
                    )}
                  </span>
                );
              })}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
};

export default MeetEventPage;
