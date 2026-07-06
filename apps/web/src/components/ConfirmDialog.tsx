import {
  ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState
} from "react";
import { createPortal } from "react-dom";

export interface ConfirmOptions {
  title: string;
  body?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** "danger" renders a rose confirm button; default is the indigo accent. */
  tone?: "danger" | "primary";
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

/** Promise-based replacement for window.confirm, styled to match the app. */
export const useConfirm = (): ConfirmFn => {
  const confirm = useContext(ConfirmContext);
  if (!confirm) {
    throw new Error("useConfirm must be used inside ConfirmDialogProvider");
  }
  return confirm;
};

interface PendingConfirm {
  options: ConfirmOptions;
  resolve: (result: boolean) => void;
}

export const ConfirmDialogProvider = ({ children }: { children: ReactNode }) => {
  const [pending, setPending] = useState<PendingConfirm | null>(null);
  const confirmButtonRef = useRef<HTMLButtonElement>(null);

  const confirm = useCallback<ConfirmFn>((options) => {
    return new Promise<boolean>((resolve) => {
      setPending({ options, resolve });
    });
  }, []);

  const settle = useCallback((result: boolean) => {
    setPending((current) => {
      current?.resolve(result);
      return null;
    });
  }, []);

  useEffect(() => {
    if (!pending) return;
    // Enter confirms (parity with window.confirm), Escape cancels.
    confirmButtonRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        settle(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [pending, settle]);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {pending &&
        createPortal(
          <div className="confirm-overlay" onClick={() => settle(false)}>
            <div
              role="alertdialog"
              aria-modal="true"
              aria-label={pending.options.title}
              className="confirm-dialog"
              onClick={(event) => event.stopPropagation()}
            >
              <h3 className="confirm-dialog__title">{pending.options.title}</h3>
              {pending.options.body && (
                <p className="confirm-dialog__body">{pending.options.body}</p>
              )}
              <div className="confirm-dialog__actions">
                <button
                  type="button"
                  className="confirm-dialog__cancel"
                  onClick={() => settle(false)}
                >
                  {pending.options.cancelLabel ?? "Cancel"}
                </button>
                <button
                  ref={confirmButtonRef}
                  type="button"
                  className={
                    pending.options.tone === "danger"
                      ? "confirm-dialog__confirm confirm-dialog__confirm--danger"
                      : "confirm-dialog__confirm"
                  }
                  onClick={() => settle(true)}
                >
                  {pending.options.confirmLabel ?? "Confirm"}
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </ConfirmContext.Provider>
  );
};
