import { ReactNode, useState } from "react";
import { useConfirm } from "../ConfirmDialog";

interface RecentlyDeletedListProps {
  label: string;
  emptyHint: string;
  items: Array<{
    id: string;
    title: ReactNode;
    meta: string;
  }>;
  onRestore: (id: string) => Promise<void>;
  onPurge: (id: string) => Promise<void>;
  restoringId?: string;
  purgingId?: string;
}

export const RecentlyDeletedList = ({
  label,
  emptyHint,
  items,
  onRestore,
  onPurge,
  restoringId,
  purgingId
}: RecentlyDeletedListProps) => {
  const confirm = useConfirm();
  const [open, setOpen] = useState(false);
  if (items.length === 0) return null;

  return (
    <div className="trash">
      <button
        type="button"
        className="trash__header"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="trash__title">
          <span className={`trash__chevron ${open ? "trash__chevron--open" : ""}`}>▸</span>
          Recently deleted {label.toLowerCase()}
          <span className="trash__count">{items.length}</span>
        </span>
        <span className="muted" style={{ fontSize: "0.78rem" }}>
          {open ? "hide" : emptyHint}
        </span>
      </button>
      {open && (
        <div className="trash__list">
          {items.map((item) => (
            <div key={item.id} className="trash__row">
              <div className="trash__row-body">
                <span className="trash__row-title">{item.title}</span>
                <span className="trash__row-meta">{item.meta}</span>
              </div>
              <div className="trash__row-actions">
                <button
                  type="button"
                  className="trash__row-restore"
                  disabled={restoringId === item.id}
                  onClick={() => onRestore(item.id).catch(() => {})}
                >
                  {restoringId === item.id ? "Restoring…" : "Restore"}
                </button>
                <button
                  type="button"
                  className="trash__row-purge"
                  disabled={purgingId === item.id}
                  title="Permanently delete — cannot be undone"
                  onClick={async () => {
                    const ok = await confirm({
                      title: "Delete forever?",
                      body: "This permanently removes it — it can't be restored.",
                      confirmLabel: "Delete forever",
                      tone: "danger"
                    });
                    if (!ok) return;
                    onPurge(item.id).catch(() => {});
                  }}
                >
                  {purgingId === item.id ? "…" : "Delete forever"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
