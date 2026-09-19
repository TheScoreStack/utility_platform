// Opt-in wrapper around the add-expense form.
//
// The expenses tab used to render the whole 2,500-line form as the first
// thing on the page, so every visit opened on a wall of empty inputs with
// your actual expenses pushed below it. The form now stays behind a button,
// the way the mobile app keeps it behind a sheet, and opens on demand.
//
// It also opens itself when something upstream needs it: editing an expense
// or repeating one hands over a prefill, and the form has to be mounted to
// consume it.

import { useCallback, useEffect, useRef, useState } from "react";
import AddExpenseForm, {
  type CreateExpenseInput,
  type ExpensePrefill
} from "../AddExpenseForm";
import type { Expense, Receipt, TripMember } from "../../types";

interface ExpenseComposerProps {
  tripId: string;
  members: TripMember[];
  currency: string;
  receipts: Receipt[];
  isSubmitting: boolean;
  onSubmit: (payload: CreateExpenseInput) => Promise<unknown>;
  currentUserId?: string;
  prefill?: ExpensePrefill | null;
  onPrefillConsumed?: () => void;
  editingExpense: Expense | null;
  onCancelEdit: () => void;
  /** Rendered beside the trigger when the composer is closed. */
  expenseCount: number;
}

export const ExpenseComposer = ({
  tripId,
  members,
  currency,
  receipts,
  isSubmitting,
  onSubmit,
  currentUserId,
  prefill,
  onPrefillConsumed,
  editingExpense,
  onCancelEdit,
  expenseCount
}: ExpenseComposerProps) => {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);
  // Set when the composer opens itself, so we know to scroll it into view
  // rather than leaving the user looking at an unchanged screen.
  const shouldRevealRef = useRef(false);

  // Editing or repeating an expense has to open the form: the prefill is
  // consumed by an effect inside AddExpenseForm, which only runs once mounted.
  useEffect(() => {
    if (editingExpense || prefill) {
      setOpen((wasOpen) => {
        if (!wasOpen) shouldRevealRef.current = true;
        return true;
      });
    }
  }, [editingExpense, prefill]);

  useEffect(() => {
    if (!open || !shouldRevealRef.current) return;
    shouldRevealRef.current = false;
    panelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [open]);

  const close = useCallback(() => {
    setOpen(false);
    // Leaving the form open in "edit" mode after closing would silently keep
    // the next expense pointed at the old one.
    if (editingExpense) onCancelEdit();
  }, [editingExpense, onCancelEdit]);

  // Close once the expense is actually saved, so the list is what you see next.
  const handleSubmit = useCallback(
    async (payload: CreateExpenseInput) => {
      const result = await onSubmit(payload);
      setOpen(false);
      return result;
    },
    [onSubmit]
  );

  if (!open) {
    return (
      <div className="composer__trigger">
        <button type="button" className="primary" onClick={() => setOpen(true)}>
          + Add expense
        </button>
        <span className="text-muted">
          {expenseCount === 0
            ? "Nothing logged yet."
            : `${expenseCount} ${expenseCount === 1 ? "expense" : "expenses"} on this trip.`}
        </span>
      </div>
    );
  }

  return (
    <div className="composer__panel" ref={panelRef}>
      <div className="composer__head">
        <h2>{editingExpense ? "Edit expense" : "New expense"}</h2>
        <button type="button" className="secondary btn-sm" onClick={close}>
          Close
        </button>
      </div>
      <AddExpenseForm
        tripId={tripId}
        members={members}
        currency={currency}
        receipts={receipts}
        isSubmitting={isSubmitting}
        onSubmit={handleSubmit}
        currentUserId={currentUserId}
        prefill={prefill}
        onPrefillConsumed={onPrefillConsumed}
        editingLabel={editingExpense?.description ?? null}
        editingIsDraft={Boolean(editingExpense?.draft)}
        onCancelEdit={close}
      />
    </div>
  );
};

export default ExpenseComposer;
