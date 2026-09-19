// A slide-over surface for occasional work.
//
// Web previously had no place to put anything that wasn't the main task, so
// People, Activity and the full Overview each became a top-level tab and the
// trip page offered five destinations where mobile offers two. This gives
// secondary work somewhere to live without competing with Expenses and
// Settle up.

import { useCallback, useEffect, useRef } from "react";

interface SidePanelProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}

export const SidePanel = ({ open, title, onClose, children }: SidePanelProps) => {
  const sheetRef = useRef<HTMLDivElement | null>(null);
  // Whatever had focus before the panel opened, so it can be handed back.
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  // Callers pass an inline arrow for onClose, so it is a new function on every
  // render. Reading it through a ref keeps the effect below keyed on `open`
  // alone; depending on onClose would re-run it constantly and yank focus out
  // of whatever the user was typing into inside the panel.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    restoreFocusRef.current = document.activeElement as HTMLElement | null;
    // Move focus into the panel so keyboard and screen-reader users land here
    // rather than continuing from wherever the page was.
    sheetRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onCloseRef.current();
      }
    };
    document.addEventListener("keydown", onKeyDown);

    // The page behind shouldn't scroll while the panel is over it.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      restoreFocusRef.current?.focus?.();
    };
  }, [open]);

  const handleBackdropClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      // Only a click on the backdrop itself closes; clicks inside the sheet
      // bubble up here too and must not.
      if (event.target === event.currentTarget) onClose();
    },
    [onClose]
  );

  if (!open) return null;

  return (
    <div
      className="side-panel__backdrop"
      onClick={handleBackdropClick}
      role="presentation"
    >
      <div
        ref={sheetRef}
        className="side-panel__sheet"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
      >
        <div className="side-panel__head">
          <h2>{title}</h2>
          <button
            type="button"
            className="secondary side-panel__close"
            onClick={onClose}
            aria-label="Close panel"
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
};

export default SidePanel;
