import { FormEvent, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuthenticator } from "@aws-amplify/ui-react";
import { Link } from "react-router-dom";
import { api, ApiError, getProfile, updateProfile } from "../lib/api";
import type { PaymentMethods, UserProfile } from "../types";

const emptyMethods: PaymentMethods = {
  venmo: "",
  paypal: "",
  zelle: ""
};

const ProfilePage = () => {
  const queryClient = useQueryClient();
  const { user } = useAuthenticator((context) => [context.user]);
  const [methodsDraft, setMethodsDraft] = useState<PaymentMethods>(emptyMethods);
  const [message, setMessage] = useState<string | null>(null);

  const { data: profile, isLoading, error } = useQuery({
    queryKey: ["profile"],
    queryFn: () => getProfile().then((response) => response.profile)
  });

  useEffect(() => {
    if (!profile) return;
    setMethodsDraft({
      venmo: profile.paymentMethods?.venmo ?? "",
      paypal: profile.paymentMethods?.paypal ?? "",
      zelle: profile.paymentMethods?.zelle ?? ""
    });
  }, [profile]);

  const saveMutation = useMutation({
    mutationFn: (payload: Partial<Record<keyof PaymentMethods, string | null>>) =>
      updateProfile(payload).then((response) => response.profile),
    onSuccess: (updated: UserProfile) => {
      queryClient.setQueryData(["profile"], updated);
      setMessage("Payment methods saved");
    },
    onError: (err: unknown) => {
      if (err instanceof ApiError) {
        setMessage(err.message);
      } else {
        setMessage("Failed to save payment methods");
      }
    }
  });

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    setMessage(null);
    const payload: Partial<Record<keyof PaymentMethods, string | null>> = {
      venmo: methodsDraft.venmo?.trim() || null,
      paypal: methodsDraft.paypal?.trim() || null,
      zelle: methodsDraft.zelle?.trim() || null
    };
    saveMutation.mutate(payload);
  };

  const digestMutation = useMutation({
    mutationFn: (optIn: boolean) =>
      api.post<{ profile: UserProfile }>("/profile/digest", { optIn }),
    onSuccess: (response) => {
      queryClient.setQueryData(["profile"], response.profile);
    }
  });

  const notificationPrefsMutation = useMutation({
    mutationFn: (prefs: { activity?: boolean; comments?: boolean }) =>
      api.post<{ profile: UserProfile }>("/profile/notifications", prefs),
    onSuccess: (response) => {
      queryClient.setQueryData(["profile"], response.profile);
    }
  });

  const userAttributes =
    user && "attributes" in user
      ? (user as { attributes?: Record<string, string> }).attributes
      : undefined;

  const displayName = useMemo(() => {
    if (profile?.displayName) return profile.displayName;
    if (userAttributes?.name) return userAttributes.name;
    const derivedName = [userAttributes?.given_name, userAttributes?.family_name]
      .filter(Boolean)
      .join(" ")
      .trim();
    if (derivedName) return derivedName;
    return userAttributes?.email;
  }, [
    profile?.displayName,
    userAttributes?.email,
    userAttributes?.family_name,
    userAttributes?.given_name,
    userAttributes?.name
  ]);

  const email = profile?.email ?? userAttributes?.email;

  return (
    <div className="grid-two">
      <section className="card">
        <div className="section-title">
          <div>
            <h2>Your Profile</h2>
            <p className="muted">Set contact info once and reuse it across every trip.</p>
          </div>
        </div>
        {isLoading ? (
          <p className="muted">Loading profile…</p>
        ) : error ? (
          <p className="muted" style={{ color: "#f87171" }}>
            Unable to load profile
          </p>
        ) : (
          <div className="list">
            <div className="pill-row">
              <div>
                <p className="muted" style={{ margin: 0 }}>
                  Name
                </p>
                <strong>{displayName ?? "Unknown user"}</strong>
              </div>
              {email && <span className="pill"> {email} </span>}
            </div>
            <div className="card" style={{ padding: "0.9rem 1rem" }}>
              <p className="muted" style={{ margin: 0 }}>
                These payment methods are shared wherever people need to reimburse you, including in Group Expenses settlements.
              </p>
              <p className="muted" style={{ margin: "0.4rem 0 0" }}>
                Changes here update every trip automatically.
              </p>
            </div>
            <Link to="/group-expenses/trips" className="module-link" style={{ alignSelf: "flex-start" }}>
              Go to Group Expenses
            </Link>
          </div>
        )}
      </section>

      <section className="card">
        <div className="section-title">
          <div>
            <h2>Payment Methods</h2>
            <p className="muted">Visible to anyone sending you money.</p>
          </div>
        </div>
        <form className="list" onSubmit={handleSubmit}>
          <div className="input-group">
            <label htmlFor="venmo">Venmo</label>
            <input
              id="venmo"
              value={methodsDraft.venmo ?? ""}
              onChange={(event) =>
                setMethodsDraft((current) => ({ ...current, venmo: event.target.value }))
              }
              placeholder="@username"
            />
          </div>
          <div className="input-group">
            <label htmlFor="paypal">PayPal</label>
            <input
              id="paypal"
              value={methodsDraft.paypal ?? ""}
              onChange={(event) =>
                setMethodsDraft((current) => ({ ...current, paypal: event.target.value }))
              }
              placeholder="email@example.com"
            />
          </div>
          <div className="input-group">
            <label htmlFor="zelle">Zelle</label>
            <input
              id="zelle"
              value={methodsDraft.zelle ?? ""}
              onChange={(event) =>
                setMethodsDraft((current) => ({ ...current, zelle: event.target.value }))
              }
              placeholder="phone or email"
            />
          </div>
          {message && (
            <p
              style={{
                margin: 0,
                color: /fail|cannot|error|unable|invalid/i.test(message) ? "#f87171" : "#4ade80"
              }}
            >
              {message}
            </p>
          )}
          <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", flexWrap: "wrap" }}>
            <button type="submit" className="primary" disabled={saveMutation.isPending}>
              {saveMutation.isPending ? "Saving…" : "Save methods"}
            </button>
            <span className="muted">
              Leave a field empty to hide it. We never share your methods outside your groups.
            </span>
          </div>
        </form>
      </section>

      <section className="card" style={{ gridColumn: "1 / -1" }}>
        <div className="section-title">
          <div>
            <h2>Weekly digest</h2>
            <p className="muted">
              A short email every Sunday with your balances across all trips.
            </p>
          </div>
        </div>
        <label className="digest-toggle">
          <input
            type="checkbox"
            className="digest-toggle__input"
            checked={Boolean(profile?.emailDigestOptIn)}
            disabled={digestMutation.isPending || !profile?.email}
            onChange={(event) => digestMutation.mutate(event.target.checked)}
          />
          <span className="digest-toggle__track" aria-hidden="true">
            <span className="digest-toggle__thumb" />
          </span>
          <span className="digest-toggle__copy">
            <strong className="digest-toggle__title">
              {profile?.emailDigestOptIn ? "You're subscribed" : "Send me the weekly digest"}
            </strong>
            <span className="digest-toggle__sub">
              {profile?.email
                ? <>To <em>{profile.email}</em> · every Sunday morning</>
                : "Add an email to your account to enable this"}
            </span>
          </span>
        </label>
        {digestMutation.isError && (
          <p style={{ color: "#fda4af", margin: "0.6rem 0 0" }}>
            {digestMutation.error instanceof ApiError
              ? digestMutation.error.message
              : "Couldn't update — try again."}
          </p>
        )}
      </section>

      <section className="card" style={{ gridColumn: "1 / -1" }}>
        <div className="section-title">
          <div>
            <h2>Push notifications</h2>
            <p className="muted">
              Applies to the mobile app on every device you're signed into.
            </p>
          </div>
        </div>
        <label className="digest-toggle">
          <input
            type="checkbox"
            className="digest-toggle__input"
            checked={profile?.notificationPrefs?.activity !== false}
            disabled={notificationPrefsMutation.isPending}
            onChange={(event) =>
              notificationPrefsMutation.mutate({ activity: event.target.checked })
            }
          />
          <span className="digest-toggle__track" aria-hidden="true">
            <span className="digest-toggle__thumb" />
          </span>
          <span className="digest-toggle__copy">
            <strong className="digest-toggle__title">Activity</strong>
            <span className="digest-toggle__sub">
              New expenses, settlements, and people joining
            </span>
          </span>
        </label>
        <label className="digest-toggle" style={{ marginTop: "0.6rem" }}>
          <input
            type="checkbox"
            className="digest-toggle__input"
            checked={profile?.notificationPrefs?.comments !== false}
            disabled={notificationPrefsMutation.isPending}
            onChange={(event) =>
              notificationPrefsMutation.mutate({ comments: event.target.checked })
            }
          />
          <span className="digest-toggle__track" aria-hidden="true">
            <span className="digest-toggle__thumb" />
          </span>
          <span className="digest-toggle__copy">
            <strong className="digest-toggle__title">Comments</strong>
            <span className="digest-toggle__sub">
              Replies on expenses you added or commented on
            </span>
          </span>
        </label>
        {notificationPrefsMutation.isError && (
          <p style={{ color: "#fda4af", margin: "0.6rem 0 0" }}>
            {notificationPrefsMutation.error instanceof ApiError
              ? notificationPrefsMutation.error.message
              : "Couldn't update — try again."}
          </p>
        )}
      </section>
    </div>
  );
};

export default ProfilePage;
