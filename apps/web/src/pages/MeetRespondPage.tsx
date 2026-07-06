// Public respond page for Stack Meet — served at /m/<slug> OUTSIDE the
// Authenticator and outside React Router, so it uses window.location for
// the slug and plain fetch (no Amplify session). Guests join with just a
// name; the {participantId, secret} pair comes back once and is kept in
// localStorage keyed by slug so returning visitors resume their row.
// The page polls GET ?since=<version> every 5s while visible.

import { FormEvent, ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildMeetHeatmap } from "@utility-platform/shared";
import { ApiError } from "../lib/api";
import {
  clearMeetGuest,
  loadMeetGuest,
  meetPublicApi,
  saveMeetGuest
} from "../lib/meetApi";
import type { MeetGuestIdentity } from "../lib/meetApi";
import type {
  MeetAvailability,
  MeetAvailabilityLevel,
  MeetPublicSnapshot
} from "../types";
import {
  browserTimezone,
  formatMeetDateFull,
  formatMeetDateSpan,
  formatMeetSlot,
  formatMinuteRange
} from "../lib/meetFormat";
import MeetAvailabilityGrid from "../components/meet/MeetAvailabilityGrid";
import type { MeetGridSlot } from "../components/meet/MeetAvailabilityGrid";
import { getInitials, seedAvatar } from "../lib/avatarPalette";

const slugFromPath = (): string => {
  const parts = window.location.pathname.split("/");
  return parts[1] === "m" && parts[2] ? parts[2] : "";
};

