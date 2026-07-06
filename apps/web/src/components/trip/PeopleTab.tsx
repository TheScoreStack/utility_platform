import { useEffect, useMemo, useState } from "react";
import { orderedPayableMethods } from "../../lib/paymentLinks";
import { OvAvatar } from "./OvAvatar";
import type { PaymentMethods, TripInvite, TripSummary, UserProfile } from "../../types";
import { useConfirm } from "../ConfirmDialog";

export type PaymentMethodsInput = {
  venmo?: string | null;
  paypal?: string | null;
  zelle?: string | null;
  primary?: "venmo" | "paypal" | "zelle" | null;
};

interface InviteLinkBoxProps {
  inviteId: string;
  canManage: boolean;
  onRotate: () => Promise<unknown>;
  onRevoke: () => Promise<unknown>;
  rotating: boolean;
  revoking: boolean;
}

const InviteLinkBox = ({
  inviteId,
  canManage,
  onRotate,
  onRevoke,
  rotating,
  revoking
}: InviteLinkBoxProps) => {
  const confirm = useConfirm();
  const [copied, setCopied] = useState(false);
  const url =
    typeof window !== "undefined"
      ? `${window.location.origin}/group-expenses/join/${inviteId}`
      : `/group-expenses/join/${inviteId}`;

  return (
    <div className="ppl-invite">
      <div className="ppl-invite__url-row">
        <code className="ppl-invite__url" title={url}>
          {url}
        </code>
        <button
          type="button"
          className={`ppl-invite__copy ${copied ? "ppl-invite__copy--copied" : ""}`}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(url);
              setCopied(true);
              setTimeout(() => setCopied(false), 1400);
            } catch {
              /* clipboard write blocked — non-fatal */
            }
          }}
        >
          {copied ? "✓ copied" : "Copy"}
        </button>
      </div>
      {canManage && (
        <div className="ppl-invite__actions">
          <button
            type="button"
            className="ppl-invite__action ppl-invite__action--rotate"
            disabled={rotating}
            title="Generate a fresh link — the current one stops working."
            onClick={async () => {
              const ok = await confirm({
                title: "Rotate the invite link?",
                body: "Anyone holding the old link won't be able to join.",
                confirmLabel: "Rotate link"
              });
              if (!ok) return;
              void onRotate();
            }}
          >
            {rotating ? "Rotating…" : "Rotate ↻"}
          </button>
          <button
            type="button"
            className="ppl-invite__action ppl-invite__action--revoke"
            disabled={revoking}
            title="Disable the link entirely."
            onClick={async () => {
              const ok = await confirm({
                title: "Revoke the invite link?",
                body: "No one new can join until you create another one.",
                confirmLabel: "Revoke",
                tone: "danger"
              });
              if (!ok) return;
              void onRevoke();
            }}
          >
            {revoking ? "Revoking…" : "Revoke"}
          </button>
        </div>
      )}
    </div>
  );
};

// Click-to-copy chip used in PeopleTab member rows
const PplPayChip = ({ method, value }: { method: string; value: string }) => {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={`ppl-method-chip ${copied ? "ppl-method-chip--copied" : ""}`}
      title={`Copy ${value}`}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1400);
        } catch {
          /* clipboard write blocked — non-fatal */
        }
      }}
    >
      <span className="ppl-method-chip__key">{method}</span>
      <span>{copied ? "✓ copied" : value}</span>
    </button>
  );
};

interface PeopleTabProps {
  members: TripSummary["members"];
  memberSearchTerm: string;
  onMemberSearchTermChange: (value: string) => void;
  searchResults: UserProfile[];
  searchMessage: string | null;
  feedbackMessage: string | null;
  onAddMember: (userId: string) => void;
  onAddPlaceholder: (name: string) => void;
  addLoading: boolean;
  canManageMembers: boolean;
  ownerId: string;
  onRemoveMember: (memberId: string) => Promise<void>;
  removeLoading: boolean;
  removingMemberId?: string;
  currentUserId?: string;
  membersById: Record<string, string>;
  paymentMethodsByMember: Record<string, PaymentMethods>;
  onSavePaymentMethods: (methods: PaymentMethodsInput) => void;
  paymentMethodsMessage: string | null;
  savingPaymentMethods: boolean;
  invite: TripInvite | null;
  inviteLoading: boolean;
  onCreateOrRotateInvite: () => Promise<unknown>;
  onRevokeInvite: () => Promise<unknown>;
  inviteSaving: boolean;
  inviteRevoking: boolean;
}

