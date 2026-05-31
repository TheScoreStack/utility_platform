import { FormEvent, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../lib/api";
import { getInitials, seedAvatar } from "../lib/avatarPalette";
import type { ExpenseComment } from "../types";

interface Props {
  tripId: string;
  expenseId: string;
  currentUserId?: string;
  canDeleteAny: boolean; // trip owner
  open: boolean;
}

const formatTime = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  try {
    return new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit"
    }).format(d);
  } catch {
    return d.toLocaleString();
  }
};

const ExpenseCommentsThread = ({
  tripId,
  expenseId,
  currentUserId,
  canDeleteAny,
  open
}: Props) => {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState("");
  const queryKey = ["expense-comments", tripId, expenseId];

  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: () =>
      api.get<{ comments: ExpenseComment[] }>(
        `/trips/${tripId}/expenses/${expenseId}/comments`
      ),
    enabled: open
  });

  const createMutation = useMutation({
    mutationFn: (body: string) =>
      api.post<ExpenseComment>(
        `/trips/${tripId}/expenses/${expenseId}/comments`,
        { body }
      ),
    onSuccess: () => {
      setDraft("");
      void queryClient.invalidateQueries({ queryKey });
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (commentId: string) =>
      api.delete<void>(
        `/trips/${tripId}/expenses/${expenseId}/comments/${commentId}`
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey });
    }
  });

  if (!open) return null;

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = draft.trim();
    if (!trimmed) return;
    createMutation.mutate(trimmed);
  };

  const comments = data?.comments ?? [];

  return (
    <div className="cmt-thread">
      {isLoading && comments.length === 0 ? (
        <p className="cmt-thread__empty">
          <em>Loading…</em>
        </p>
      ) : comments.length === 0 ? (
        <p className="cmt-thread__empty">
          <em>No comments yet — start the thread.</em>
        </p>
      ) : (
        <ul className="cmt-thread__list">
          {comments.map((comment) => {
            const palette = seedAvatar(comment.authorId);
            const isMine = comment.authorId === currentUserId;
            const canDelete = isMine || canDeleteAny;
            return (
              <li key={comment.commentId} className="cmt-item">
                <span
                  className="cmt-item__avatar"
                  style={{ background: palette.bg, color: palette.fg }}
                  aria-hidden="true"
                >
                  {getInitials(comment.authorName ?? comment.authorId)}
                </span>
                <div className="cmt-item__body">
                  <div className="cmt-item__head">
                    <span className="cmt-item__name">
                      {isMine ? "You" : comment.authorName ?? "Someone"}
                    </span>
                    <span className="cmt-item__time">
                      {formatTime(comment.createdAt)}
                    </span>
                    {canDelete && (
                      <button
                        type="button"
                        className="cmt-item__delete"
                        title="Delete comment"
                        disabled={
                          deleteMutation.isPending &&
                          deleteMutation.variables === comment.commentId
                        }
                        onClick={() => {
                          if (!window.confirm("Delete this comment?")) return;
                          deleteMutation.mutate(comment.commentId);
                        }}
                      >
                        ×
                      </button>
                    )}
                  </div>
                  <p className="cmt-item__text">{comment.body}</p>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <form className="cmt-compose" onSubmit={handleSubmit}>
        <input
          className="cmt-compose__input"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Add a comment…"
          maxLength={2000}
          disabled={createMutation.isPending}
        />
        <button
          type="submit"
          className="cmt-compose__send"
          disabled={createMutation.isPending || !draft.trim()}
        >
          {createMutation.isPending ? "…" : "Post"}
        </button>
      </form>
      {createMutation.isError && (
        <p className="cmt-thread__error">
          {createMutation.error instanceof ApiError
            ? createMutation.error.message
            : "Couldn't post — try again."}
        </p>
      )}
    </div>
  );
};

export default ExpenseCommentsThread;
