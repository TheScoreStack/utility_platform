import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import { api, ApiError } from "../lib/api";
import type { InvitePreview } from "../types";

const JoinTripPage = () => {
  const { inviteId } = useParams<{ inviteId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const preview = useQuery({
    queryKey: ["invite-preview", inviteId],
    queryFn: () => api.get<InvitePreview>(`/invites/${inviteId}`),
    enabled: Boolean(inviteId),
    retry: false
  });

  const redeem = useMutation({
    mutationFn: () => api.post<{ tripId: string }>(`/invites/${inviteId}/redeem`, {}),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["trips"] });
      navigate(`/group-expenses/trips/${result.tripId}`);
    }
  });

  // If they're already a member, just jump straight in.
  useEffect(() => {
    if (preview.data?.alreadyMember) {
      navigate(`/group-expenses/trips/${preview.data.tripId}`, { replace: true });
    }
  }, [preview.data, navigate]);

  if (!inviteId) {
    return (
      <div className="empty-state">
        <p className="empty-state__title">Missing invite.</p>
        <p className="empty-state__hint">The link looks incomplete.</p>
      </div>
    );
  }

  if (preview.isLoading) {
    return (
      <section className="join-card">
        <span className="skel skel--text" style={{ width: "9rem", height: "0.7rem" }}>&nbsp;</span>
        <span className="skel skel--title" style={{ width: "70%", height: "2.2rem", marginTop: "0.7rem" }}>&nbsp;</span>
        <span className="skel skel--text" style={{ width: "60%", marginTop: "0.8rem" }}>&nbsp;</span>
        <span className="skel skel--pill" style={{ width: "11rem", height: "3rem", marginTop: "1.5rem" }}>&nbsp;</span>
      </section>
    );
  }

  if (preview.isError) {
    const message =
      preview.error instanceof ApiError
        ? preview.error.message
        : "This invite link is no longer valid.";
    return (
      <section className="join-card join-card--error">
        <span className="join-card__eyebrow">Invite</span>
        <h1 className="join-card__title">
          That link <em>doesn't open</em> anymore.
        </h1>
        <p className="join-card__sub">{message}</p>
        <button
          type="button"
          className="join-card__action"
          onClick={() => navigate("/group-expenses/trips")}
        >
          Back to your tabs
        </button>
      </section>
    );
  }

  const data = preview.data!;
  return (
    <section className="join-card">
      <span className="join-card__eyebrow">You've been invited</span>
      <h1 className="join-card__title">
        Join <em>{data.tripName}</em>.
      </h1>
      <p className="join-card__sub">
        {data.memberCount} {data.memberCount === 1 ? "person is" : "people are"} already on this tab.
        Joining adds you so expenses can include you.
      </p>
      {redeem.isError && (
        <p className="join-card__error">
          {redeem.error instanceof ApiError
            ? redeem.error.message
            : "Couldn't join — try again."}
        </p>
      )}
      <div className="join-card__actions">
        <button
          type="button"
          className="join-card__action"
          onClick={() => redeem.mutate()}
          disabled={redeem.isPending}
        >
          {redeem.isPending ? "Joining…" : "Join this tab →"}
        </button>
        <button
          type="button"
          className="join-card__decline"
          onClick={() => navigate("/group-expenses/trips")}
          disabled={redeem.isPending}
        >
          Not now
        </button>
      </div>
    </section>
  );
};

export default JoinTripPage;
