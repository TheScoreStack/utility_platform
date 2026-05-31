import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";
import { TripStore } from "../data/tripStore.js";
import { UserStore } from "../data/userStore.js";
import { convertCurrency } from "../lib/fx.js";
import type { Expense, Settlement, TripMember } from "../types.js";

const tripStore = new TripStore();
const userStore = new UserStore();
const sesClient = new SESClient({});

const FROM_EMAIL = process.env.DIGEST_FROM_EMAIL || "";
const APP_URL = process.env.APP_URL || "https://thestackcore.com";

const roundCents = (n: number) => Math.round(n * 100) / 100;

const computeUserBalance = (
  userId: string,
  members: TripMember[],
  expenses: Expense[],
  settlements: Settlement[],
  tripCurrency: string
): number => {
  let balance = 0;
  for (const expense of expenses) {
    const expCurrency = expense.currency || tripCurrency;
    if (expense.paidByMemberId === userId) {
      balance += convertCurrency(expense.total, expCurrency, tripCurrency);
    }
    for (const allocation of expense.allocations) {
      if (allocation.memberId === userId) {
        balance -= convertCurrency(allocation.amount, expCurrency, tripCurrency);
      }
    }
  }
  for (const settlement of settlements) {
    if (!settlement.confirmedAt) continue;
    const cur = settlement.currency || tripCurrency;
    const amt = convertCurrency(settlement.amount, cur, tripCurrency);
    if (settlement.fromMemberId === userId) balance += amt;
    if (settlement.toMemberId === userId) balance -= amt;
  }
  // mark members var as used (members[] not currently needed beyond auth scope)
  void members;
  return roundCents(balance);
};

interface UserDigest {
  userId: string;
  email: string;
  displayName: string;
  totalOwed: number;          // sum of negative balances (you owe in these trips)
  totalOwedToYou: number;     // sum of positive balances
  pendingCount: number;
  perTrip: Array<{
    tripName: string;
    tripCurrency: string;
    balance: number;          // in trip currency
    pending: number;          // pending settlements involving user
  }>;
}

const formatMoney = (amount: number, currency: string): string =>
  new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(amount);

const buildHtmlBody = (digest: UserDigest): string => {
  const greeting = digest.displayName.split(/\s+/)[0] || "friend";
  const rows = digest.perTrip
    .map((trip) => {
      const tone =
        trip.balance < -0.01 ? "#c2410c" : trip.balance > 0.01 ? "#15803d" : "#475569";
      const sign = trip.balance > 0 ? "+" : "";
      return `
        <tr>
          <td style="padding: 10px 12px; border-bottom: 1px solid #e5e7eb;">${escapeHtml(trip.tripName)}</td>
          <td style="padding: 10px 12px; border-bottom: 1px solid #e5e7eb; text-align: right; color: ${tone}; font-variant-numeric: tabular-nums;">
            ${sign}${formatMoney(trip.balance, trip.tripCurrency)}
          </td>
          <td style="padding: 10px 12px; border-bottom: 1px solid #e5e7eb; text-align: right; color: #6b7280;">
            ${trip.pending > 0 ? `${trip.pending} pending` : "—"}
          </td>
        </tr>
      `;
    })
    .join("");

  return `<!doctype html>
<html>
<head><meta charset="utf-8" /><title>Your weekly tab</title></head>
<body style="font-family: -apple-system, 'Segoe UI', sans-serif; background: #f8f5ee; color: #1f2937; margin: 0; padding: 32px 16px;">
  <table role="presentation" style="max-width: 600px; margin: 0 auto; background: #fff; border-radius: 14px; padding: 32px; border: 1px solid rgba(0,0,0,0.06);">
    <tr><td>
      <p style="margin: 0; color: #6b7280; letter-spacing: 0.18em; text-transform: uppercase; font-size: 11px; font-weight: 600;">Your weekly tab</p>
      <h1 style="font-family: Georgia, serif; font-style: italic; font-size: 28px; margin: 6px 0 4px; color: #111827; font-weight: 400;">Hey ${escapeHtml(greeting)},</h1>
      <p style="font-family: Georgia, serif; font-style: italic; color: #6b7280; margin: 0;">Here's where you stand across your tabs.</p>

      <table role="presentation" style="width: 100%; margin: 24px 0 0; border-collapse: collapse;">
        <tr>
          <td style="padding: 8px 0; color: #6b7280; font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase;">You owe</td>
          <td style="padding: 8px 0; text-align: right; font-family: Georgia, serif; font-size: 22px; color: #c2410c; font-variant-numeric: tabular-nums;">
            ${digest.totalOwed > 0 ? `$${digest.totalOwed.toFixed(2)}` : "—"}
          </td>
        </tr>
        <tr>
          <td style="padding: 8px 0; color: #6b7280; font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase;">You're owed</td>
          <td style="padding: 8px 0; text-align: right; font-family: Georgia, serif; font-size: 22px; color: #15803d; font-variant-numeric: tabular-nums;">
            ${digest.totalOwedToYou > 0 ? `$${digest.totalOwedToYou.toFixed(2)}` : "—"}
          </td>
        </tr>
        <tr>
          <td style="padding: 8px 0; color: #6b7280; font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase;">Pending confirmations</td>
          <td style="padding: 8px 0; text-align: right; font-family: Georgia, serif; font-size: 22px; color: #1f2937; font-variant-numeric: tabular-nums;">
            ${digest.pendingCount > 0 ? digest.pendingCount : "—"}
          </td>
        </tr>
      </table>

      <h2 style="font-family: Georgia, serif; font-style: italic; font-size: 17px; color: #111827; margin: 28px 0 8px; font-weight: 400; border-bottom: 1px dashed rgba(0,0,0,0.16); padding-bottom: 6px;">Per tab</h2>
      <table role="presentation" style="width: 100%; border-collapse: collapse; font-size: 14px;">
        <thead>
          <tr>
            <th style="text-align: left; padding: 8px 12px; color: #6b7280; font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; border-bottom: 1px solid #e5e7eb;">Trip</th>
            <th style="text-align: right; padding: 8px 12px; color: #6b7280; font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; border-bottom: 1px solid #e5e7eb;">Your balance</th>
            <th style="text-align: right; padding: 8px 12px; color: #6b7280; font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; border-bottom: 1px solid #e5e7eb;">Pending</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>

      <p style="margin: 28px 0 0;">
        <a href="${APP_URL}/group-expenses/trips" style="display: inline-block; padding: 12px 22px; border-radius: 999px; background: linear-gradient(135deg, #38bdf8, #6366f1); color: #fff; text-decoration: none; font-weight: 600; font-size: 14px;">Open your tabs</a>
      </p>

      <p style="margin: 32px 0 0; color: #9ca3af; font-size: 12px; font-family: Georgia, serif; font-style: italic; text-align: center;">
        You're getting this because email digests are on. Turn them off any time on your profile.
      </p>
    </td></tr>
  </table>
</body>
</html>`;
};

