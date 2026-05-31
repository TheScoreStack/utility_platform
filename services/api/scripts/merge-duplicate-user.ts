/**
 * One-off remediation: merge an orphaned duplicate Cognito-sub UserProfile into
 * the canonical one for hunter.j.adam@gmail.com.
 *
 * Run with:
 *   AWS_PROFILE=default npx tsx services/api/scripts/merge-duplicate-user.ts --dry-run
 *   AWS_PROFILE=default npx tsx services/api/scripts/merge-duplicate-user.ts --apply
 */
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand
} from "@aws-sdk/lib-dynamodb";

const TABLE = "GroupExpensesStack-ExpensesTableD91D50C8-OAQ6H4UPSH7Z";
const DUPE = "34d8d4d8-e071-708e-4df8-b50fc5a7fc36";
const CANON = "845814d8-4041-703a-3a21-b671c42876c1";
const TRIP_ID = "trip_LuIMCU_-r5";

const dry = !process.argv.includes("--apply");
const client = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region: "us-east-1" })
);

const log = (msg: string, payload?: unknown) => {
  const prefix = dry ? "[dry-run]" : "[apply]";
  console.log(prefix, msg, payload ? JSON.stringify(payload) : "");
};

async function remapTripMember() {
  const memberKey = {
    PK: `TRIP#${TRIP_ID}`,
    SK: `MEMBER#${DUPE}`
  };

  const existing = await client.send(
    new GetCommand({ TableName: TABLE, Key: memberKey })
  );
  if (!existing.Item) {
    log("dupe TripMember not found — skip");
    return;
  }

  const canonExists = await client.send(
    new GetCommand({
      TableName: TABLE,
      Key: { PK: `TRIP#${TRIP_ID}`, SK: `MEMBER#${CANON}` }
    })
  );
  if (canonExists.Item) {
    log("canonical already a member of trip — deleting dupe only");
    if (!dry) {
      await client.send(new DeleteCommand({ TableName: TABLE, Key: memberKey }));
    }
    return;
  }

  const newItem = {
    ...existing.Item,
    SK: `MEMBER#${CANON}`,
    memberId: CANON,
    GSI1PK: `MEMBER#${CANON}`
  };

  log("creating new TripMember for canonical", { SK: newItem.SK });
  log("deleting dupe TripMember", memberKey);

  if (!dry) {
    await client.send(new PutCommand({ TableName: TABLE, Item: newItem }));
    await client.send(new DeleteCommand({ TableName: TABLE, Key: memberKey }));
  }
}

async function remapExpenses() {
  const { Items } = await client.send(
    new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
      ExpressionAttributeValues: {
        ":pk": `TRIP#${TRIP_ID}`,
        ":sk": "EXPENSE#"
      }
    })
  );

  for (const item of Items ?? []) {
    const expenseId = item.expenseId as string;
    let touched = false;
    const updates: string[] = [];
    const values: Record<string, unknown> = {};

    if (item.paidByMemberId === DUPE) {
      updates.push("paidByMemberId = :paid");
      values[":paid"] = CANON;
      touched = true;
    }

    const shared = item.sharedWithMemberIds as string[] | undefined;
    if (shared?.includes(DUPE)) {
      const replaced = shared.map((id) => (id === DUPE ? CANON : id));
      updates.push("sharedWithMemberIds = :shared");
      values[":shared"] = replaced;
      touched = true;
    }

    const allocations = item.allocations as
      | Array<{ memberId: string; amount: number }>
      | undefined;
    if (allocations?.some((a) => a.memberId === DUPE)) {
      const replaced = allocations.map((a) =>
        a.memberId === DUPE ? { ...a, memberId: CANON } : a
      );
      updates.push("allocations = :alloc");
      values[":alloc"] = replaced;
      touched = true;
    }

    if (!touched) continue;

    log(`expense ${expenseId}: ${updates.join(", ")}`);

    if (!dry) {
      await client.send(
        new UpdateCommand({
          TableName: TABLE,
          Key: { PK: `TRIP#${TRIP_ID}`, SK: `EXPENSE#${expenseId}` },
          UpdateExpression: `SET ${updates.join(", ")}`,
          ExpressionAttributeValues: values
        })
      );
    }
  }
}

async function remapSettlements() {
  const { Items } = await client.send(
    new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
      ExpressionAttributeValues: {
        ":pk": `TRIP#${TRIP_ID}`,
        ":sk": "SETTLEMENT#"
      }
    })
  );

  for (const item of Items ?? []) {
    const settlementId = item.settlementId as string;
    const updates: string[] = [];
    const values: Record<string, unknown> = {};

    if (item.fromMemberId === DUPE) {
      updates.push("fromMemberId = :from");
      values[":from"] = CANON;
    }
    if (item.toMemberId === DUPE) {
      updates.push("toMemberId = :to");
      values[":to"] = CANON;
    }
    if (item.createdBy === DUPE) {
      updates.push("createdBy = :cb");
      values[":cb"] = CANON;
    }

    if (!updates.length) continue;

    log(`settlement ${settlementId}: ${updates.join(", ")}`);

    if (!dry) {
      await client.send(
        new UpdateCommand({
          TableName: TABLE,
          Key: { PK: `TRIP#${TRIP_ID}`, SK: `SETTLEMENT#${settlementId}` },
          UpdateExpression: `SET ${updates.join(", ")}`,
          ExpressionAttributeValues: values
        })
      );
    }
  }
}

async function deleteDupeProfile() {
  log("deleting orphaned UserProfile", { userId: DUPE });
  if (!dry) {
    await client.send(
      new DeleteCommand({
        TableName: TABLE,
        Key: { PK: `USER#${DUPE}`, SK: "PROFILE" }
      })
    );
  }
}

async function main() {
  console.log(`Mode: ${dry ? "DRY RUN" : "APPLY"}`);
  console.log(`Dupe userId : ${DUPE}`);
  console.log(`Canonical   : ${CANON}`);
  console.log(`Trip        : ${TRIP_ID}`);
  console.log("");

  await remapTripMember();
  await remapExpenses();
  await remapSettlements();
  await deleteDupeProfile();

  console.log("\nDone.");
  if (dry) {
    console.log("Re-run with --apply to commit.");
  }
}

main().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
