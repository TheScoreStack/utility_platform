// Signed-in join bridge for Stack Meet — /meet/join/<slug> inside the
// Authenticator. Resolves the share slug via the public snapshot (no auth
// needed there), then joins via the authed availability PUT — an empty
// availability is enough to claim a row — and forwards to the event
// workspace. Members who already responded are recognized first, so their
// answer is never overwritten by the empty join write.

import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ApiError } from "../lib/api";
import { meetApi, meetPublicApi } from "../lib/meetApi";
import { browserTimezone } from "../lib/meetFormat";

const MeetJoinPage = () => {
  const { slug = "" } = useParams();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (!slug || started.current) return;
    started.current = true;
    let cancelled = false;
    (async () => {
      try {
        const snap = await meetPublicApi.get(slug);
        const eventId = snap.event.eventId;
        try {
          // Already in? Straight to the workspace, response untouched.
          await meetApi.detail(eventId);
        } catch (err) {
          if (err instanceof ApiError && err.status === 403) {
            // Not a participant yet — one empty PUT joins the meet.
            await meetApi.saveAvailability(eventId, {
              availability: {},
              timezone: browserTimezone()
            });
          } else {
            throw err;
          }
        }
        if (!cancelled) navigate(`/meet/events/${eventId}`, { replace: true });
      } catch (err) {
        if (cancelled) return;
        setError(
          err instanceof ApiError && err.status === 404
            ? "This meet does not exist — the link may have been deleted."
            : err instanceof ApiError && err.status === 409
              ? "Joining is closed for this meet."
              : err instanceof ApiError
                ? err.message
                : "Could not join this meet. Try again shortly."
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slug, navigate]);

  return (
    <div className="meet-page">
      <div className="empty-state">
        {error ? (
          <>
            <p className="empty-state__title">Could not open this meet.</p>
            <p className="empty-state__hint">{error}</p>
            <Link to="/meet" className="meet-backlink">
              ← Back to your meets
            </Link>
          </>
        ) : (
          <>
            <p className="empty-state__title">Joining this meet…</p>
            <p className="empty-state__hint">
              One moment — pulling up the grid.
            </p>
          </>
        )}
      </div>
    </div>
  );
};

export default MeetJoinPage;
