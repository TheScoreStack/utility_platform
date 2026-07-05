import { FormEvent, WheelEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { orderedPayableMethods } from "../lib/paymentLinks";
import type { PaymentMethods, TripMember } from "../types";

export type SettlementPrefill = {
  from: string;
  to: string;
  amount: number;
  /** Bump this when re-applying the same from/to/amount triple */
  nonce: number;
};

interface SettlementFormProps {
  members: TripMember[];
  currency: string;
  onSubmit: (payload: {
    fromMemberId: string;
    toMemberId: string;
    amount: number;
    note?: string;
  }) => Promise<unknown>;
  isSubmitting: boolean;
  currentUserId?: string;
  paymentMethods?: Record<string, PaymentMethods>;
  memberBalances?: Record<string, number>;
  settlementSuggestions?: Array<{ from: string; to: string; amount: number }>;
  prefill?: SettlementPrefill | null;
  onPrefillConsumed?: () => void;
}

const SettlementForm = ({
  members,
  currency,
  onSubmit,
  isSubmitting,
  currentUserId,
  paymentMethods,
  memberBalances,
  settlementSuggestions,
  prefill,
  onPrefillConsumed
}: SettlementFormProps) => {
  const formRef = useRef<HTMLFormElement | null>(null);
  const [flash, setFlash] = useState(false);
  const preferredFromMember = useMemo(() => {
    if (currentUserId && members.some((member) => member.memberId === currentUserId)) {
      return currentUserId;
    }
    return members[0]?.memberId ?? "";
  }, [currentUserId, members]);

  const pickAlternateMemberId = useCallback(
    (excludeId: string): string => {
      const alternate = members.find((member) => member.memberId !== excludeId);
      return alternate?.memberId ?? excludeId ?? "";
    },
    [members]
  );

  const [fromMemberId, setFromMemberId] = useState<string>(preferredFromMember);
  const [fromManuallySelected, setFromManuallySelected] = useState(false);
  const [toMemberId, setToMemberId] = useState<string>(pickAlternateMemberId(preferredFromMember));
  const [toManuallySelected, setToManuallySelected] = useState(false);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setFromMemberId((previous) => {
      if (fromManuallySelected && members.some((member) => member.memberId === previous)) {
        return previous;
      }
      if (members.some((member) => member.memberId === previous)) {
        return previous;
      }
      setFromManuallySelected(false);
      return preferredFromMember;
    });
  }, [members, preferredFromMember, fromManuallySelected]);

  useEffect(() => {
    setToMemberId((previous) => {
      const exists = members.some((member) => member.memberId === previous);
      if (toManuallySelected && exists && previous !== fromMemberId) {
        return previous;
      }
      const alternate = pickAlternateMemberId(fromMemberId);
      if (!exists || previous === fromMemberId) {
        setToManuallySelected(false);
        return alternate;
      }
      if (!toManuallySelected) {
        return alternate;
      }
      return previous;
    });
  }, [members, fromMemberId, toManuallySelected, pickAlternateMemberId]);

  useEffect(() => {
    if (!fromManuallySelected) {
      setFromMemberId(preferredFromMember);
    }
  }, [preferredFromMember, fromManuallySelected]);

  useEffect(() => {
    if (!prefill) return;
    const fromMember = members.find((m) => m.memberId === prefill.from);
    const toMember = members.find((m) => m.memberId === prefill.to);
    if (!fromMember || !toMember) {
      onPrefillConsumed?.();
      return;
    }
    setFromMemberId(prefill.from);
    setFromManuallySelected(true);
    setToMemberId(prefill.to);
    setToManuallySelected(true);
    setAmount(prefill.amount.toFixed(2));
    setError(null);
    setFlash(true);
    formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    const flashTimer = setTimeout(() => setFlash(false), 1400);
    onPrefillConsumed?.();
    return () => clearTimeout(flashTimer);
  }, [prefill, members, onPrefillConsumed]);

  const handleNumberInputWheel = useCallback((event: WheelEvent<HTMLInputElement>) => {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.blur();
  }, []);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);

    if (!fromMemberId || !toMemberId) {
      setError("Select both members");
      return;
    }
    if (fromMemberId === toMemberId) {
      setError("Members must be different");
      return;
    }
    const parsedAmount = Number.parseFloat(amount);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      setError("Enter a valid amount");
      return;
    }

    await onSubmit({
      fromMemberId,
      toMemberId,
      amount: parsedAmount,
      note: note.trim() || undefined
    });

    setAmount("");
    setNote("");
    setFromMemberId(preferredFromMember);
    setFromManuallySelected(false);
    const fallbackTo = pickAlternateMemberId(preferredFromMember);
    setToMemberId(fallbackTo);
    setToManuallySelected(false);
  };

  const handleFromChange = (value: string) => {
    setFromMemberId(value);
    setFromManuallySelected(true);
    if (!toManuallySelected || value === toMemberId) {
      const alternate = pickAlternateMemberId(value);
      setToMemberId(alternate);
      setToManuallySelected(false);
    }
  };

  const handleToChange = (value: string) => {
    setToMemberId(value);
    setToManuallySelected(true);
  };

  const payeeMethods = paymentMethods?.[toMemberId];
  const availableMethodEntries = useMemo(
    () =>
      orderedPayableMethods(payeeMethods) as Array<[keyof PaymentMethods, string]>,
    [payeeMethods]
  );

  const balanceFormatter = useMemo(
    () =>
      new Intl.NumberFormat(undefined, {
        style: "currency",
        currency,
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      }),
    [currency]
  );

  const fromBalance = memberBalances?.[fromMemberId];
  const toBalance = memberBalances?.[toMemberId];

  const matchingSuggestion = useMemo(
    () =>
      settlementSuggestions?.find(
        (suggestion) =>
          suggestion.from === fromMemberId && suggestion.to === toMemberId
      ),
    [fromMemberId, toMemberId, settlementSuggestions]
  );

  return (
    <form
      onSubmit={handleSubmit}
      className="list"
      ref={formRef}
      style={{
        transition: "box-shadow 0.4s ease, background 0.4s ease",
        boxShadow: flash ? "0 0 0 2px rgba(56,189,248,0.55)" : undefined,
        background: flash ? "rgba(56,189,248,0.07)" : undefined,
        borderRadius: "0.85rem",
        padding: flash ? "0.75rem" : undefined
      }}
    >
      <div className="input-group">
        <label>From</label>
        <select value={fromMemberId} onChange={(event) => handleFromChange(event.target.value)}>
          {members.map((member) => (
            <option key={member.memberId} value={member.memberId}>
              {member.displayName}
              {currentUserId === member.memberId ? " (you)" : ""}
            </option>
          ))}
        </select>
        {fromBalance !== undefined && (
          <p className="muted" style={{ margin: "0.3rem 0 0" }}>
            Balance:{" "}
            <strong style={{ color: fromBalance >= 0 ? "#4ade80" : "#f87171" }}>
              {balanceFormatter.format(fromBalance)}
            </strong>
          </p>
        )}
      </div>

      <div className="input-group">
        <label>To</label>
        <select value={toMemberId} onChange={(event) => handleToChange(event.target.value)}>
          {members.map((member) => (
            <option key={member.memberId} value={member.memberId}>
              {member.displayName}
              {currentUserId === member.memberId ? " (you)" : ""}
            </option>
          ))}
        </select>
        {toBalance !== undefined && (
          <p className="muted" style={{ margin: "0.3rem 0 0" }}>
            Balance:{" "}
            <strong style={{ color: toBalance >= 0 ? "#4ade80" : "#f87171" }}>
              {balanceFormatter.format(toBalance)}
            </strong>
          </p>
        )}
      </div>

      <div className="input-group">
        <label>Amount</label>
        <input
          type="number"
          inputMode="decimal"
          min="0"
          step="0.01"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          onWheel={handleNumberInputWheel}
        />
        {matchingSuggestion && (
          <p className="muted" style={{ margin: "0.3rem 0 0", display: "flex", gap: "0.5rem", alignItems: "center" }}>
            Suggested: {balanceFormatter.format(matchingSuggestion.amount)}
            <button
              type="button"
              className="secondary"
              style={{ padding: "0.2rem 0.5rem" }}
              onClick={() => setAmount(String(matchingSuggestion.amount))}
            >
              Use this
            </button>
          </p>
        )}
      </div>

      <div className="input-group">
        <label>Note (optional)</label>
        <input value={note} onChange={(event) => setNote(event.target.value)} placeholder="Dinner reimbursement" />
      </div>

      {availableMethodEntries.length > 0 ? (
        <div className="card" style={{ padding: "0.75rem", background: "rgba(15,23,42,0.35)", border: "1px solid rgba(148,163,184,0.1)" }}>
          <p style={{ margin: "0 0 0.25rem", fontWeight: 600 }}>Pay {members.find((m) => m.memberId === toMemberId)?.displayName ?? "member"} via:</p>
          <ul style={{ margin: 0, paddingLeft: "1.1rem", color: "#e2e8f0" }}>
            {availableMethodEntries.map(([method, value]) => (
              <li key={method} style={{ margin: "0.15rem 0" }}>
                <strong style={{ textTransform: "capitalize" }}>{method}:</strong> {value}
                {payeeMethods?.primary === method && (
                  <em style={{ color: "#a5b4fc", marginLeft: "0.35rem" }}>· preferred</em>
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="muted" style={{ margin: 0 }}>
          No payment methods saved for the recipient yet.
        </p>
      )}

      {error && <p style={{ color: "#fda4af" }}>{error}</p>}

      <button type="submit" className="secondary" disabled={isSubmitting}>
        {isSubmitting ? "Recording…" : "Record payment"}
      </button>

      {settlementSuggestions && settlementSuggestions.length > 0 && (
        <div className="card" style={{ padding: "0.75rem", background: "rgba(15,23,42,0.35)", border: "1px solid rgba(148,163,184,0.1)" }}>
          <p style={{ margin: "0 0 0.5rem", fontWeight: 600 }}>Suggested payments</p>
          <div className="list" style={{ gap: "0.5rem" }}>
            {settlementSuggestions.map((suggestion) => (
              <div
                key={`${suggestion.from}-${suggestion.to}-${suggestion.amount}`}
                className="card"
                style={{ padding: "0.5rem 0.65rem", display: "flex", justifyContent: "space-between", alignItems: "center" }}
              >
                <div style={{ display: "flex", flexDirection: "column" }}>
                  <span>
                    <strong>{members.find((m) => m.memberId === suggestion.from)?.displayName ?? suggestion.from}</strong>{" "}
                    should pay{" "}
                    <strong>{members.find((m) => m.memberId === suggestion.to)?.displayName ?? suggestion.to}</strong>
                  </span>
                  <span className="muted">{balanceFormatter.format(suggestion.amount)}</span>
                </div>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => {
                    handleFromChange(suggestion.from);
                    handleToChange(suggestion.to);
                    setAmount(String(suggestion.amount));
                  }}
                >
                  Use
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </form>
  );
};

export default SettlementForm;