const escapeHtml = (s: string): string =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const buildDigestForUser = async (
  user: { userId: string; email: string; displayName: string }
): Promise<UserDigest | null> => {
  const trips = await tripStore.listTripsForMember(user.userId);
  if (!trips.length) return null;

  let totalOwed = 0;
  let totalOwedToYou = 0;
  let pendingCount = 0;
  const perTrip: UserDigest["perTrip"] = [];

  for (const trip of trips) {
    const details = await tripStore.getTripDetails(trip.tripId);
    if (details.trip.archivedAt) continue;
    const balance = computeUserBalance(
      user.userId,
      details.members,
      details.expenses,
      details.settlements,
      details.trip.currency
    );
    const pending = details.settlements.filter(
      (s) =>
        !s.confirmedAt &&
        (s.fromMemberId === user.userId || s.toMemberId === user.userId)
    ).length;
    if (Math.abs(balance) < 0.01 && pending === 0) continue;
    perTrip.push({
      tripName: details.trip.name,
      tripCurrency: details.trip.currency,
      balance,
      pending
    });
    if (balance < -0.01) totalOwed += Math.abs(balance);
    if (balance > 0.01) totalOwedToYou += balance;
    pendingCount += pending;
  }

  if (perTrip.length === 0) return null;

  perTrip.sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance));

  return {
    userId: user.userId,
    email: user.email,
    displayName: user.displayName,
    totalOwed: roundCents(totalOwed),
    totalOwedToYou: roundCents(totalOwedToYou),
    pendingCount,
    perTrip
  };
};

export const handler = async () => {
  if (!FROM_EMAIL) {
    console.warn(
      "[weeklyDigest] DIGEST_FROM_EMAIL not set — skipping send. Verify an SES identity and set the env var to enable."
    );
    return { sent: 0, skipped: 0, reason: "no-from-email" };
  }

  const subscribers = await userStore.listEmailDigestSubscribers();
  console.log(`[weeklyDigest] ${subscribers.length} opted-in users`);

  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const profile of subscribers) {
    if (!profile.email) {
      skipped += 1;
      continue;
    }
    const digest = await buildDigestForUser({
      userId: profile.userId,
      email: profile.email,
      displayName: profile.displayName || profile.email
    });
    if (!digest) {
      skipped += 1;
      continue;
    }
    try {
      await sesClient.send(
        new SendEmailCommand({
          Source: FROM_EMAIL,
          Destination: { ToAddresses: [digest.email] },
          Message: {
            Subject: {
              Data: digest.totalOwed > 0
                ? `Your weekly tab — $${digest.totalOwed.toFixed(2)} to settle`
                : digest.totalOwedToYou > 0
                  ? `Your weekly tab — $${digest.totalOwedToYou.toFixed(2)} owed back`
                  : "Your weekly tab"
            },
            Body: {
              Html: { Data: buildHtmlBody(digest) }
            }
          }
        })
      );
      sent += 1;
    } catch (err) {
      console.error(`[weeklyDigest] failed to send to ${digest.email}`, err);
      failed += 1;
    }
  }

  console.log(
    `[weeklyDigest] sent=${sent} skipped=${skipped} failed=${failed}`
  );
  return { sent, skipped, failed };
};
