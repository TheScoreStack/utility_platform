import {
  BatchGetCommand,
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand
} from "@aws-sdk/lib-dynamodb";
import { getDocumentClient } from "./dynamo.js";
import { loadConfig } from "../config.js";
import { Trip, TripMember, Expense, Receipt, Settlement, PaymentMethods, TripInvite, ExpenseComment } from "../types.js";
import { NotFoundError } from "../lib/errors.js";

const keys = {
  tripPk: (tripId: string) => `TRIP#${tripId}`,
  tripSkMeta: "METADATA",
  tripSkInvitePointer: "INVITE",
  memberSk: (memberId: string) => `MEMBER#${memberId}`,
  expenseSk: (expenseId: string) => `EXPENSE#${expenseId}`,
  receiptSk: (receiptId: string) => `RECEIPT#${receiptId}`,
  settlementSk: (settlementId: string) => `SETTLEMENT#${settlementId}`,
  invitePk: (inviteId: string) => `INVITE#${inviteId}`,
  inviteSk: "METADATA",
  commentSk: (expenseId: string, commentId: string) =>
    `COMMENT#${expenseId}#${commentId}`,
  commentSkPrefix: (expenseId: string) => `COMMENT#${expenseId}#`
};

type TripEntity = Trip & {
  entityType: "Trip";
  PK: string;
  SK: string;
};

type MemberEntity = TripMember & {
  entityType: "TripMember";
  PK: string;
  SK: string;
  GSI1PK: string;
  GSI1SK: string;
  tripName: string;
  ownerId: string;
  tripStartDate?: string;
  tripEndDate?: string;
  currency: string;
  tripCreatedAt: string;
  tripUpdatedAt: string;
};

type ExpenseEntity = Expense & {
  entityType: "Expense";
  PK: string;
  SK: string;
};

type ReceiptEntity = Receipt & {
  entityType: "Receipt";
  PK: string;
  SK: string;
};

type SettlementEntity = Settlement & {
  entityType: "Settlement";
  PK: string;
  SK: string;
};

const toTrip = (item: TripEntity): Trip => ({
  tripId: item.tripId,
  ownerId: item.ownerId,
  name: item.name,
  startDate: item.startDate,
  endDate: item.endDate,
  createdAt: item.createdAt,
  updatedAt: item.updatedAt,
  currency: item.currency,
  archivedAt: (item as Trip).archivedAt,
  archivedBy: (item as Trip).archivedBy
});

export interface TripDetails {
  trip: Trip;
  members: TripMember[];
  /** Published, non-deleted expenses — the only ones that count toward balances. */
  expenses: Expense[];
  /** All members' drafts; callers must filter to the requesting user's own. */
  draftExpenses: Expense[];
  deletedExpenses: Expense[];
  receipts: Receipt[];
  settlements: Settlement[];
  deletedSettlements: Settlement[];
}

export class TripStore {
  private readonly tableName: string;
  private readonly docClient = getDocumentClient();

  constructor() {
    const config = loadConfig();
    this.tableName = config.tableName;
  }

  async createTrip(
    trip: Trip,
    ownerMember: TripMember
  ): Promise<void> {
    const tripItem: TripEntity = {
      entityType: "Trip",
      PK: keys.tripPk(trip.tripId),
      SK: keys.tripSkMeta,
      ...trip
    };

    const memberItem: MemberEntity = {
      entityType: "TripMember",
      PK: keys.tripPk(trip.tripId),
      SK: keys.memberSk(ownerMember.memberId),
      GSI1PK: `MEMBER#${ownerMember.memberId}`,
      GSI1SK: `TRIP#${trip.tripId}`,
      tripName: trip.name,
      ownerId: trip.ownerId,
      tripStartDate: trip.startDate,
      tripEndDate: trip.endDate,
      currency: trip.currency,
      tripCreatedAt: trip.createdAt,
      tripUpdatedAt: trip.updatedAt,
      ...ownerMember
    };

    await this.docClient.send(
      new TransactWriteCommand({
        TransactItems: [
          { Put: { TableName: this.tableName, Item: tripItem } },
          { Put: { TableName: this.tableName, Item: memberItem } }
        ]
      })
    );
  }

  async getTrip(tripId: string): Promise<Trip> {
    const { Item } = await this.docClient.send(
      new GetCommand({
        TableName: this.tableName,
        Key: {
          PK: keys.tripPk(tripId),
          SK: keys.tripSkMeta
        }
      })
    );

    if (!Item) {
      throw new NotFoundError(`Trip ${tripId} not found`);
    }

    return toTrip(Item as TripEntity);
  }