export const PeopleTab = ({
  members,
  memberSearchTerm,
  onMemberSearchTermChange,
  searchResults,
  searchMessage,
  feedbackMessage,
  onAddMember,
  onAddPlaceholder,
  addLoading,
  canManageMembers,
  ownerId,
  onRemoveMember,
  removeLoading,
  removingMemberId,
  currentUserId,
  membersById,
  paymentMethodsByMember,
  onSavePaymentMethods,
  paymentMethodsMessage,
  savingPaymentMethods,
  invite,
  inviteLoading,
  onCreateOrRotateInvite,
  onRevokeInvite,
  inviteSaving,
  inviteRevoking
}: PeopleTabProps) => {
  const confirm = useConfirm();
  const editableMemberId = useMemo(
    () => members.find((member) => member.memberId === currentUserId)?.memberId,
    [members, currentUserId]
  );

  const [methodDraft, setMethodDraft] = useState<PaymentMethods>({});
  const [placeholderName, setPlaceholderName] = useState("");

  useEffect(() => {
    if (!editableMemberId) {
      setMethodDraft({});
      return;
    }
    setMethodDraft(paymentMethodsByMember[editableMemberId] ?? {});
  }, [editableMemberId, paymentMethodsByMember]);

  const filledDraftKeys = (["venmo", "paypal", "zelle"] as const).filter((key) =>
    (methodDraft[key] ?? "").trim()
  );

  const handleSave = () => {
    if (!editableMemberId) return;
    // Preference must point at a filled handle; a single handle is
    // automatically the preference.
    const chosen =
      methodDraft.primary && filledDraftKeys.includes(methodDraft.primary)
        ? methodDraft.primary
        : filledDraftKeys.length === 1
          ? filledDraftKeys[0]
          : null;
    const payload: PaymentMethodsInput = {
      venmo: (methodDraft.venmo ?? "").trim() || null,
      paypal: (methodDraft.paypal ?? "").trim() || null,
      zelle: (methodDraft.zelle ?? "").trim() || null,
      primary: chosen
    };
    onSavePaymentMethods(payload);
  };

  return (
    <div className="ppl-page">
      <header className="ppl-head ov-rise ov-rise-1">
        <span className="ppl-head__eyebrow">Guestbook</span>
        <h2 className="ppl-head__title">
          Who&rsquo;s <em>on the tab.</em>
        </h2>
        <p className="ppl-head__sub">
          Everyone here can be paid through this group&rsquo;s settlements.
        </p>
        <div className="ppl-head__rule" aria-hidden="true" />
      </header>

      <div className="ppl-grid">
        {/* MAIN — members list */}
        <section className="ppl-members ov-rise ov-rise-2">
          <div className="ppl-section-head">
            <h3 className="ppl-section-head__title">Members</h3>
            <span className="ppl-section-head__count">
              {members.length} {members.length === 1 ? "person" : "people"}
            </span>
          </div>

          {members.length === 0 ? (
            <div className="empty-state">
              <p className="empty-state__title">Nobody yet.</p>
              <p className="empty-state__hint">
                Search for people on the right to bring them in.
              </p>
            </div>
          ) : (
            <div className="ppl-member-list">
              {members.map((member) => {
                const canRemove =
                  canManageMembers && member.memberId !== ownerId;
                const isSelf = member.memberId === currentUserId;
                const isOwner = member.memberId === ownerId;
                const label =
                  membersById[member.memberId] ??
                  member.displayName ??
                  member.email ??
                  member.memberId;
                const methods = paymentMethodsByMember[member.memberId];
                const methodEntries = orderedPayableMethods(methods);

                return (
                  <article
                    key={member.memberId}
                    className={`ppl-member ${isSelf ? "ppl-member--self" : ""}`}
                  >
                    <OvAvatar
                      name={label}
                      memberId={member.memberId}
                      isSelf={isSelf}
                    />

                    <div className="ppl-member__body">
                      <div className="ppl-member__id">
                        <h4 className="ppl-member__name">
                          {label}
                          {isSelf && <em className="ppl-member__self">· you</em>}
                        </h4>
                        <div className="ppl-member__tags">
                          {isOwner && (
                            <span className="ppl-member__tag ppl-member__tag--owner">
                              Owner
                            </span>
                          )}
                          {member.placeholder && (
                            <span
                              className="ppl-member__tag"
                              title="Added by name — they'll claim this spot when they join from the invite link"
                              style={{
                                background: "rgba(250,204,21,0.15)",
                                color: "#fde68a"
                              }}
                            >
                              Hasn&rsquo;t joined yet
                            </span>
                          )}
                        </div>
                      </div>
                      {member.email && (
                        <p className="ppl-member__email">{member.email}</p>
                      )}
                      {methodEntries.length > 0 ? (
                        <div className="ppl-member__methods">
                          {methodEntries.map(([method, value]) => (
                            <PplPayChip
                              key={method}
                              method={
                                methods?.primary === method
                                  ? `${method} ★`
                                  : method
                              }
                              value={value}
                            />
                          ))}
                        </div>
                      ) : (
                        <p className="ppl-member__no-methods">
                          No payment methods on file.
                        </p>
                      )}
                    </div>

                    {canRemove && (
                      <button
                        type="button"
                        className="ppl-member__remove"
                        disabled={
                          removeLoading && removingMemberId === member.memberId
                        }
                        onClick={async () => {
                          const ok = await confirm({
                            title: `Remove ${label}?`,
                            body: "They'll be taken off this trip. Their past expenses stay on the books.",
                            confirmLabel: "Remove",
                            tone: "danger"
                          });
                          if (!ok) return;
                          onRemoveMember(member.memberId).catch(() => {});
                        }}
                      >
                        {removeLoading && removingMemberId === member.memberId
                          ? "removing…"
                          : "remove"}
                      </button>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </section>

        {/* RAIL — search + payment methods */}
        <aside className="ppl-rail">
          <section className="ppl-panel ov-rise ov-rise-2">
            <h3 className="ppl-panel__title">
              Bring <em>someone in.</em>
            </h3>
            <p className="ppl-panel__sub">
              Search by email — they&rsquo;ll show up in the group with their saved
              payment methods.
            </p>

            <div className="ppl-search">
              <input
                id="member-search"
                className="ppl-search__input"
                value={memberSearchTerm}
                onChange={(event) => onMemberSearchTermChange(event.target.value)}
                placeholder="Search by name or email"
              />
            </div>

            {searchMessage && (
              <p className="ppl-msg ppl-msg--muted">{searchMessage}</p>
            )}
            {feedbackMessage && (
              <p
                className={`ppl-msg ${
                  /fail|cannot|error/i.test(feedbackMessage)
                    ? "ppl-msg--error"
                    : "ppl-msg--ok"
                }`}
              >
                {feedbackMessage}
              </p>
            )}

            {searchResults.length > 0 && (
              <div className="ppl-search-results">
                {searchResults.map((user) => {
                  const alreadyMember = members.some(
                    (member) => member.memberId === user.userId
                  );
                  const name =
                    user.displayName ?? user.email ?? user.userId;
                  return (
                    <div key={user.userId} className="ppl-search-result">
                      <OvAvatar
                        name={name}
                        memberId={user.userId}
                        size="sm"
                        isSelf={user.userId === currentUserId}
                      />
                      <div className="ppl-search-result__body">
                        <span className="ppl-search-result__name">
                          {name}
                          {user.userId === currentUserId && (
                            <em
                              style={{
                                color: "#94a3b8",
                                fontWeight: 400,
                                marginLeft: "0.35rem"
                              }}
                            >
                              · you
                            </em>
                          )}
                        </span>
                        {user.email && (
                          <span className="ppl-search-result__email">
                            {user.email}
                          </span>
                        )}
                      </div>
                      <button
                        type="button"
                        className="ppl-search-result__add"
                        disabled={addLoading || alreadyMember}
                        onClick={() => onAddMember(user.userId)}
                      >
                        {alreadyMember ? "✓ in" : "Add"}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            <div
              style={{
                marginTop: "1rem",
                paddingTop: "1rem",
                borderTop: "1px solid rgba(148,163,184,0.12)"
              }}
            >
              <p className="ppl-panel__sub" style={{ marginBottom: "0.5rem" }}>
                No account yet? Add them by name — they can claim their spot
                later from the invite link, keeping everything assigned to them.
              </p>
              <form
                style={{ display: "flex", gap: "0.5rem" }}
                onSubmit={(event) => {
                  event.preventDefault();
                  const name = placeholderName.trim();
                  if (!name) return;
                  onAddPlaceholder(name);
                  setPlaceholderName("");
                }}
              >
                <input
                  className="ppl-search__input"
                  style={{ flex: 1 }}
                  value={placeholderName}
                  onChange={(event) => setPlaceholderName(event.target.value)}
                  placeholder="e.g. Sarah"
                  maxLength={60}
                />
                <button
                  type="submit"
                  className="secondary"
                  disabled={addLoading || !placeholderName.trim()}
                  style={{ paddingInline: "0.85rem" }}
                >
                  Add
                </button>
              </form>
            </div>
          </section>

          <section className="ppl-panel ov-rise ov-rise-3">
            <h3 className="ppl-panel__title">
              How to <em>pay you.</em>
            </h3>
            <p className="ppl-panel__sub">
              Group members will see these when they record a settlement to you.
            </p>

            {!editableMemberId ? (
              <div className="empty-state" style={{ padding: "1.2rem" }}>
                <p
                  className="empty-state__hint"
                  style={{ marginTop: 0, fontStyle: "italic" }}
                >
                  Join the trip first to add your handles.
                </p>
              </div>
            ) : (
              <div className="ppl-methods">
                {(
                  [
                    { key: "venmo", label: "Venmo", letter: "V", placeholder: "@hunter" },
                    { key: "paypal", label: "PayPal", letter: "P", placeholder: "you@mail.com" },
                    { key: "zelle", label: "Zelle", letter: "Z", placeholder: "phone or email" }
                  ] as const
                ).map(({ key, label, letter, placeholder }) => (
                  <div key={key} className="ppl-method-field">
                    <span className={`ppl-method-field__letter ppl-method-field__letter--${key}`}>
                      {letter}
                    </span>
                    <div className="ppl-method-field__body">
                      <label
                        className="ppl-method-field__label"
                        htmlFor={`method-${key}`}
                      >
                        {label}
                      </label>
                      <input
                        id={`method-${key}`}
                        className="ppl-method-field__input"
                        value={methodDraft[key] ?? ""}
                        onChange={(event) =>
                          setMethodDraft((current) => ({
                            ...current,
                            [key]: event.target.value
                          }))
                        }
                        placeholder={placeholder}
                      />
                    </div>
                  </div>
                ))}

                {filledDraftKeys.length > 1 && (
                  <div style={{ marginTop: "0.35rem" }}>
                    <p className="ppl-panel__sub" style={{ marginBottom: "0.4rem" }}>
                      Preferred — shown first when someone pays you.
                    </p>
                    <div style={{ display: "flex", gap: "0.9rem", flexWrap: "wrap" }}>
                      {filledDraftKeys.map((key) => (
                        <label
                          key={key}
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "0.35rem",
                            fontSize: "0.85rem",
                            textTransform: "capitalize",
                            cursor: "pointer"
                          }}
                        >
                          <input
                            type="radio"
                            name="preferred-method"
                            checked={methodDraft.primary === key}
                            onChange={() =>
                              setMethodDraft((current) => ({
                                ...current,
                                primary: key
                              }))
                            }
                          />
                          {key}
                        </label>
                      ))}
                    </div>
                  </div>
                )}

                {paymentMethodsMessage && (
                  <p
                    className={`ppl-msg ${
                      /fail|cannot|error|unable|invalid/i.test(
                        paymentMethodsMessage
                      )
                        ? "ppl-msg--error"
                        : "ppl-msg--ok"
                    }`}
                  >
                    {paymentMethodsMessage}
                  </p>
                )}

                <button
                  type="button"
                  className="primary ppl-save"
                  onClick={handleSave}
                  disabled={savingPaymentMethods}
                >
                  {savingPaymentMethods ? "Saving…" : "Save your methods"}
                </button>
              </div>
            )}
          </section>

          <section className="ppl-panel ov-rise ov-rise-3">
            <h3 className="ppl-panel__title">
              Or share <em>a link.</em>
            </h3>
            <p className="ppl-panel__sub">
              Anyone with this link can join the trip — even if they don&rsquo;t have
              an account yet.
            </p>

            {inviteLoading ? (
              <span className="skel skel--pill" style={{ width: "100%", height: "2.4rem" }}>&nbsp;</span>
            ) : invite ? (
              <InviteLinkBox
                inviteId={invite.inviteId}
                canManage={canManageMembers}
                onRotate={onCreateOrRotateInvite}
                onRevoke={onRevokeInvite}
                rotating={inviteSaving}
                revoking={inviteRevoking}
              />
            ) : canManageMembers ? (
              <button
                type="button"
                className="primary ppl-invite-create"
                disabled={inviteSaving}
                onClick={() => {
                  void onCreateOrRotateInvite();
                }}
              >
                {inviteSaving ? "Creating…" : "Create invite link"}
              </button>
            ) : (
              <p className="ppl-invite-empty">
                The trip owner hasn&rsquo;t created a shareable link yet — ask them
                to add one.
              </p>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
};
