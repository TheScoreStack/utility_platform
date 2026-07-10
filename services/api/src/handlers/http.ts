import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { TripService } from "../services/tripService.js";
import { UserService } from "../services/userService.js";
import { pushService } from "../services/pushService.js";
import { HarmonyLedgerService } from "../services/harmonyLedgerService.js";
import { StackTimeService } from "../services/stackTimeService.js";
import { MeetService } from "../services/meetService.js";
import { SplitLinkService } from "../services/splitLinkService.js";
import { getAuthContext } from "../auth.js";
import {
  handleError,
  json,
  parseBody,
  preflightResponse,
  corsHeaders
} from "../lib/http.js";
import { ValidationError } from "../lib/errors.js";

const tripService = new TripService();
const userService = new UserService();
const harmonyLedgerService = new HarmonyLedgerService();
const stackTimeService = new StackTimeService();
const meetService = new MeetService();
const splitLinkService = new SplitLinkService();
const ok = (body: unknown, origin: string): APIGatewayProxyResultV2 =>
  json(200, body, origin);
const created = (body: unknown, origin: string): APIGatewayProxyResultV2 =>
  json(201, body, origin);
const noContent = (origin: string): APIGatewayProxyResultV2 => ({
  statusCode: 204,
  headers: corsHeaders(origin)
});

const parseAllowedOrigins = (): string[] => {
  if (process.env.ALLOWED_ORIGINS) {
    return process.env.ALLOWED_ORIGINS.split(",")
      .map(origin => origin.trim())
      .filter(Boolean);
  }

  if (process.env.ALLOWED_ORIGIN) {
    return [process.env.ALLOWED_ORIGIN];
  }

  return ["http://localhost:5173"];
};

const allowedOrigins = parseAllowedOrigins();
const DEFAULT_ORIGIN = allowedOrigins[0];

const getOrigin = (event: APIGatewayProxyEventV2): string => {
  const requestOrigin = event.headers?.origin ?? event.headers?.Origin;
  if (requestOrigin && allowedOrigins.includes(requestOrigin)) {
    return requestOrigin;
  }
  return DEFAULT_ORIGIN;
};