  async listTripsForMember(memberId: string): Promise<Trip[]> {
    const { Items } = await this.docClient.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: "GSI1",
        KeyConditionExpression: "GSI1PK = :member",
        ExpressionAttributeValues: {
          ":member": `MEMBER#${memberId}`
        }
      })
    );

    if (!Items?.length) {
      return [];
    }

    // Items already contain trip summary details.
    const trips: Trip[] = Items.map((item) => ({
      tripId: item.tripId,
      ownerId: item.ownerId,
      name: item.tripName ?? item.name,
      startDate: item.startDate,
      endDate: item.endDate,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      currency: item.currency
    }));

    return trips;
  }

  async getTripDetails(tripId: string): Promise<TripDetails> {
    const { Items } = await this.docClient.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: "PK = :pk",
        ExpressionAttributeValues: {
          ":pk": keys.tripPk(tripId)
        }
      })
    );

    if (!Items?.length) {
      throw new NotFoundError(`Trip ${tripId} not found`);
    }

    const tripRecord = Items.find((item) => item.SK === keys.tripSkMeta);
    if (!tripRecord) {
      throw new NotFoundError(`Trip ${tripId} malformed`);
    }

    const trip = toTrip(tripRecord as TripEntity);
    const members: TripMember[] = Items.filter(
      (item) => item.entityType === "TripMember"
    ).map((item) => ({
      tripId,
      memberId: item.memberId,
      displayName: item.displayName,
      email: item.email,
      addedBy: item.addedBy,
      createdAt: item.createdAt,
      placeholder: item.placeholder === true ? true : undefined,
      paymentMethods:
        item.paymentMethods ??
        (item.venmo || item.paypal || item.zelle
          ? {
              venmo: item.venmo,
              paypal: item.paypal,
              zelle: item.zelle
            }
          : undefined)
    }));

    const allExpenses: Expense[] = Items.filter(
      (item) => item.entityType === "Expense"
    ).map((item) => ({
      tripId,
      expenseId: item.expenseId,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      description: item.description,
      vendor: item.vendor,
      category: item.category,
      total: item.total,
      currency: item.currency,
      tax: item.tax,
      tip: item.tip,
      paidByMemberId: item.paidByMemberId,
      sharedWithMemberIds: item.sharedWithMemberIds,
      allocations: item.allocations,
      lineItems: item.lineItems,
      extrasSplitMode: item.extrasSplitMode,
      receiptId: item.receiptId,
      receiptPreviewUrl: item.receiptPreviewUrl,
      draft: item.draft,
      createdBy: item.createdBy,
      deletedAt: item.deletedAt,
      deletedBy: item.deletedBy
    }));
    // Drafts never reach `expenses` (and therefore never reach balances,
    // digests, or other members) — they surface only via `draftExpenses`.
    const expenses = allExpenses.filter((e) => !e.deletedAt && !e.draft);
    const draftExpenses = allExpenses.filter(
      (e) => Boolean(e.draft) && !e.deletedAt
    );
    const deletedExpenses = allExpenses
      .filter((e) => Boolean(e.deletedAt) && !e.draft)
      .sort((a, b) => (b.deletedAt ?? "").localeCompare(a.deletedAt ?? ""));

    const receipts: Receipt[] = Items.filter(
      (item) => item.entityType === "Receipt"
    ).map((item) => ({
      tripId,
      receiptId: item.receiptId,
      storageKey: item.storageKey,
      uploadUrl: item.uploadUrl,
      fileName: item.fileName,
      status: item.status,
      extractedData: item.extractedData,
      draft: item.draft,
      createdBy: item.createdBy,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt
    }));

    const allSettlements: Settlement[] = Items.filter(
      (item) => item.entityType === "Settlement"
    ).map((item) => ({
      tripId,
      settlementId: item.settlementId,
      fromMemberId: item.fromMemberId,
      toMemberId: item.toMemberId,
      amount: item.amount,
      currency: item.currency,
      note: item.note,
      createdAt: item.createdAt,
      createdBy: item.createdBy,
      confirmedAt: item.confirmedAt,
      deletedAt: item.deletedAt,
      deletedBy: item.deletedBy
    }));
    const settlements = allSettlements.filter((s) => !s.deletedAt);
    const deletedSettlements = allSettlements
      .filter((s) => Boolean(s.deletedAt))
      .sort((a, b) => (b.deletedAt ?? "").localeCompare(a.deletedAt ?? ""));

    return {
      trip,
      members,
      expenses,
      draftExpenses,
      deletedExpenses,
      receipts,
      settlements,
      deletedSettlements
    };
  }

  async archiveTrip(tripId: string, archivedBy: string): Promise<void> {
    await this.docClient.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: {
          PK: keys.tripPk(tripId),
          SK: keys.tripSkMeta
        },
        UpdateExpression:
          "SET archivedAt = :now, archivedBy = :who, updatedAt = :now",
        ExpressionAttributeValues: {
          ":now": new Date().toISOString(),
          ":who": archivedBy
        },
        ConditionExpression: "attribute_exists(PK)"
      })
    );
  }

  async unarchiveTrip(tripId: string): Promise<void> {
    await this.docClient.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: {
          PK: keys.tripPk(tripId),
          SK: keys.tripSkMeta
        },
        UpdateExpression: "REMOVE archivedAt, archivedBy SET updatedAt = :now",
        ExpressionAttributeValues: {
          ":now": new Date().toISOString()
        },
        ConditionExpression: "attribute_exists(PK)"
      })
    );
  }

  async updateTripMetadata(
    tripId: string,
    members: TripMember[],
    updates: {
      name?: string;
      startDate?: string | null;
      endDate?: string | null;
      updatedAt: string;
    }
  ): Promise<void> {
    const names: Record<string, string> = {
      "#updatedAt": "updatedAt"
    };
    const values: Record<string, unknown> = {
      ":updatedAt": updates.updatedAt
    };
    const setParts: string[] = ["#updatedAt = :updatedAt"];
    const removeParts: string[] = [];

    if (updates.name !== undefined) {
      names["#name"] = "name";
      values[":name"] = updates.name;
      setParts.push("#name = :name");
    }

    if (updates.startDate !== undefined) {
      names["#startDate"] = "startDate";
      if (updates.startDate === null) {
        removeParts.push("#startDate");
      } else {
        values[":startDate"] = updates.startDate;
        setParts.push("#startDate = :startDate");
      }
    }

    if (updates.endDate !== undefined) {
      names["#endDate"] = "endDate";
      if (updates.endDate === null) {
        removeParts.push("#endDate");
      } else {
        values[":endDate"] = updates.endDate;
        setParts.push("#endDate = :endDate");
      }
    }

    const expressions: string[] = [];
    if (setParts.length) {
      expressions.push(`SET ${setParts.join(", ")}`);
    }
    if (removeParts.length) {
      expressions.push(`REMOVE ${removeParts.join(", ")}`);
    }

    await this.docClient.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: {
          PK: keys.tripPk(tripId),
          SK: keys.tripSkMeta
        },
        UpdateExpression: expressions.join(" "),
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values
      })
    );

    const memberIds = Array.from(
      new Set(members.map((member) => member.memberId))
    );
    await Promise.all(
      memberIds.map((memberId) =>
        this.updateMemberTripMetadata(tripId, memberId, updates)
      )
    );
  }

  private async updateMemberTripMetadata(
    tripId: string,
    memberId: string,
    updates: {
      name?: string;
      startDate?: string | null;
      endDate?: string | null;
      updatedAt: string;
    }
  ): Promise<void> {
    const names: Record<string, string> = {
      "#tripUpdatedAt": "tripUpdatedAt"
    };
    const values: Record<string, unknown> = {
      ":tripUpdatedAt": updates.updatedAt
    };
    const setParts: string[] = ["#tripUpdatedAt = :tripUpdatedAt"];
    const removeParts: string[] = [];

    if (updates.name !== undefined) {
      names["#tripName"] = "tripName";
      values[":tripName"] = updates.name;
      setParts.push("#tripName = :tripName");
    }

    if (updates.startDate !== undefined) {
      names["#tripStartDate"] = "tripStartDate";
      if (updates.startDate === null) {
        removeParts.push("#tripStartDate");
      } else {
        values[":tripStartDate"] = updates.startDate;
        setParts.push("#tripStartDate = :tripStartDate");
      }
    }

    if (updates.endDate !== undefined) {
      names["#tripEndDate"] = "tripEndDate";
      if (updates.endDate === null) {
        removeParts.push("#tripEndDate");
      } else {
        values[":tripEndDate"] = updates.endDate;
        setParts.push("#tripEndDate = :tripEndDate");
      }
    }

    const expressions: string[] = [];
    if (setParts.length) {
      expressions.push(`SET ${setParts.join(", ")}`);
    }
    if (removeParts.length) {
      expressions.push(`REMOVE ${removeParts.join(", ")}`);
    }

    await this.docClient.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: {
          PK: keys.tripPk(tripId),
          SK: keys.memberSk(memberId)
        },
        UpdateExpression: expressions.join(" "),
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values
      })
    );
  }

  async updateMemberPaymentMethods(
    tripId: string,
    memberId: string,
    methods: Partial<Record<keyof PaymentMethods, string | null>>
  ): Promise<void> {
    const names: Record<string, string> = {};
    const values: Record<string, unknown> = {};
    const setParts: string[] = [];
    const removeParts: string[] = [];
    let index = 0;

    names["#pm"] = "paymentMethods";

    (["venmo", "paypal", "zelle"] as Array<keyof PaymentMethods>).forEach((key) => {
      if (methods[key] === undefined) return;
      const nameKey = `#pm_${key}`;
      names[nameKey] = key;
      if (methods[key] === null) {
        removeParts.push(`#pm.${nameKey}`);
      } else {
        const valueKey = `:v${index++}`;
        values[valueKey] = methods[key];
        setParts.push(`#pm.${nameKey} = ${valueKey}`);
      }
    });

    const expressions: string[] = [];
    if (setParts.length) {
      expressions.push(`SET ${setParts.join(", ")}`);
    }
    if (removeParts.length) {
      expressions.push(`REMOVE ${removeParts.join(", ")}`);
    }

    if (!expressions.length) {
      return;
    }

    await this.docClient.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: {
          PK: keys.tripPk(tripId),
          SK: keys.memberSk(memberId)
        },
        UpdateExpression: expressions.join(" "),
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values
      })
    );
  }

  async addMembers(
    trip: Trip,
    members: TripMember[]
  ): Promise<void> {
    if (!members.length) return;

    const transactItems = members.map((member) => ({
      Put: {
        TableName: this.tableName,
        Item: <MemberEntity>{
          entityType: "TripMember",
          PK: keys.tripPk(member.tripId),
          SK: keys.memberSk(member.memberId),
          GSI1PK: `MEMBER#${member.memberId}`,
          GSI1SK: `TRIP#${trip.tripId}`,
          tripName: trip.name,
          ownerId: trip.ownerId,
          tripStartDate: trip.startDate,
          tripEndDate: trip.endDate,
          currency: trip.currency,
          tripCreatedAt: trip.createdAt,
          tripUpdatedAt: trip.updatedAt,
          ...member
        },
        ConditionExpression: "attribute_not_exists(PK)"
      }
    }));

    // DynamoDB limits to 25 items per transaction.
    const chunkSize = 25;
    for (let i = 0; i < transactItems.length; i += chunkSize) {
      const chunk = transactItems.slice(i, i + chunkSize);
      await this.docClient.send(
        new TransactWriteCommand({
          TransactItems: chunk
        })
      );
    }
  }

  async deleteMember(tripId: string, memberId: string): Promise<void> {
    await this.docClient.send(
      new DeleteCommand({
        TableName: this.tableName,
        Key: {
          PK: keys.tripPk(tripId),
          SK: keys.memberSk(memberId)
        }
      })
    );
  }

  async saveExpense(expense: Expense): Promise<void> {
    const item: ExpenseEntity = {
      entityType: "Expense",
      PK: keys.tripPk(expense.tripId),
      SK: keys.expenseSk(expense.expenseId),
      ...expense
    };
    await this.docClient.send(
      new PutCommand({
        TableName: this.tableName,
        Item: item
      })
    );
  }

  async softDeleteExpense(
    tripId: string,
    expenseId: string,
    deletedBy: string
  ): Promise<void> {
    await this.docClient.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: {
          PK: keys.tripPk(tripId),
          SK: keys.expenseSk(expenseId)
        },
        UpdateExpression: "SET deletedAt = :now, deletedBy = :who",
        ExpressionAttributeValues: {
          ":now": new Date().toISOString(),
          ":who": deletedBy
        },
        ConditionExpression: "attribute_exists(PK)"
      })
    );
  }

  async restoreExpense(tripId: string, expenseId: string): Promise<void> {
    await this.docClient.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: {
          PK: keys.tripPk(tripId),
          SK: keys.expenseSk(expenseId)
        },
        UpdateExpression: "REMOVE deletedAt, deletedBy",
        ConditionExpression: "attribute_exists(PK)"
      })
    );
  }

  async purgeExpense(tripId: string, expenseId: string): Promise<void> {
    await this.docClient.send(
      new DeleteCommand({
        TableName: this.tableName,
        Key: {
          PK: keys.tripPk(tripId),
          SK: keys.expenseSk(expenseId)
        }
      })
    );
  }

  async saveReceipt(receipt: Receipt): Promise<void> {
    const item: ReceiptEntity = {
      entityType: "Receipt",
      PK: keys.tripPk(receipt.tripId),
      SK: keys.receiptSk(receipt.receiptId),
      ...receipt
    };
    await this.docClient.send(
      new PutCommand({
        TableName: this.tableName,
        Item: item
      })
    );
  }

  async updateReceiptExtraction(
    tripId: string,
    receiptId: string,
    updates: Partial<Pick<Receipt, "status" | "extractedData" | "draft" | "updatedAt">>
  ): Promise<void> {
    const updateExpressions: string[] = [];
    const names: Record<string, string> = {};
    const values: Record<string, unknown> = {};
    let index = 0;

    for (const [key, value] of Object.entries(updates)) {
      if (value === undefined) continue;
      const attrName = `#attr${index}`;
      const attrValue = `:val${index}`;
      updateExpressions.push(`${attrName} = ${attrValue}`);
      names[attrName] = key;
      values[attrValue] = value;
      index += 1;
    }

    if (!updateExpressions.length) return;

    await this.docClient.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: {
          PK: keys.tripPk(tripId),
          SK: keys.receiptSk(receiptId)
        },
        UpdateExpression: `SET ${updateExpressions.join(", ")}`,
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values
      })
    );
  }

  /**
   * Applies a placeholder-member claim: rewritten expenses and settlements
   * are written back and the placeholder's member record is removed, in
   * transactional chunks so balances flip over as close to atomically as
   * DynamoDB allows.
   */
  async applyMemberMerge(
    tripId: string,
    expenses: Expense[],
    settlements: Settlement[],
    placeholderMemberId: string
  ): Promise<void> {
    const transactItems: object[] = [
      ...expenses.map((expense) => ({
        Put: {
          TableName: this.tableName,
          Item: {
            entityType: "Expense",
            PK: keys.tripPk(tripId),
            SK: keys.expenseSk(expense.expenseId),
            ...expense
          }
        }
      })),
      ...settlements.map((settlement) => ({
        Put: {
          TableName: this.tableName,
          Item: {
            entityType: "Settlement",
            PK: keys.tripPk(tripId),
            SK: keys.settlementSk(settlement.settlementId),
            ...settlement
          }
        }
      })),
      {
        Delete: {
          TableName: this.tableName,
          Key: {
            PK: keys.tripPk(tripId),
            SK: keys.memberSk(placeholderMemberId)
          }
        }
      }
    ];

    const chunkSize = 25;
    for (let i = 0; i < transactItems.length; i += chunkSize) {
      await this.docClient.send(
        new TransactWriteCommand({
          TransactItems: transactItems.slice(i, i + chunkSize)
        })
      );
    }
  }

  async saveSettlement(settlement: Settlement): Promise<void> {
    const item: SettlementEntity = {
      entityType: "Settlement",
      PK: keys.tripPk(settlement.tripId),
      SK: keys.settlementSk(settlement.settlementId),
      ...settlement
    };
    await this.docClient.send(
      new PutCommand({
        TableName: this.tableName,
        Item: item
      })
    );
  }

  async updateSettlement(
    tripId: string,
    settlementId: string,
    updates: {
      fromMemberId?: string;
      toMemberId?: string;
      amount?: number;
      note?: string;
      clearConfirmation?: boolean;
    }
  ): Promise<void> {
    const sets: string[] = [];
    const removes: string[] = [];
    const names: Record<string, string> = {};
    const values: Record<string, unknown> = {};

    const setField = (field: string, value: unknown) => {
      names[`#${field}`] = field;
      sets.push(`#${field} = :${field}`);
      values[`:${field}`] = value;
    };

    if (updates.fromMemberId !== undefined) {
      setField("fromMemberId", updates.fromMemberId);
    }
    if (updates.toMemberId !== undefined) {
      setField("toMemberId", updates.toMemberId);
    }
    if (updates.amount !== undefined) setField("amount", updates.amount);
    if (updates.note !== undefined) {
      if (updates.note === "") {
        names["#note"] = "note";
        removes.push("#note");
      } else {
        setField("note", updates.note);
      }
    }
    if (updates.clearConfirmation) {
      names["#confirmedAt"] = "confirmedAt";
      removes.push("#confirmedAt");
    }
    if (!sets.length && !removes.length) return;

    const expression = [
      sets.length ? `SET ${sets.join(", ")}` : "",
      removes.length ? `REMOVE ${removes.join(", ")}` : ""
    ]
      .filter(Boolean)
      .join(" ");

    await this.docClient.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: {
          PK: keys.tripPk(tripId),
          SK: keys.settlementSk(settlementId)
        },
        UpdateExpression: expression,
        ExpressionAttributeNames: names,
        ...(Object.keys(values).length
          ? { ExpressionAttributeValues: values }
          : {}),
        ConditionExpression: "attribute_exists(PK)"
      })
    );
  }

  async softDeleteSettlement(
    tripId: string,
    settlementId: string,
    deletedBy: string
  ): Promise<void> {
    await this.docClient.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: {
          PK: keys.tripPk(tripId),
          SK: keys.settlementSk(settlementId)
        },
        UpdateExpression: "SET deletedAt = :now, deletedBy = :who",
        ExpressionAttributeValues: {
          ":now": new Date().toISOString(),
          ":who": deletedBy
        },
        ConditionExpression: "attribute_exists(PK)"
      })
    );
  }

  async restoreSettlement(tripId: string, settlementId: string): Promise<void> {
    await this.docClient.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: {
          PK: keys.tripPk(tripId),
          SK: keys.settlementSk(settlementId)
        },
        UpdateExpression: "REMOVE deletedAt, deletedBy",
        ConditionExpression: "attribute_exists(PK)"
      })
    );
  }

  async purgeSettlement(tripId: string, settlementId: string): Promise<void> {
    await this.docClient.send(
      new DeleteCommand({
        TableName: this.tableName,
        Key: {
          PK: keys.tripPk(tripId),
          SK: keys.settlementSk(settlementId)
        }
      })
    );
  }

  async markSettlementConfirmation(
    tripId: string,
    settlementId: string,
    confirmedAt?: string
  ): Promise<void> {
    if (confirmedAt) {
      await this.docClient.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: {
            PK: keys.tripPk(tripId),
            SK: keys.settlementSk(settlementId)
          },
          UpdateExpression: "SET confirmedAt = :confirmedAt",
          ExpressionAttributeValues: {
            ":confirmedAt": confirmedAt
          }
        })
      );
    } else {
      await this.docClient.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: {
            PK: keys.tripPk(tripId),
            SK: keys.settlementSk(settlementId)
          },
          UpdateExpression: "REMOVE confirmedAt"
        })
      );
    }
  }

  async batchGetTrips(tripIds: string[]): Promise<Trip[]> {
    if (!tripIds.length) return [];
    const keysInput = tripIds.map((tripId) => ({
      PK: keys.tripPk(tripId),
      SK: keys.tripSkMeta
    }));

    const { Responses } = await this.docClient.send(
      new BatchGetCommand({
        RequestItems: {
          [this.tableName]: {
            Keys: keysInput
          }
        }
      })
    );

    const items = Responses?.[this.tableName] ?? [];
    return items.map((item) => toTrip(item as TripEntity));
  }

  async updateExpenseAllocations(
    tripId: string,
    expenseId: string,
    updates: Partial<Pick<Expense, "description" | "vendor" | "category" | "currency" | "paidByMemberId" | "receiptId" | "allocations" | "sharedWithMemberIds" | "tax" | "tip" | "total" | "lineItems" | "extrasSplitMode" | "draft" | "updatedAt">>
  ): Promise<void> {
    const updateExpressions: string[] = [];
    const names: Record<string, string> = {};
    const values: Record<string, unknown> = {};
    let index = 0;

    for (const [key, value] of Object.entries(updates)) {
      if (value === undefined) continue;
      const attrName = `#attr${index}`;
      const attrValue = `:val${index}`;
      updateExpressions.push(`${attrName} = ${attrValue}`);
      names[attrName] = key;
      values[attrValue] = value;
      index += 1;
    }

    if (!updateExpressions.length) return;

    await this.docClient.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: {
          PK: keys.tripPk(tripId),
          SK: keys.expenseSk(expenseId)
        },
        UpdateExpression: `SET ${updateExpressions.join(", ")}`,
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values
      })
    );
  }

  // ---------- Trip invites ----------

  async getTripInvite(tripId: string): Promise<TripInvite | null> {
    const { Item } = await this.docClient.send(
      new GetCommand({
        TableName: this.tableName,
        Key: {
          PK: keys.tripPk(tripId),
          SK: keys.tripSkInvitePointer
        }
      })
    );
    if (!Item) return null;
    return {
      tripId: Item.tripId as string,
      inviteId: Item.inviteId as string,
      createdBy: Item.createdBy as string,
      createdAt: Item.createdAt as string
    };
  }

  async getInviteById(inviteId: string): Promise<TripInvite | null> {
    const { Item } = await this.docClient.send(
      new GetCommand({
        TableName: this.tableName,
        Key: {
          PK: keys.invitePk(inviteId),
          SK: keys.inviteSk
        }
      })
    );
    if (!Item) return null;
    return {
      tripId: Item.tripId as string,
      inviteId: Item.inviteId as string,
      createdBy: Item.createdBy as string,
      createdAt: Item.createdAt as string
    };
  }

  async createInvite(invite: TripInvite): Promise<void> {
    await this.docClient.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Put: {
              TableName: this.tableName,
              Item: {
                entityType: "TripInvitePointer",
                PK: keys.tripPk(invite.tripId),
                SK: keys.tripSkInvitePointer,
                ...invite
              }
            }
          },
          {
            Put: {
              TableName: this.tableName,
              Item: {
                entityType: "TripInvite",
                PK: keys.invitePk(invite.inviteId),
                SK: keys.inviteSk,
                ...invite
              }
            }
          }
        ]
      })
    );
  }

  async deleteInvite(tripId: string, inviteId: string): Promise<void> {
    await this.docClient.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Delete: {
              TableName: this.tableName,
              Key: {
                PK: keys.tripPk(tripId),
                SK: keys.tripSkInvitePointer
              }
            }
          },
          {
            Delete: {
              TableName: this.tableName,
              Key: {
                PK: keys.invitePk(inviteId),
                SK: keys.inviteSk
              }
            }
          }
        ]
      })
    );
  }

  // ---------- Expense comments ----------

  async listExpenseComments(
    tripId: string,
    expenseId: string
  ): Promise<ExpenseComment[]> {
    const { Items } = await this.docClient.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
        ExpressionAttributeValues: {
          ":pk": keys.tripPk(tripId),
          ":sk": keys.commentSkPrefix(expenseId)
        }
      })
    );
    if (!Items?.length) return [];
    return Items
      .map((item) => ({
        tripId,
        expenseId: item.expenseId as string,
        commentId: item.commentId as string,
        authorId: item.authorId as string,
        authorName: (item.authorName as string) || undefined,
        body: item.body as string,
        createdAt: item.createdAt as string
      }))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async createComment(comment: ExpenseComment): Promise<void> {
    await this.docClient.send(
      new PutCommand({
        TableName: this.tableName,
        Item: {
          entityType: "ExpenseComment",
          PK: keys.tripPk(comment.tripId),
          SK: keys.commentSk(comment.expenseId, comment.commentId),
          ...comment
        }
      })
    );
  }

  async getComment(
    tripId: string,
    expenseId: string,
    commentId: string
  ): Promise<ExpenseComment | null> {
    const { Item } = await this.docClient.send(
      new GetCommand({
        TableName: this.tableName,
        Key: {
          PK: keys.tripPk(tripId),
          SK: keys.commentSk(expenseId, commentId)
        }
      })
    );
    if (!Item) return null;
    return {
      tripId,
      expenseId: Item.expenseId as string,
      commentId: Item.commentId as string,
      authorId: Item.authorId as string,
      authorName: (Item.authorName as string) || undefined,
      body: Item.body as string,
      createdAt: Item.createdAt as string
    };
  }

  async deleteComment(
    tripId: string,
    expenseId: string,
    commentId: string
  ): Promise<void> {
    await this.docClient.send(
      new DeleteCommand({
        TableName: this.tableName,
        Key: {
          PK: keys.tripPk(tripId),
          SK: keys.commentSk(expenseId, commentId)
        }
      })
    );
  }
}
