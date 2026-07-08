// Public claim page for split links — served at /s/<shareId> OUTSIDE the
// Authenticator and outside React Router (like the Meet respond page), so it
// uses window.location for the shareId and plain fetch (no Amplify session).
// Guests pick who they are (or type a name), tap the items they had, watch
// their share update (items + tax/tip pro-rated against the whole bill),
// then pay through the payer's handles and mark it done.

import {
  FormEvent,
  ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { fetchAuthSession } from "@aws-amplify/auth";
import { buildItemizedAllocations } from "@utility-platform/shared";
import { ApiError } from "../lib/api";
import {
  clearSplitGuest,
  loadSplitGuest,
  saveSplitGuest,
  splitLinkApi,
  splitPublicApi,
  type SplitGuestIdentity
} from "../lib/splitLinkApi";
import { buildPaymentLink, orderedPayableMethods } from "../lib/paymentLinks";
import { getInitials, seedAvatar } from "../lib/avatarPalette";
import type { SplitLinkSnapshot } from "../types";

const shareIdFromPath = (): string => {
  const parts = window.location.pathname.split("/");
  return parts[1] === "s" && parts[2] ? parts[2] : "";
};

const METHOD_LABELS: Record<string, string> = {
  venmo: "Venmo",
  paypal: "PayPal",
  zelle: "Zelle"
};

const SplitClaimPage = () => {
  const shareId = useMemo(shareIdFromPath, []);
  const [snapshot, setSnapshot] = useState<SplitLinkSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [identity, setIdentity] = useState<SplitGuestIdentity | null>(() =>
    shareId ? loadSplitGuest(shareId) : null
  );

  // The guest's item selection. `null` = mirror the server; a Set = local
  // edits waiting for the debounced save.
  const [draft, setDraft] = useState<Set<string> | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [joinName, setJoinName] = useState("");
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);

  /** Signed-in Stack Core account in this browser, if any — the app shares
   *  this origin, so Amplify tokens are readable here without any login UI. */
  const [account, setAccount] = useState<{ name: string } | null>(null);
  /** "Were you already added by name?" step of the account join. */
  const [accountChooserOpen, setAccountChooserOpen] = useState(false);

  const [completing, setCompleting] = useState(false);
  const [completeError, setCompleteError] = useState<string | null>(null);
  const [copiedZelle, setCopiedZelle] = useState(false);

  const identityRef = useRef(identity);
  identityRef.current = identity;

  const adoptSnapshot = useCallback((snap: SplitLinkSnapshot) => {
    setSnapshot(snap);
    // A stored identity for someone no longer on the trip is useless.
    if (
      identityRef.current &&
      !snap.members.some((m) => m.memberId === identityRef.current?.memberId)
    ) {
      clearSplitGuest(shareIdFromPath());
      setIdentity(null);
    }
  }, []);

  // Initial load.
  useEffect(() => {
    if (!shareId) {
      setLoading(false);
      setLoadError("This link is missing its code.");
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const snap = await splitPublicApi.get(shareId);
        if (!cancelled) adoptSnapshot(snap);
      } catch (err) {
        if (!cancelled) {
          setLoadError(
            err instanceof ApiError && err.status === 404
              ? "This split link is no longer active — ask whoever sent it for a fresh one."
              : "Could not load this bill. Check your connection and refresh."
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [shareId, adoptSnapshot]);

  // Detect a signed-in session — re-checked when the tab regains focus, so
  // "sign in over in the app, come back here" just works.
  const checkAccount = useCallback(async () => {
    try {
      const session = await fetchAuthSession();
      const payload = session.tokens?.idToken?.payload;
      if (!payload) {
        setAccount(null);
        return;
      }
      const fullName = [payload.given_name, payload.family_name]
        .filter((part) => typeof part === "string" && part)
        .join(" ");
      setAccount({
        name:
          fullName ||
          (typeof payload.email === "string" ? payload.email : "your account")
      });
    } catch {
      setAccount(null);
    }
  }, []);

  useEffect(() => {
    void checkAccount();
    const onVisibility = () => {
      if (!document.hidden) void checkAccount();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () =>
      document.removeEventListener("visibilitychange", onVisibility);
  }, [checkAccount]);

  // Light polling while visible so guests see each other's claims land.
  const draftRef = useRef(draft);
  const savingRef = useRef(saving);
  useEffect(() => {
    draftRef.current = draft;
    savingRef.current = saving;
  });
  useEffect(() => {
    if (!shareId) return;
    const interval = setInterval(async () => {
      if (document.hidden || draftRef.current !== null || savingRef.current) {
        return;
      }
      try {
        adoptSnapshot(await splitPublicApi.get(shareId));
      } catch {
        // Transient poll failures are fine — the next tick retries.
      }
    }, 8000);
    return () => clearInterval(interval);
  }, [shareId, adoptSnapshot]);

  const expense = snapshot?.expense;

  const formatAmount = useMemo(() => {
    const currency = expense?.currency ?? "USD";
    try {
      return new Intl.NumberFormat(undefined, {
        style: "currency",
        currency,
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      });
    } catch {
      return new Intl.NumberFormat(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      });
    }
  }, [expense?.currency]);

  const nameOf = useMemo(() => {
    const map = new Map(
      (snapshot?.members ?? []).map((m) => [m.memberId, m.displayName])
    );
    return (id: string) => map.get(id) ?? "Someone";
  }, [snapshot?.members]);

  const myGuestRow = snapshot?.guests.find(
    (g) => g.memberId === identity?.memberId
  );
  const completed = Boolean(myGuestRow?.completedAt);
  const isPayer = identity?.memberId === snapshot?.payer.memberId;

  /** Selected item ids: local draft while editing, otherwise the server's. */
  const selection = useMemo(() => {
    if (draft) return draft;
    if (!snapshot || !identity) return new Set<string>();
    return new Set(
      snapshot.expense.lineItems
        .filter((item) => item.assignedMemberIds.includes(identity.memberId))
        .map((item) => item.lineItemId)
    );
  }, [draft, snapshot, identity]);

  /** Live per-member breakdown with the local draft applied — same shared
   *  math the server persists with, so the preview matches to the cent. */
  const shares = useMemo(() => {
    if (!snapshot) return [];
    if (!draft || !identity) return snapshot.shares;
    return buildItemizedAllocations({
      lineItems: snapshot.expense.lineItems.map((item) => {
        const others = item.assignedMemberIds.filter(
          (id) => id !== identity.memberId
        );
        return {
          total: item.total,
          assignedMemberIds: draft.has(item.lineItemId)
            ? [...others, identity.memberId]
            : others
        };
      }),
      tax: snapshot.expense.tax,
      tip: snapshot.expense.tip,
      extrasSplitMode: snapshot.expense.extrasSplitMode,
      unassignedMemberId: snapshot.payer.memberId
    }).allocations;
  }, [snapshot, draft, identity]);

  const myShare = shares.find((row) => row.memberId === identity?.memberId);
  const myAmount = completed
    ? myGuestRow?.completedAmount ?? myShare?.amount ?? 0
    : myShare?.amount ?? 0;

  // Debounced save of item toggles (guest-secret header).
  useEffect(() => {
    if (draft === null || !identity) return;
    const timer = setTimeout(async () => {
      setSaving(true);
      try {
        const snap = await splitPublicApi.saveClaims(
          shareId,
          identity.memberId,
          identity.secret,
          Array.from(draft)
        );
        adoptSnapshot(snap);
        setDraft(null);
        setSaveError(null);
      } catch (err) {
        if (
          err instanceof ApiError &&
          (err.status === 403 || err.status === 404)
        ) {
          clearSplitGuest(shareId);
          setIdentity(null);
          setDraft(null);
          setSaveError(
            "This browser's saved pass no longer matches — pick your name again."
          );
        } else {
          setSaveError(
            err instanceof ApiError
              ? err.message
              : "Could not save your picks — check your connection."
          );
        }
      } finally {
        setSaving(false);
      }
    }, 700);
    return () => clearTimeout(timer);
  }, [draft, identity, shareId, adoptSnapshot]);

  const handleJoin = async (memberId?: string, name?: string) => {
    setJoining(true);
    setJoinError(null);
    try {
      const joined = await splitPublicApi.join(
        shareId,
        memberId ? { memberId } : { name }
      );
      const nextIdentity: SplitGuestIdentity = {
        memberId: joined.memberId,
        secret: joined.secret,
        displayName: joined.displayName
      };
      saveSplitGuest(shareId, nextIdentity);
      setIdentity(nextIdentity);
      setSaveError(null);
      adoptSnapshot(await splitPublicApi.get(shareId));
    } catch (err) {
      setJoinError(
        err instanceof ApiError
          ? err.message
          : "Could not join — check your connection."
      );
    } finally {
      setJoining(false);
    }
  };

  const handleJoinByName = (event: FormEvent) => {
    event.preventDefault();
    const name = joinName.trim();
    if (!name) return;
    void handleJoin(undefined, name);
  };

  /** Signed-in join: the claim session is bound to the account, and the
   *  server adds the caller to the trip first if they aren't on it. With
   *  claimMemberId, a placeholder identity merges into the account. */
  const handleAccountJoin = async (claimMemberId?: string) => {
    setJoining(true);
    setJoinError(null);
    setAccountChooserOpen(false);
    try {
      const joined = await splitLinkApi.claimSession(shareId, claimMemberId);
      const nextIdentity: SplitGuestIdentity = {
        memberId: joined.memberId,
        secret: joined.secret,
        displayName: joined.displayName
      };
      saveSplitGuest(shareId, nextIdentity);
      setIdentity(nextIdentity);
      setSaveError(null);
      adoptSnapshot(await splitPublicApi.get(shareId));
    } catch (err) {
      setJoinError(
        err instanceof ApiError
          ? err.message
          : "Could not link your account — check your connection."
      );
    } finally {
      setJoining(false);
    }
  };

  const toggleItem = (lineItemId: string) => {
    if (!identity || completed) return;
    setCompleteError(null);
    setDraft((current) => {
      const next = new Set(current ?? selection);
      if (next.has(lineItemId)) {
        next.delete(lineItemId);
      } else {
        next.add(lineItemId);
      }
      return next;
    });
  };

  const handleComplete = async () => {
    if (!identity) return;
    setCompleting(true);
    setCompleteError(null);
    try {
      adoptSnapshot(
        await splitPublicApi.complete(shareId, identity.memberId, identity.secret)
      );
    } catch (err) {
      setCompleteError(
        err instanceof ApiError
          ? err.message
          : "Could not mark this paid — check your connection."
      );
    } finally {
      setCompleting(false);
    }
  };

  const handleUncomplete = async () => {
    if (!identity) return;
    setCompleting(true);
    setCompleteError(null);
    try {
      adoptSnapshot(
        await splitPublicApi.uncomplete(
          shareId,
          identity.memberId,
          identity.secret
        )
      );
    } catch (err) {
      setCompleteError(
        err instanceof ApiError
          ? err.message
          : "Could not undo — check your connection."
      );
    } finally {
      setCompleting(false);
    }
  };

  // ------------------------------------------------------------- render
  const chrome = (children: ReactNode) => (
    <div className="pub-shell">
      <div className="pub-inner pub-header">
        <a href="/about" style={{ textDecoration: "none" }}>
          <span className="shell-wordmark">
            <span className="shell-wordmark__the">The</span>
            <span className="shell-wordmark__stack">Stack</span>
            <span className="shell-wordmark__core">Core</span>
          </span>
        </a>
        <nav className="pub-nav" aria-label="App">
          <a href="/">Open the app</a>
        </nav>
      </div>
      <main className="pub-inner pub-main">{children}</main>
      <div className="pub-inner">
        <footer className="pub-footer">
          <span>© 2026 Hunter Adam</span>
          <span>
            Bill splitting by <a href="/about">The Stack Core</a>
          </span>
        </footer>
      </div>
    </div>
  );

  if (loading) {
    return chrome(
      <div>
        <p className="pub-eyebrow">Split the bill</p>
        <p className="pub-lede">Fetching the receipt…</p>
      </div>
    );
  }

  if (loadError || !snapshot || !expense) {
    return chrome(
      <div>
        <p className="pub-eyebrow">Split the bill</p>
        <h1 className="pub-title">
          That link went <em>quiet.</em>
        </h1>
        <p className="pub-lede">{loadError ?? "Nothing to show here."}</p>
      </div>
    );
  }

  const payerName = nameOf(snapshot.payer.memberId);
  const paymentMethods = orderedPayableMethods(snapshot.payer.paymentMethods);
  const paymentNote = `Split · ${expense.description}`;
  const itemsSubtotal = expense.lineItems.reduce(
    (sum, item) => sum + item.total,
    0
  );
  const extrasTotal = (expense.tax ?? 0) + (expense.tip ?? 0);

  const panelStyle = {
    border: "1px solid rgba(148,163,184,0.18)",
    borderRadius: "1rem",
    padding: "1.1rem 1.25rem",
    background: "var(--surface-2, rgba(15,23,42,0.6))",
    marginTop: "1.25rem"
  } as const;

  return chrome(
    <div style={{ maxWidth: "40rem" }}>
      <p className="pub-eyebrow">Split the bill</p>
      <h1 className="pub-title">{expense.description}</h1>
      <p className="pub-lede">
        {expense.vendor ? `${expense.vendor} · ` : ""}
        {formatAmount.format(expense.total)} paid by {payerName}.
        {" Tap what you had — tax"}
        {expense.tip ? " and tip are" : " is"}
        {expense.extrasSplitMode === "even"
          ? " split evenly."
          : " added in proportion to your part of the bill."}
      </p>

      {/* WHO ARE YOU */}
      {!identity && (
        <section style={panelStyle} aria-label="Pick your name">
          <h2 style={{ marginTop: 0, fontSize: "1.05rem" }}>Who are you?</h2>
          {account && !accountChooserOpen && (
            <div style={{ marginBottom: "0.9rem" }}>
              <button
                type="button"
                className="primary"
                disabled={joining}
                onClick={() => {
                  // If the payer pre-added people by name, the account might
                  // BE one of them — ask before creating a second identity.
                  if (snapshot.members.some((m) => m.placeholder)) {
                    setAccountChooserOpen(true);
                  } else {
                    void handleAccountJoin();
                  }
                }}
              >
                {joining ? "Linking…" : `Continue as ${account.name}`}
              </button>
              <p
                className="muted"
                style={{ margin: "0.4rem 0 0", fontSize: "0.8rem" }}
              >
                Your claims and payment link to your Stack Core account — if
                you&rsquo;re not on this trip yet, you&rsquo;ll be added.
              </p>
            </div>
          )}
          {account && accountChooserOpen && (
            <div style={{ marginBottom: "0.9rem" }}>
              <p style={{ margin: "0 0 0.5rem" }}>
                Were you already added by name? Picking yourself moves those
                claims onto your account.
              </p>
              <div
                style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}
              >
                {snapshot.members
                  .filter((member) => member.placeholder)
                  .map((member) => (
                    <button
                      key={member.memberId}
                      type="button"
                      className="secondary"
                      disabled={joining}
                      onClick={() => void handleAccountJoin(member.memberId)}
                    >
                      I&rsquo;m {member.displayName}
                    </button>
                  ))}
                <button
                  type="button"
                  className="primary"
                  disabled={joining}
                  onClick={() => void handleAccountJoin()}
                >
                  {joining ? "Linking…" : "No, I'm new here"}
                </button>
              </div>
            </div>
          )}
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
            {snapshot.members.map((member) => {
              const palette = seedAvatar(member.memberId);
              return (
                <button
                  key={member.memberId}
                  type="button"
                  className="secondary"
                  disabled={joining}
                  onClick={() => void handleJoin(member.memberId)}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "0.45rem"
                  }}
                >
                  <span
                    aria-hidden="true"
                    style={{
                      background: palette.bg,
                      color: palette.fg,
                      borderRadius: "999px",
                      width: "1.5rem",
                      height: "1.5rem",
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: "0.7rem",
                      fontWeight: 700
                    }}
                  >
                    {getInitials(member.displayName)}
                  </span>
                  {member.displayName}
                  {member.memberId === snapshot.payer.memberId && (
                    <span className="muted" style={{ fontSize: "0.75rem" }}>
                      paid the bill
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          <form
            onSubmit={handleJoinByName}
            style={{
              display: "flex",
              gap: "0.5rem",
              marginTop: "0.9rem",
              flexWrap: "wrap",
              alignItems: "flex-end"
            }}
          >
            <div className="input-group" style={{ flex: "1 1 12rem" }}>
              <label htmlFor="split-join-name">Not on the list?</label>
              <input
                id="split-join-name"
                value={joinName}
                maxLength={60}
                placeholder="Your name"
                onChange={(e) => setJoinName(e.target.value)}
              />
            </div>
            <button
              type="submit"
              className="primary"
              disabled={joining || !joinName.trim()}
            >
              {joining ? "Joining…" : "That's me →"}
            </button>
          </form>
          {!account && (
            <p
              className="muted"
              style={{ margin: "0.9rem 0 0", fontSize: "0.8rem" }}
            >
              Have a Stack Core account?{" "}
              <a href="/" target="_blank" rel="noreferrer">
                Sign in over in the app
              </a>{" "}
              and come back — this page will notice and link your claims to
              your account.
            </p>
          )}
          {joinError && <p style={{ color: "#f87171" }}>{joinError}</p>}
          {saveError && <p style={{ color: "#f87171" }}>{saveError}</p>}
        </section>
      )}

      {identity && (
        <p className="muted" style={{ marginTop: "1rem" }}>
          Claiming as <strong>{identity.displayName}</strong>
          {myGuestRow?.verified && (
            <span title="Linked to your Stack Core account"> · linked ✓</span>
          )}
          {" · "}
          <button
            type="button"
            className="secondary"
            style={{ paddingInline: "0.6rem", fontSize: "0.8rem" }}
            onClick={() => {
              clearSplitGuest(shareId);
              setIdentity(null);
              setDraft(null);
            }}
          >
            Not you?
          </button>
          {account && myGuestRow && !myGuestRow.verified && (
            <>
              {" "}
              <button
                type="button"
                className="secondary"
                style={{ paddingInline: "0.6rem", fontSize: "0.8rem" }}
                disabled={joining}
                title="Moves these claims onto your Stack Core account"
                onClick={() =>
                  void handleAccountJoin(
                    snapshot.members.find(
                      (m) => m.memberId === identity.memberId
                    )?.placeholder
                      ? identity.memberId
                      : undefined
                  )
                }
              >
                {joining ? "Linking…" : "Link to my account"}
              </button>
            </>
          )}
        </p>
      )}

      {/* ITEMS */}
      <section style={panelStyle} aria-label="Receipt items">
        <h2 style={{ marginTop: 0, fontSize: "1.05rem" }}>
          {identity && !completed ? "Tap what you had" : "The receipt"}
        </h2>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          {expense.lineItems.map((item) => {
            const mine = selection.has(item.lineItemId);
            const claimants = item.assignedMemberIds.filter(
              (id) => id !== identity?.memberId
            );
            const claimantNames = claimants.map((id) =>
              nameOf(id).split(/\s+/)[0]
            );
            const effectiveCount = claimants.length + (mine ? 1 : 0);
            return (
              <button
                key={item.lineItemId}
                type="button"
                disabled={!identity || completed}
                onClick={() => toggleItem(item.lineItemId)}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: "0.75rem",
                  width: "100%",
                  textAlign: "left",
                  padding: "0.7rem 0.9rem",
                  borderRadius: "0.75rem",
                  cursor: identity && !completed ? "pointer" : "default",
                  border: mine
                    ? "1px solid rgba(52,211,153,0.65)"
                    : "1px solid rgba(148,163,184,0.18)",
                  background: mine
                    ? "rgba(52,211,153,0.12)"
                    : "rgba(148,163,184,0.05)",
                  color: "inherit",
                  font: "inherit"
                }}
              >
                <span style={{ minWidth: 0 }}>
                  <span style={{ fontWeight: 600 }}>
                    {mine ? "✓ " : ""}
                    {item.description}
                    {typeof item.quantity === "number" && item.quantity > 1 && (
                      <span className="muted"> ×{item.quantity}</span>
                    )}
                  </span>
                  <span
                    className="muted"
                    style={{ display: "block", fontSize: "0.8rem" }}
                  >
                    {claimantNames.length || mine ? (
                      <>
                        {[...(mine ? ["you"] : []), ...claimantNames].join(", ")}
                        {effectiveCount > 1 && (
                          <> · split {effectiveCount} ways</>
                        )}
                      </>
                    ) : (
                      "unclaimed"
                    )}
                  </span>
                </span>
                <span style={{ fontWeight: 600, whiteSpace: "nowrap" }}>
                  {formatAmount.format(item.total)}
                </span>
              </button>
            );
          })}
        </div>
        <p
          className="muted"
          style={{ margin: "0.9rem 0 0", fontSize: "0.85rem" }}
        >
          Items {formatAmount.format(itemsSubtotal)}
          {typeof expense.tax === "number" && expense.tax > 0 && (
            <> · Tax {formatAmount.format(expense.tax)}</>
          )}
          {typeof expense.tip === "number" && expense.tip > 0 && (
            <> · Tip {formatAmount.format(expense.tip)}</>
          )}
          {" · Total "}
          {formatAmount.format(expense.total)}
        </p>
        {saveError && identity && (
          <p style={{ color: "#f87171", marginBottom: 0 }}>{saveError}</p>
        )}
      </section>

      {/* YOUR SHARE + PAY */}
      {identity && (
        <section style={panelStyle} aria-label="Your share">
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "baseline",
              gap: "1rem",
              flexWrap: "wrap"
            }}
          >
            <h2 style={{ margin: 0, fontSize: "1.05rem" }}>
              {isPayer ? "Your items" : "Your share"}
            </h2>
            <span style={{ fontSize: "1.5rem", fontWeight: 700 }}>
              {formatAmount.format(myAmount)}
              {(draft !== null || saving) && (
                <span className="muted" style={{ fontSize: "0.8rem" }}>
                  {" "}
                  {saving ? "saving…" : "…"}
                </span>
              )}
            </span>
          </div>
          {myShare && myShare.amount > 0 && (
            <p className="muted" style={{ margin: "0.35rem 0 0" }}>
              {formatAmount.format(myShare.itemsAmount)} in items
              {extrasTotal > 0 && (
                <>
                  {" + "}
                  {formatAmount.format(myShare.extrasAmount)} of the tax
                  {expense.tip ? " & tip" : ""}
                </>
              )}
            </p>
          )}

          {isPayer ? (
            <p className="muted" style={{ marginBottom: 0 }}>
              You covered this bill — anything nobody claims stays with you.
            </p>
          ) : completed ? (
            <div>
              <p style={{ color: "var(--owed, #34d399)", marginBottom: 0 }}>
                ✓ Marked as paid —{" "}
                {myGuestRow?.completedConfirmed
                  ? `${payerName} confirmed it. All settled.`
                  : `${payerName} will confirm when it lands.`}
              </p>
              {!myGuestRow?.completedConfirmed && (
                <button
                  type="button"
                  className="secondary"
                  style={{ marginTop: "0.6rem", fontSize: "0.85rem" }}
                  disabled={completing}
                  title="Removes the recorded payment and unlocks your items"
                  onClick={() => void handleUncomplete()}
                >
                  {completing ? "Undoing…" : "Undo — I haven't paid yet"}
                </button>
              )}
              {completeError && (
                <p style={{ color: "#f87171", marginBottom: 0 }}>
                  {completeError}
                </p>
              )}
            </div>
          ) : (
            <>
              {paymentMethods.length > 0 ? (
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: "0.5rem",
                    marginTop: "0.9rem"
                  }}
                >
                  {paymentMethods.map(([method, handle]) => {
                    const link = buildPaymentLink(
                      method,
                      handle,
                      myAmount,
                      expense.currency,
                      paymentNote
                    );
                    if (link) {
                      return (
                        <a
                          key={method}
                          className="primary"
                          href={link}
                          target="_blank"
                          rel="noreferrer"
                          style={{ textDecoration: "none" }}
                        >
                          Pay {payerName.split(/\s+/)[0]} with{" "}
                          {METHOD_LABELS[method] ?? method}
                        </a>
                      );
                    }
                    return (
                      <button
                        key={method}
                        type="button"
                        className="secondary"
                        onClick={() => {
                          void navigator.clipboard
                            ?.writeText(handle)
                            .then(() => {
                              setCopiedZelle(true);
                              setTimeout(() => setCopiedZelle(false), 2000);
                            });
                        }}
                      >
                        {copiedZelle
                          ? "Copied ✓"
                          : `${METHOD_LABELS[method] ?? method}: ${handle}`}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <p className="muted" style={{ marginTop: "0.9rem" }}>
                  {payerName} hasn&rsquo;t added payment handles — settle up
                  however you usually do.
                </p>
              )}
              <div style={{ marginTop: "0.9rem" }}>
                <button
                  type="button"
                  className="secondary"
                  disabled={
                    completing ||
                    saving ||
                    draft !== null ||
                    !myShare ||
                    myShare.amount <= 0
                  }
                  onClick={() => void handleComplete()}
                  title="Records the payment for the group — the payer confirms it landed"
                >
                  {completing ? "Marking…" : "I've paid — mark it done ✓"}
                </button>
                {completeError && (
                  <p style={{ color: "#f87171", marginBottom: 0 }}>
                    {completeError}
                  </p>
                )}
              </div>
            </>
          )}
        </section>
      )}

      {/* WHERE IT STANDS */}
      <section style={panelStyle} aria-label="Where it stands">
        <h2 style={{ marginTop: 0, fontSize: "1.05rem" }}>Where it stands</h2>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
          {shares.map((row) => {
            const guest = snapshot.guests.find(
              (g) => g.memberId === row.memberId
            );
            const rowIsPayer = row.memberId === snapshot.payer.memberId;
            return (
              <div
                key={row.memberId}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: "0.75rem",
                  fontSize: "0.92rem"
                }}
              >
                <span>
                  {nameOf(row.memberId)}
                  {row.memberId === identity?.memberId && " (you)"}
                  {guest?.verified && (
                    <span
                      className="muted"
                      title="Claiming from their Stack Core account"
                    >
                      {" "}
                      · linked
                    </span>
                  )}
                  {rowIsPayer && (
                    <span className="muted"> · paid the bill</span>
                  )}
                  {guest?.completedAt && !rowIsPayer && (
                    <span style={{ color: "var(--owed, #34d399)" }}> · paid ✓</span>
                  )}
                </span>
                <span style={{ fontWeight: 600 }}>
                  {formatAmount.format(row.amount)}
                </span>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
};

export default SplitClaimPage;
