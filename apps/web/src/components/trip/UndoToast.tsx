import { CSSProperties, useEffect } from "react";

interface UndoToastProps {
  nonce: number;
  title: string;
  onUndo: () => void;
  onDismiss: () => void;
  durationMs?: number;
}

export const UndoToast = ({ nonce, title, onUndo, onDismiss, durationMs = 6000 }: UndoToastProps) => {
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