export const handler = async (
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> => {
  const origin = getOrigin(event);
  try {
    if (event.requestContext.http.method === "OPTIONS") {
      return preflightResponse(origin);
    }

    const path = event.requestContext.http.path ?? event.rawPath;
    const method = event.requestContext.http.method;

    // Public Meet respond-page routes have no gateway authorizer and must be
    // dispatched before getAuthContext, which throws when unauthenticated.
    const meetPublicMatch = path.match(/^\/meet-public\/([^/]+)(?:\/(.*))?$/);
    if (meetPublicMatch) {
      const slug = decodeURIComponent(meetPublicMatch[1]);
      const remainder = meetPublicMatch[2] ? `/${meetPublicMatch[2]}` : "";

      if (!remainder && method === "GET") {
        const response = await meetService.getPublicEvent(
          slug,
          event.queryStringParameters?.since
        );
        return ok(response, origin);
      }

      if (remainder === "/participants" && method === "POST") {
        const body = parseBody(event);
        const response = await meetService.joinPublicEvent(slug, body);
        return created(response, origin);
      }

      const guestAvailabilityMatch = remainder.match(
        /^\/participants\/([^/]+)\/availability$/
      );
      if (guestAvailabilityMatch && method === "PUT") {
        const participantId = decodeURIComponent(guestAvailabilityMatch[1]);
        const body = parseBody(event);
        const secret = event.headers?.["x-meet-participant-secret"];
        const participant = await meetService.putGuestAvailability(
          slug,
          participantId,
          secret,
          body
        );
        return ok({ participant }, origin);
      }

      return json(404, { message: "Not Found" }, origin);
    }

    // Public split-link routes: guests claim receipt items and mark payment
    // without an account. Same capability model as meet-public — unguessable
    // shareId to read, per-guest secret to write.
    const splitPublicMatch = path.match(/^\/split-public\/([^/]+)(?:\/(.*))?$/);
    if (splitPublicMatch) {
      const shareId = decodeURIComponent(splitPublicMatch[1]);
      const remainder = splitPublicMatch[2] ? `/${splitPublicMatch[2]}` : "";
      const guestSecret = event.headers?.["x-split-guest-secret"];

      if (!remainder && method === "GET") {
        const snapshot = await splitLinkService.getPublicSnapshot(shareId);
        return ok(snapshot, origin);
      }

      if (remainder === "/guests" && method === "POST") {
        const body = parseBody(event);
        const response = await splitLinkService.join(shareId, body);
        return created(response, origin);
      }

      const guestClaimsMatch = remainder.match(/^\/guests\/([^/]+)\/claims$/);
      if (guestClaimsMatch && method === "PUT") {
        const memberId = decodeURIComponent(guestClaimsMatch[1]);
        const body = parseBody(event);
        const snapshot = await splitLinkService.updateClaims(
          shareId,
          memberId,
          guestSecret,
          body
        );
        return ok(snapshot, origin);
      }

      const guestCompleteMatch = remainder.match(
        /^\/guests\/([^/]+)\/(complete|uncomplete)$/
      );
      if (guestCompleteMatch && method === "POST") {
        const memberId = decodeURIComponent(guestCompleteMatch[1]);
        const snapshot =
          guestCompleteMatch[2] === "complete"
            ? await splitLinkService.complete(shareId, memberId, guestSecret)
            : await splitLinkService.uncomplete(shareId, memberId, guestSecret);
        return ok(snapshot, origin);
      }

      return json(404, { message: "Not Found" }, origin);
    }

    const auth = getAuthContext(event);

    // Signed-in split-link join: binds the claim session to the caller's
    // account (adding them to the trip first if needed).
    const splitSessionMatch = path.match(/^\/split-links\/([^/]+)\/session$/);
    if (splitSessionMatch && method === "POST") {
      const shareId = decodeURIComponent(splitSessionMatch[1]);
      const body = parseBody(event);
      const response = await splitLinkService.joinWithAccount(
        shareId,
        body,
        auth
      );
      return created(response, origin);
    }

    if (path === "/meet/events" && method === "POST") {
      const body = parseBody(event);
      const meetEvent = await meetService.createEvent(body, auth);
      return created({ event: meetEvent }, origin);
    }

    if (path === "/meet/events" && method === "GET") {
      const events = await meetService.listEvents(auth);
      return ok({ events }, origin);
    }

    const meetEventMatch = path.match(/^\/meet\/events\/([^/]+)(?:\/(.*))?$/);
    if (meetEventMatch) {
      const eventId = decodeURIComponent(meetEventMatch[1]);
      const remainder = meetEventMatch[2] ? `/${meetEventMatch[2]}` : "";

      if (!remainder && method === "GET") {
        const detail = await meetService.getEvent(eventId, auth);
        return ok(detail, origin);
      }

      if (!remainder && method === "PATCH") {
        const body = parseBody(event);
        const meetEvent = await meetService.updateEvent(eventId, body, auth);
        return ok({ event: meetEvent }, origin);
      }

      if (!remainder && method === "DELETE") {
        await meetService.deleteEvent(eventId, auth);
        return noContent(origin);
      }

      if (remainder === "/finalize" && method === "POST") {
        const body = parseBody(event);
        const meetEvent = await meetService.finalizeEvent(eventId, body, auth);
        return ok({ event: meetEvent }, origin);
      }

      if (remainder === "/reopen" && method === "POST") {
        const meetEvent = await meetService.reopenEvent(eventId, auth);
        return ok({ event: meetEvent }, origin);
      }

      if (remainder === "/availability" && method === "PUT") {
        const body = parseBody(event);
        const participant = await meetService.putMyAvailability(
          eventId,
          body,
          auth
        );
        return ok({ participant }, origin);
      }
    }

    if (method === "GET" && path === "/users") {
      const users = await userService.searchUsers(
        event.queryStringParameters ?? {},
        auth
      );
      return ok({ users }, origin);
    }

    if (path === "/profile" && method === "GET") {
      const profile = await userService.getProfile(auth);
      return ok({ profile }, origin);
    }

    if (path === "/profile" && method === "PATCH") {
      const body = parseBody(event);
      const profile = await userService.updateProfile(body, auth);
      return ok({ profile }, origin);
    }

    if (path === "/profile/digest" && method === "POST") {
      const body = parseBody(event);
      const profile = await userService.setEmailDigestPreference(body, auth);
      return ok({ profile }, origin);
    }

    if (path === "/profile/notifications" && method === "POST") {
      const body = parseBody(event);
      const profile = await userService.setNotificationPrefs(body, auth);
      return ok({ profile }, origin);
    }

    if (path === "/profile" && method === "DELETE") {
      await userService.deleteAccount(auth);
      return noContent(origin);
    }

    if (path === "/devices" && method === "POST") {
      const body = parseBody(event);
      await pushService.registerDevice(body, auth);
      return created({ ok: true }, origin);
    }
    const deviceMatch = path.match(/^\/devices\/([^/]+)$/);
    if (deviceMatch && method === "DELETE") {
      await pushService.unregisterDevice(
        decodeURIComponent(deviceMatch[1]),
        auth
      );
      return noContent(origin);
    }

    if (path === "/harmony-ledger/access" && method === "GET") {
      const response = await harmonyLedgerService.getAccessOverview(auth);
      return ok(response, origin);
    }

    if (path === "/harmony-ledger/access" && method === "POST") {
      const body = parseBody(event);
      const record = await harmonyLedgerService.addAccess(body, auth);
      return created(record, origin);
    }

    const harmonyAccessMatch = path.match(/^\/harmony-ledger\/access\/([^/]+)$/);
    if (harmonyAccessMatch && method === "DELETE") {
      await harmonyLedgerService.removeAccess(harmonyAccessMatch[1], auth);
      return noContent(origin);
    }

    if (harmonyAccessMatch && method === "PATCH") {
      const body = parseBody(event);
      if (!body) {
        return handleError(new ValidationError("Request body required"), origin);
      }
      const record = await harmonyLedgerService.updateAccessRole(
        decodeURIComponent(harmonyAccessMatch[1]),
        body,
        auth
      );
      return ok(record, origin);
    }

    if (path === "/harmony-ledger/groups" && method === "GET") {
      const groups = await harmonyLedgerService.listGroups(auth);
      return ok({ groups }, origin);
    }

    if (path === "/harmony-ledger/groups" && method === "POST") {
      const body = parseBody(event);
      const group = await harmonyLedgerService.createGroup(body, auth);
      return created(group, origin);
    }

    const harmonyGroupMatch = path.match(/^\/harmony-ledger\/groups\/([^/]+)$/);
    if (harmonyGroupMatch && method === "PATCH") {
      const body = parseBody(event);
      if (!body) {
        return handleError(new ValidationError("Request body required"), origin);
      }
      const group = await harmonyLedgerService.updateGroup(
        decodeURIComponent(harmonyGroupMatch[1]),
        body,
        auth
      );
      return ok(group, origin);
    }

    if (path === "/harmony-ledger/entries" && method === "GET") {
      const data = await harmonyLedgerService.getEntries(auth);
      return ok(data, origin);
    }

    if (path === "/harmony-ledger/overview" && method === "GET") {
      const overview = await harmonyLedgerService.getOverview(auth);
      return ok(overview, origin);
    }

    if (path === "/harmony-ledger/entries" && method === "POST") {
      const body = parseBody(event);
      const entry = await harmonyLedgerService.createEntry(body, auth);
      return created(entry, origin);
    }

    const harmonyEntryMatch = path.match(/^\/harmony-ledger\/entries\/([^/]+)$/);
    if (harmonyEntryMatch && method === "PATCH") {
      const entryId = decodeURIComponent(harmonyEntryMatch[1]);
      const body = parseBody(event);
      if (!body) {
        return handleError(new ValidationError("Request body required"), origin);
      }
      const entry = await harmonyLedgerService.updateEntry(entryId, body, auth);
      return ok(entry, origin);
    }

    if (harmonyEntryMatch && method === "DELETE") {
      const entryId = decodeURIComponent(harmonyEntryMatch[1]);
      const body = parseBody(event);
      if (!body) {
        return handleError(new ValidationError("Request body required"), origin);
      }
      await harmonyLedgerService.deleteEntry(entryId, body, auth);
      return noContent(origin);
    }

    if (path === "/harmony-ledger/transfers" && method === "POST") {
      const body = parseBody(event);
      const transfer = await harmonyLedgerService.createTransfer(body, auth);
      return created(transfer, origin);
    }

    const transferMatch = path.match(/^\/harmony-ledger\/transfers\/([^/]+)$/);
    if (transferMatch && method === "DELETE") {
      const transferId = decodeURIComponent(transferMatch[1]);
      const body = parseBody(event);
      if (!body) {
        return handleError(new ValidationError("Request body required"), origin);
      }
      await harmonyLedgerService.deleteTransfer(transferId, body, auth);
      return noContent(origin);
    }

    if (path === "/harmony-ledger/recurring" && method === "GET") {
      const templates = await harmonyLedgerService.listRecurringTemplates(auth);
      return ok({ templates }, origin);
    }

    if (path === "/harmony-ledger/recurring" && method === "POST") {
      const body = parseBody(event);
      const template = await harmonyLedgerService.createRecurringTemplate(
        body,
        auth
      );
      return created(template, origin);
    }

    const recurringMatch = path.match(/^\/harmony-ledger\/recurring\/([^/]+)$/);
    if (recurringMatch && method === "PATCH") {
      const body = parseBody(event);
      if (!body) {
        return handleError(new ValidationError("Request body required"), origin);
      }
      const template = await harmonyLedgerService.updateRecurringTemplate(
        decodeURIComponent(recurringMatch[1]),
        body,
        auth
      );
      return ok(template, origin);
    }

    if (recurringMatch && method === "DELETE") {
      await harmonyLedgerService.deleteRecurringTemplate(
        decodeURIComponent(recurringMatch[1]),
        auth
      );
      return noContent(origin);
    }

    if (path === "/harmony-ledger/statements" && method === "POST") {
      const body = parseBody(event);
      const response = await harmonyLedgerService.createStatement(body, auth);
      return created(response, origin);
    }

    if (path === "/harmony-ledger/statements" && method === "GET") {
      const statements = await harmonyLedgerService.listStatements(auth);
      return ok({ statements }, origin);
    }

    const statementMatch = path.match(/^\/harmony-ledger\/statements\/([^/]+)$/);
    if (statementMatch && method === "GET") {
      const detail = await harmonyLedgerService.getStatementDetail(
        decodeURIComponent(statementMatch[1]),
        auth
      );
      return ok(detail, origin);
    }

    if (statementMatch && method === "DELETE") {
      await harmonyLedgerService.deleteStatement(
        decodeURIComponent(statementMatch[1]),
        auth
      );
      return noContent(origin);
    }

    const statementFileMatch = path.match(
      /^\/harmony-ledger\/statements\/([^/]+)\/file$/
    );
    if (statementFileMatch && method === "GET") {
      const file = await harmonyLedgerService.getStatementFileUrl(
        decodeURIComponent(statementFileMatch[1]),
        auth
      );
      return ok(file, origin);
    }

    const statementRetryMatch = path.match(
      /^\/harmony-ledger\/statements\/([^/]+)\/retry$/
    );
    if (statementRetryMatch && method === "POST") {
      const statement = await harmonyLedgerService.retryStatement(
        decodeURIComponent(statementRetryMatch[1]),
        auth
      );
      return ok({ statement }, origin);
    }

    const stagedTxnMatch = path.match(
      /^\/harmony-ledger\/statements\/([^/]+)\/transactions\/([^/]+)\/(confirm|dismiss|reopen|unconfirm)$/
    );
    if (stagedTxnMatch && method === "POST") {
      const statementId = decodeURIComponent(stagedTxnMatch[1]);
      const txnId = decodeURIComponent(stagedTxnMatch[2]);
      const body = parseBody(event);
      if (!body) {
        return handleError(new ValidationError("Request body required"), origin);
      }
      if (stagedTxnMatch[3] === "confirm") {
        const result = await harmonyLedgerService.confirmStagedTransaction(
          statementId,
          txnId,
          body,
          auth
        );
        return ok(result, origin);
      }
      const transaction =
        stagedTxnMatch[3] === "reopen"
          ? await harmonyLedgerService.reopenStagedTransaction(
              statementId,
              txnId,
              body,
              auth
            )
          : stagedTxnMatch[3] === "unconfirm"
            ? await harmonyLedgerService.unconfirmStagedTransaction(
                statementId,
                txnId,
                body,
                auth
              )
            : await harmonyLedgerService.dismissStagedTransaction(
                statementId,
                txnId,
                body,
                auth
              );
      return ok({ transaction }, origin);
    }

    const bulkConfirmMatch = path.match(
      /^\/harmony-ledger\/statements\/([^/]+)\/confirm-all$/
    );
    if (bulkConfirmMatch && method === "POST") {
      const result = await harmonyLedgerService.bulkConfirmStagedTransactions(
        decodeURIComponent(bulkConfirmMatch[1]),
        parseBody(event),
        auth
      );
      return ok(result, origin);
    }

    // Stack Time routes
    if (path === "/stack-time/access" && method === "GET") {
      const response = await stackTimeService.getAccessOverview(auth);
      return ok(response, origin);
    }

    if (path === "/stack-time/access" && method === "POST") {
      const body = parseBody(event);
      const record = await stackTimeService.addAccess(body, auth);
      return created(record, origin);
    }

    const stackTimeAccessMatch = path.match(/^\/stack-time\/access\/([^/]+)$/);
    if (stackTimeAccessMatch && method === "DELETE") {
      await stackTimeService.removeAccess(stackTimeAccessMatch[1], auth);
      return noContent(origin);
    }

    if (path === "/stack-time/projects" && method === "GET") {
      const projects = await stackTimeService.listProjects(auth);
      return ok({ projects }, origin);
    }

    if (path === "/stack-time/projects" && method === "POST") {
      const body = parseBody(event);
      const project = await stackTimeService.createProject(body, auth);
      return created(project, origin);
    }

    const stackTimeProjectMatch = path.match(/^\/stack-time\/projects\/([^/]+)$/);
    if (stackTimeProjectMatch && method === "PATCH") {
      const projectId = decodeURIComponent(stackTimeProjectMatch[1]);
      const body = parseBody(event);
      const project = await stackTimeService.updateProject(projectId, body, auth);
      return ok(project, origin);
    }

    if (path === "/stack-time/entries" && method === "GET") {
      const query = event.queryStringParameters ?? {};
      const response = await stackTimeService.listEntries(auth, {
        startDate: query.startDate,
        endDate: query.endDate,
        userId: query.userId
      });
      return ok(response, origin);
    }

    if (path === "/stack-time/entries" && method === "POST") {
      const body = parseBody(event);
      const entry = await stackTimeService.createEntry(body, auth);
      return created(entry, origin);
    }

    const stackTimeEntryMatch = path.match(/^\/stack-time\/entries\/([^/]+)$/);
    if (stackTimeEntryMatch && method === "PATCH") {
      const entryId = decodeURIComponent(stackTimeEntryMatch[1]);
      const body = parseBody(event);
      if (!body) {
        return handleError(new ValidationError("Request body required"), origin);
      }
      const entry = await stackTimeService.updateEntry(entryId, body, auth);
      return ok(entry, origin);
    }

    if (stackTimeEntryMatch && method === "DELETE") {
      const entryId = decodeURIComponent(stackTimeEntryMatch[1]);
      const body = parseBody(event);
      if (!body) {
        return handleError(new ValidationError("Request body required"), origin);
      }
      await stackTimeService.deleteEntry(entryId, body, auth);
      return noContent(origin);
    }

    if (path === "/stack-time/reports/by-project" && method === "GET") {
      const query = event.queryStringParameters ?? {};
      const report = await stackTimeService.getReportByProject(auth, {
        startDate: query.startDate,
        endDate: query.endDate
      });
      return ok({ report }, origin);
    }

    if (path === "/stack-time/reports/by-person" && method === "GET") {
      const query = event.queryStringParameters ?? {};
      const report = await stackTimeService.getReportByPerson(auth, {
        startDate: query.startDate,
        endDate: query.endDate
      });
      return ok({ report }, origin);
    }

    if (path === "/stack-time/reports/timeline" && method === "GET") {
      const query = event.queryStringParameters ?? {};
      const stats = await stackTimeService.getTimelineStats(auth, {
        startDate: query.startDate,
        endDate: query.endDate
      });
      return ok(stats, origin);
    }

    if (path === "/stack-time/entries/team" && method === "GET") {
      const query = event.queryStringParameters ?? {};
      const response = await stackTimeService.listTeamEntries(auth, {
        startDate: query.startDate,
        endDate: query.endDate
      });
      return ok(response, origin);
    }

    if (method === "GET" && path === "/trips") {
      const trips = await tripService.listTrips(auth);
      return ok({ trips }, origin);
    }

    if (method === "POST" && path === "/trips") {
      const body = parseBody(event);
      const trip = await tripService.createTrip(body, auth);
      return created(trip, origin);
    }

    const tripMatch = path.match(/^\/trips\/([^/]+)(?:\/(.*))?$/);
    if (tripMatch) {
      const tripId = decodeURIComponent(tripMatch[1]);
      const remainder = tripMatch[2] ? `/${tripMatch[2]}` : "";

      if (!remainder && method === "GET") {
        const summary = await tripService.getTripSummary(tripId, auth);
        return ok(summary, origin);
      }

      if (!remainder && method === "PATCH") {
        const body = parseBody(event);
        const trip = await tripService.updateTrip(tripId, body, auth);
        return ok(trip, origin);
      }

      if (remainder === "/archive" && method === "POST") {
        await tripService.archiveTrip(tripId, auth);
        return noContent(origin);
      }

      if (remainder === "/unarchive" && method === "POST") {
        await tripService.unarchiveTrip(tripId, auth);
        return noContent(origin);
      }

      if (remainder === "/invite" && method === "GET") {
        const invite = await tripService.getTripInvite(tripId, auth);
        return ok({ invite }, origin);
      }

      if (remainder === "/invite" && method === "POST") {
        const invite = await tripService.createOrRotateInvite(tripId, auth);
        return created({ invite }, origin);
      }

      if (remainder === "/invite" && method === "DELETE") {
        await tripService.revokeInvite(tripId, auth);
        return noContent(origin);
      }

      if (remainder === "/members" && method === "POST") {
        const body = parseBody(event);
        const members = await tripService.addMembers(tripId, body, auth);
        return created({ members }, origin);
      }
      if (remainder === "/members/payment-methods" && method === "PATCH") {
        const body = parseBody(event);
        await tripService.updatePaymentMethods(tripId, body, auth);
        return noContent(origin);
      }
      const memberClaimMatch = remainder.match(/^\/members\/([^/]+)\/claim$/);
      if (memberClaimMatch && method === "POST") {
        const memberId = decodeURIComponent(memberClaimMatch[1]);
        await tripService.claimPlaceholder(tripId, memberId, auth);
        return noContent(origin);
      }

      const memberMatch = remainder.match(/^\/members\/([^/]+)$/);
      if (memberMatch && method === "DELETE") {
        const memberId = decodeURIComponent(memberMatch[1]);
        await tripService.removeMember(tripId, memberId, auth);
        return noContent(origin);
      }

      if (remainder === "/expenses" && method === "POST") {
        const body = parseBody(event);
        const expense = await tripService.createExpense(tripId, body, auth);
        return created(expense, origin);
      }

      const expenseRestoreMatch = remainder.match(/^\/expenses\/([^/]+)\/restore$/);
      if (expenseRestoreMatch && method === "POST") {
        const expenseId = decodeURIComponent(expenseRestoreMatch[1]);
        await tripService.restoreExpense(tripId, expenseId, auth);
        return noContent(origin);
      }
      const expensePurgeMatch = remainder.match(/^\/expenses\/([^/]+)\/purge$/);
      if (expensePurgeMatch && method === "DELETE") {
        const expenseId = decodeURIComponent(expensePurgeMatch[1]);
        await tripService.purgeExpense(tripId, expenseId, auth);
        return noContent(origin);
      }

      const splitLinkMatch = remainder.match(/^\/expenses\/([^/]+)\/split-link$/);
      if (splitLinkMatch && method === "GET") {
        // Fetch-or-create, like the trip invite link.
        const expenseId = decodeURIComponent(splitLinkMatch[1]);
        const link = await splitLinkService.getOrCreateSplitLink(
          tripId,
          expenseId,
          auth
        );
        return ok({ link }, origin);
      }
      if (splitLinkMatch && method === "DELETE") {
        const expenseId = decodeURIComponent(splitLinkMatch[1]);
        await splitLinkService.revokeSplitLink(tripId, expenseId, auth);
        return noContent(origin);
      }

      const commentsListMatch = remainder.match(/^\/expenses\/([^/]+)\/comments$/);
      if (commentsListMatch && method === "GET") {
        const expenseId = decodeURIComponent(commentsListMatch[1]);
        const comments = await tripService.listExpenseComments(tripId, expenseId, auth);
        return ok({ comments }, origin);
      }
      if (commentsListMatch && method === "POST") {
        const expenseId = decodeURIComponent(commentsListMatch[1]);
        const body = parseBody(event);
        const comment = await tripService.createExpenseComment(
          tripId,
          expenseId,
          body,
          auth
        );
        return created(comment, origin);
      }

      const commentItemMatch = remainder.match(
        /^\/expenses\/([^/]+)\/comments\/([^/]+)$/
      );
      if (commentItemMatch && method === "DELETE") {
        const expenseId = decodeURIComponent(commentItemMatch[1]);
        const commentId = decodeURIComponent(commentItemMatch[2]);
        await tripService.deleteExpenseComment(tripId, expenseId, commentId, auth);
        return noContent(origin);
      }

      const expenseMatch = remainder.match(/^\/expenses\/([^/]+)$/);
      if (expenseMatch && method === "PATCH") {
        const expenseId = decodeURIComponent(expenseMatch[1]);
        const body = parseBody(event);
        await tripService.updateExpense(tripId, expenseId, body, auth);
        return noContent(origin);
      }
      if (expenseMatch && method === "DELETE") {
        const expenseId = decodeURIComponent(expenseMatch[1]);
        await tripService.deleteExpense(tripId, expenseId, auth);
        return noContent(origin);
      }

      if (remainder === "/receipts" && method === "POST") {
        const body = parseBody(event);
        const receipt = await tripService.createReceipt(tripId, body, auth);
        return created(receipt, origin);
      }

      if (remainder === "/receipts/analyze" && method === "POST") {
        const body = parseBody(event);
        const extraction = await tripService.analyzeReceiptLive(tripId, body, auth);
        return ok({ extraction }, origin);
      }

      const receiptRecordMatch = remainder.match(
        /^\/receipts\/([^/]+)\/record$/
      );
      if (receiptRecordMatch && method === "GET") {
        const receiptId = decodeURIComponent(receiptRecordMatch[1]);
        const receipt = await tripService.getReceipt(tripId, receiptId, auth);
        return ok(receipt, origin);
      }

      const receiptMatch = remainder.match(/^\/receipts\/([^/]+)$/);
      if (receiptMatch && method === "GET") {
        const receiptId = decodeURIComponent(receiptMatch[1]);
        const url = await tripService.getReceiptDownloadUrl(tripId, receiptId, auth);
        return ok(url, origin);
      }

      if (remainder === "/recurring" && method === "POST") {
        const body = parseBody(event);
        const template = await tripService.createRecurringExpense(
          tripId,
          body,
          auth
        );
        return created(template, origin);
      }
      const recurringMatch = remainder.match(/^\/recurring\/([^/]+)$/);
      if (recurringMatch && method === "DELETE") {
        const recurringId = decodeURIComponent(recurringMatch[1]);
        await tripService.deleteRecurringExpense(tripId, recurringId, auth);
        return noContent(origin);
      }

      if (remainder === "/settlements" && method === "POST") {
        const body = parseBody(event);
        const settlement = await tripService.recordSettlement(tripId, body, auth);
        return created(settlement, origin);
      }

      const settlementRestoreMatch = remainder.match(/^\/settlements\/([^/]+)\/restore$/);
      if (settlementRestoreMatch && method === "POST") {
        const settlementId = decodeURIComponent(settlementRestoreMatch[1]);
        await tripService.restoreSettlement(tripId, settlementId, auth);
        return noContent(origin);
      }
      const settlementPurgeMatch = remainder.match(/^\/settlements\/([^/]+)\/purge$/);
      if (settlementPurgeMatch && method === "DELETE") {
        const settlementId = decodeURIComponent(settlementPurgeMatch[1]);
        await tripService.purgeSettlement(tripId, settlementId, auth);
        return noContent(origin);
      }

      const settlementMatch = remainder.match(/^\/settlements\/([^/]+)$/);
      if (settlementMatch && method === "PATCH") {
        const settlementId = decodeURIComponent(settlementMatch[1]);
        const body = parseBody(event);
        // Same route serves two updates: {confirmed} toggles confirmation,
        // anything else edits the settlement's fields.
        if (
          body &&
          typeof body === "object" &&
          "confirmed" in (body as Record<string, unknown>)
        ) {
          await tripService.confirmSettlement(tripId, settlementId, body, auth);
        } else {
          await tripService.updateSettlement(tripId, settlementId, body, auth);
        }
        return noContent(origin);
      }
      if (settlementMatch && method === "DELETE") {
        const settlementId = decodeURIComponent(settlementMatch[1]);
        await tripService.deleteSettlement(tripId, settlementId, auth);
        return noContent(origin);
      }
    }

    const inviteMatch = path.match(/^\/invites\/([^/]+)(?:\/(redeem))?$/);
    if (inviteMatch) {
      const inviteId = decodeURIComponent(inviteMatch[1]);
      const action = inviteMatch[2];
      if (!action && method === "GET") {
        const preview = await tripService.previewInvite(inviteId, auth);
        return ok(preview, origin);
      }
      if (action === "redeem" && method === "POST") {
        const body = parseBody(event);
        const result = await tripService.redeemInvite(inviteId, body, auth);
        return ok(result, origin);
      }
    }

    return json(404, { message: "Not Found" }, origin);
  } catch (error) {
    return handleError(
      error,
      origin,
      `${event.requestContext.http.method} ${event.requestContext.http.path ?? event.rawPath}`
    );
  }
};