const MeetRespondPage = () => {
  const slug = useMemo(slugFromPath, []);
  const [snapshot, setSnapshot] = useState<MeetPublicSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [identity, setIdentity] = useState<MeetGuestIdentity | null>(() =>
    slug ? loadMeetGuest(slug) : null
  );

  const [draft, setDraft] = useState<MeetAvailability | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedOnce, setSavedOnce] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [paintLevel, setPaintLevel] = useState<MeetAvailabilityLevel>(2);
  const [selectedSlot, setSelectedSlot] = useState<MeetGridSlot | null>(null);

  const [joinName, setJoinName] = useState("");
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);

  const versionRef = useRef<number | null>(null);
  const identityRef = useRef(identity);
  identityRef.current = identity;

  const adoptSnapshot = useCallback(
    (snap: MeetPublicSnapshot, isInitial: boolean) => {
      versionRef.current = snap.version;
      setSnapshot(snap);
      // Stored credentials for a row the organizer has since removed are
      // useless — but only conclude that on the initial, authoritative load
      // (polls can race a just-completed join).
      if (isInitial && identityRef.current) {
        const mine = snap.participants.some(
          (p) => p.participantId === identityRef.current?.participantId
        );
        if (!mine) {
          clearMeetGuest(slugFromPath());
          setIdentity(null);
        }
      }
    },
    []
  );

  // Initial load.
  useEffect(() => {
    if (!slug) {
      setLoading(false);
      setLoadError("This link is missing its code.");
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const snap = await meetPublicApi.get(slug);
        if (!cancelled) adoptSnapshot(snap, true);
      } catch (err) {
        if (!cancelled) {
          setLoadError(
            err instanceof ApiError && err.status === 404
              ? "This meet does not exist — the link may have been deleted."
              : "Could not load this meet. Check your connection and refresh."
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slug, adoptSnapshot]);

  // Poll every 5s while the tab is visible; catch up the moment it returns.
  useEffect(() => {
    if (!slug) return;
    let cancelled = false;
    const tick = async () => {
      if (document.hidden || versionRef.current === null) return;
      try {
        const res = await meetPublicApi.poll(slug, versionRef.current);
        if (cancelled || res.unchanged) return;
        if (res.event && res.participants && res.suggestions) {
          adoptSnapshot(res as MeetPublicSnapshot, false);
        }
      } catch {
        // Transient poll failures are fine — the next tick retries.
      }
    };
    const interval = setInterval(tick, 5000);
    const onVisibility = () => {
      if (!document.hidden) void tick();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [slug, adoptSnapshot]);

  // Adopt my server row into the paint draft whenever nothing is unsaved.
  useEffect(() => {
    if (!snapshot || dirty || saving) return;
    if (!identity) {
      setDraft(null);
      return;
    }
    const mine = snapshot.participants.find(
      (p) => p.participantId === identity.participantId
    );
    if (mine) setDraft(mine.availability);
  }, [snapshot, identity, dirty, saving]);

  // Debounced autosave of paint strokes (guest-secret header).
  useEffect(() => {
    if (!dirty || !identity || draft === null) return;
    const timer = setTimeout(async () => {
      setDirty(false);
      setSaving(true);
      try {
        const { participant } = await meetPublicApi.saveAvailability(
          slug,
          identity.participantId,
          identity.secret,
          { availability: draft, timezone: browserTimezone() }
        );
        setSavedOnce(true);
        setSaveError(null);
        setSnapshot((prev) =>
          prev
            ? {
                ...prev,
                participants: prev.participants.map((p) =>
                  p.participantId === participant.participantId
                    ? participant
                    : p
                )
              }
            : prev
        );
      } catch (err) {
        if (
          err instanceof ApiError &&
          (err.status === 403 || err.status === 404)
        ) {
          // Revoked secret or a removed participant row — either way this
          // browser's pass is dead and retrying would loop forever.
          clearMeetGuest(slug);
          setIdentity(null);
          setSaveError(
            "This browser's saved pass no longer matches — join again to keep answering."
          );
        } else {
          // Keep the strokes dirty so the debounce loop retries by itself
          // and the pill never claims "Saved" for a PUT that failed.
          setDirty(true);
          setSaveError(
            err instanceof ApiError
              ? err.message
              : "Could not save your answer — retrying."
          );
        }
      } finally {
        setSaving(false);
      }
    }, 900);
    return () => clearTimeout(timer);
  }, [dirty, draft, identity, slug]);

  // A debounced save still pending when this page unmounts must not be
  // dropped — fire it (best effort) from the cleanup.
  const draftRef = useRef(draft);
  const dirtyRef = useRef(dirty);
  useEffect(() => {
    draftRef.current = draft;
    dirtyRef.current = dirty;
  });
  useEffect(
    () => () => {
      const id = identityRef.current;
      if (dirtyRef.current && id && draftRef.current) {
        void meetPublicApi
          .saveAvailability(slug, id.participantId, id.secret, {
            availability: draftRef.current,
            timezone: browserTimezone()
          })
          .catch(() => {
            // Best effort — the page is going away.
          });
      }
    },
    [slug]
  );

  // Warn before the tab closes while strokes are unsaved or in flight.
  useEffect(() => {
    if (!dirty && !saving) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty, saving]);

  const handleJoin = async (e: FormEvent) => {
    e.preventDefault();
    const name = joinName.trim();
    if (!name) {
      setJoinError("Tell the group who you are");
      return;
    }
    setJoining(true);
    setJoinError(null);
    try {
      const { participant, secret } = await meetPublicApi.join(slug, {
        displayName: name,
        timezone: browserTimezone()
      });
      const next: MeetGuestIdentity = {
        participantId: participant.participantId,
        secret,
        displayName: participant.displayName
      };
      saveMeetGuest(slug, next);
      setIdentity(next);
      setDraft(participant.availability ?? {});
      setSnapshot((prev) =>
        prev
          ? { ...prev, participants: [...prev.participants, participant] }
          : prev
      );
    } catch (err) {
      setJoinError(
        err instanceof ApiError && err.status === 409
          ? "Joining is closed for this meet."
          : err instanceof ApiError
            ? err.message
            : "Could not join — try again."
      );
    } finally {
      setJoining(false);
    }
  };

  // ------------------------------------------------------ derived state
  const event = snapshot?.event;
  const finalized = event?.status === "finalized";
  const locked = event?.settings?.locked === true;
  const allowIfNeedBe = event?.settings?.allowIfNeedBe !== false;

  const heatParticipants = useMemo(() => {
    if (!snapshot) return [];
    if (!identity || draft === null) return snapshot.participants;
    return snapshot.participants.map((p) =>
      p.participantId === identity.participantId
        ? { ...p, availability: draft }
        : p
    );
  }, [snapshot, identity, draft]);

  const heatmap = useMemo(
    () => (event ? buildMeetHeatmap(event, heatParticipants) : undefined),
    [event, heatParticipants]
  );

  const nameOf = useMemo(() => {
    const map = new Map(
      (snapshot?.participants ?? []).map((p) => [p.participantId, p.displayName])
    );
    return (id: string) => map.get(id) ?? "Someone";
  }, [snapshot?.participants]);

  const browserTz = browserTimezone();
  const slotDetail =
    selectedSlot && heatmap ? heatmap.tally[selectedSlot.date] : undefined;
  const respondedCount = (snapshot?.participants ?? []).filter(
    (p) => p.respondedAt
  ).length;

  // ------------------------------------------------------------- render
  const chrome = (children: ReactNode) => (
    <div className="pub-shell">
      <div className="pub-inner meet-pub__inner pub-header">
        <a href="/about" style={{ textDecoration: "none" }}>
          <span className="shell-wordmark">
            <span className="shell-wordmark__the">The</span>
            <span className="shell-wordmark__stack">Stack</span>
            <span className="shell-wordmark__core">Core</span>
          </span>
        </a>
        <nav className="pub-nav" aria-label="App">
          <a href={slug ? `/meet/join/${slug}` : "/"}>Open the app</a>
        </nav>
      </div>
      <main className="pub-inner meet-pub__inner pub-main">{children}</main>
      <div className="pub-inner meet-pub__inner">
        <footer className="pub-footer">
          <span>© 2026 Hunter Adam</span>
          <span>
            Scheduling by <a href="/about">Stack Meet</a>
          </span>
        </footer>
      </div>
    </div>
  );

  if (loading) {
    return chrome(
      <div className="meet-pub__loading">
        <p className="pub-eyebrow">Stack Meet</p>
        <p className="pub-lede">Fetching the grid…</p>
      </div>
    );
  }

  if (loadError || !event || !snapshot) {
    return chrome(
      <div className="meet-pub__loading">
        <p className="pub-eyebrow">Stack Meet</p>
        <h1 className="pub-title">
          That link went <em>quiet.</em>
        </h1>
        <p className="pub-lede">{loadError ?? "Nothing to show here."}</p>
      </div>
    );
  }

  return chrome(
    <div className="meet-pub">
      <p className="pub-eyebrow">
        Stack Meet · {event.mode === "all-day" ? "pick days" : "pick times"}
      </p>
      <h1 className="pub-title meet-pub__title">{event.title}</h1>
      {event.description && <p className="pub-lede">{event.description}</p>}
      <div className="meet-detail-head__meta meet-pub__meta">
        <span>
          {event.dates.length} {event.dates.length === 1 ? "day" : "days"}
          {" · "}
          {formatMeetDateSpan(event.dates[0], event.dates[event.dates.length - 1])}
        </span>
        {event.mode === "time-grid" && (
          <span>{formatMinuteRange(event.startMinute, event.endMinute)}</span>
        )}
        <span className="meet-tz">
          All times in {event.timezone.replace(/_/g, " ")}
        </span>
        {browserTz !== event.timezone && (
          <span className="muted">
            (your clock is on {browserTz.replace(/_/g, " ")})
          </span>
        )}
      </div>

      {/* ROSTER — who's answered so far */}
      {snapshot.participants.length > 0 && (
        <section className="meet-pub__roster" aria-label="Participants">
          <span className="meet-pub__roster-count">
            {respondedCount} of {snapshot.participants.length} responded
          </span>
          <div className="meet-people">
            {snapshot.participants.map((p) => {
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
        </section>
      )}

      {/* FINALIZED — front and center */}
      {finalized && event.finalizedSlot && (
        <section className="meet-final meet-final--pub">
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
          <p className="meet-final__tz">
            {event.timezone.replace(/_/g, " ")} — see you there.
          </p>
        </section>
      )}

      {/* JOIN */}
      {!identity && !finalized && (
        <section className="meet-panel meet-pub__join">
          {locked ? (
            <p className="pub-lede">
              The organizer has closed this meet to new people.
            </p>
          ) : (
            <form onSubmit={handleJoin} className="meet-join">
              <div className="input-group meet-join__field">
                <label htmlFor="meet-join-name">Your name</label>
                <input
                  id="meet-join-name"
                  value={joinName}
                  maxLength={80}
                  placeholder="How the group knows you"
                  onChange={(e) => setJoinName(e.target.value)}
                />
              </div>
              <button type="submit" className="primary" disabled={joining}>
                {joining ? "Joining…" : "Join & paint your times →"}
              </button>
              {joinError && <p className="meet-form__error">{joinError}</p>}
            </form>
          )}
        </section>
      )}

      {slug && (
        <p className="meet-pub__applink">
          <a href={`/meet/join/${slug}`}>
            Have an account? Respond in the app →
          </a>
        </p>
      )}

      {saveError && (
        <p className="meet-form__error" role="alert">
          {saveError}
        </p>
      )}

      {/* GRIDS — yours + the group, side by side on wide screens */}
      <div
        className={`meet-pub__grids ${
          identity && !finalized ? "" : "meet-pub__grids--single"
        }`}
      >
        {identity && !finalized && (
          <section className="meet-gridcard">
            <div className="meet-gridcard__bar">
              <h2 className="meet-section-head__title">
                Your times, {identity.displayName || "friend"}
              </h2>
              <span
                className={`meet-savestate ${
                  saveError && !saving ? "meet-savestate--error" : ""
                }`}
                aria-live="polite"
              >
                {saving
                  ? "Saving…"
                  : saveError
                    ? "Save failed"
                    : dirty
                      ? "…"
                      : savedOnce
                        ? "Saved"
                        : ""}
              </span>
            </div>
            {allowIfNeedBe && (
              <div className="meet-brush" role="group" aria-label="Brush level">
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
            <p className="meet-gridcard__note muted">
              Drag to paint when you can make it — it saves by itself.
            </p>
            <MeetAvailabilityGrid
              event={event}
              variant="paint"
              availability={draft ?? {}}
              paintLevel={paintLevel}
              onChange={(next) => {
                setDraft(next);
                setDirty(true);
              }}
            />
          </section>
        )}

        <section className="meet-gridcard">
          <div className="meet-gridcard__bar">
            <h2 className="meet-section-head__title">The group</h2>
            <div className="meet-legend" aria-hidden="true">
              <span className="meet-legend__swatch meet-legend__swatch--low" />
              <span className="meet-legend__label">few</span>
              <span className="meet-legend__swatch meet-legend__swatch--high" />
              <span className="meet-legend__label">everyone</span>
              <span className="meet-legend__swatch meet-legend__swatch--inb" />
              <span className="meet-legend__label">if need be</span>
            </div>
          </div>
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
                            (selectedSlot.slotIndex + 1) * event.slotMinutes
                        },
                    event.mode
                  )}
                </span>
                <span className="meet-slotinfo__names">
                  {(slotDetail.available[selectedSlot.slotIndex] ?? []).length ===
                    0 &&
                  (slotDetail.ifNeedBe[selectedSlot.slotIndex] ?? []).length ===
                    0 ? (
                    <span className="muted">No one yet.</span>
                  ) : (
                    <>
                      {(slotDetail.available[selectedSlot.slotIndex] ?? []).map(
                        (id) => (
                          <span
                            key={id}
                            className="meet-namechip meet-namechip--yes"
                          >
                            {nameOf(id)}
                          </span>
                        )
                      )}
                      {(slotDetail.ifNeedBe[selectedSlot.slotIndex] ?? []).map(
                        (id) => (
                          <span
                            key={id}
                            className="meet-namechip meet-namechip--inb"
                          >
                            {nameOf(id)} · if need be
                          </span>
                        )
                      )}
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
        </section>
      </div>

      {/* BEST TIMES */}
      <section className="meet-panel meet-pub__suggest">
        <div className="meet-section-head">
          <h2 className="meet-section-head__title">Best times so far</h2>
          <span className="meet-section-head__count">
            {snapshot.participants.length}{" "}
            {snapshot.participants.length === 1 ? "person" : "people"}
          </span>
        </div>
        {snapshot.suggestions.length === 0 ? (
          <p className="muted meet-panel__hint">
            No overlap yet — best times appear as people respond.
          </p>
        ) : (
          <div className="meet-suggest-list">
            {snapshot.suggestions.map((s, idx) => (
              <div key={`${s.date}-${s.startMinute}-${idx}`} className="meet-suggest">
                <span className="meet-suggest__rank">{idx + 1}</span>
                <div className="meet-suggest__body">
                  <span className="meet-suggest__when">
                    {formatMeetSlot(s, event.mode)}
                  </span>
                  <span className="meet-suggest__who">
                    {s.availableIds.length} available
                    {s.ifNeedBeIds.length > 0 &&
                      ` · ${s.ifNeedBeIds.length} if need be`}
                  </span>
                  <span className="meet-suggest__names muted">
                    {[...s.availableIds, ...s.ifNeedBeIds]
                      .map(nameOf)
                      .slice(0, 6)
                      .join(", ")}
                    {s.availableIds.length + s.ifNeedBeIds.length > 6 && "…"}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
};

export default MeetRespondPage;
