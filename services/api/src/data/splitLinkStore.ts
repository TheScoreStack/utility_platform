import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand
} from "@aws-sdk/lib-dynamodb";
import { getDocumentClient } from "./dynamo.js";
import { loadConfig } from "../config.js";
import type { ExpenseSplitLink, SplitLinkGuest } from "../types.js";

const keys = {
  splitPk: (shareId: string) => `SPLIT#${shareId}`,
  splitSkMeta: "METADATA",
  guestSk: (memberId: string) => `GUEST#${memberId}`,
  guestSkPrefix: "GUEST#",
  tripPk: (tripId: string) => `TRIP#${tripId}`,
  // Pointer on the trip partition so the authed "get link for expense"
  // lookup is a single Get, mirroring the trip invite pointer.
  tripSkSplitPointer: (expenseId: string) => `SPLITLINK#${expenseId}`
};

/** Guest row as stored: the public SplitLinkGuest plus the secret hash that
 *  authenticates their writes. Never leaves the data layer unhashed. */
export type StoredSplitLinkGuest = SplitLinkGuest & { secretHash: string };

const toLink = (item: Record<string, unknown>): ExpenseSplitLink => ({
  tripId: item.tripId as string,
  expenseId: item.expenseId as string,
  shareId: item.shareId as string,
  createdBy: item.createdBy as string,
  createdAt: item.createdAt as string
});

const toGuest = (item: Record<string, unknown>): StoredSplitLinkGuest => ({
  memberId: item.memberId as string,
  displayName: item.displayName as string,
  createdAt: item.createdAt as string,
  userId: item.userId as string | undefined,
  completedAt: item.completedAt as string | undefined,
  settlementId: item.settlementId as string | undefined,
  completedAmount: item.completedAmount as number | undefined,
  secretHash: item.secretHash as string
});

export class SplitLinkStore {
  private readonly tableName: string;
  private readonly docClient = getDocumentClient();

  constructor() {
    const config = loadConfig();
    this.tableName = config.tableName;
  }

  async createSplitLink(link: ExpenseSplitLink): Promise<void> {
    await this.docClient.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Put: {
              TableName: this.tableName,
              Item: {
                entityType: "SplitLinkPointer",
                PK: keys.tripPk(link.tripId),
                SK: keys.tripSkSplitPointer(link.expenseId),
                ...link
              }
            }
          },
          {
            Put: {
              TableName: this.tableName,
              Item: {
                entityType: "SplitLink",
                PK: keys.splitPk(link.shareId),
                SK: keys.splitSkMeta,
                ...link
              },
              ConditionExpression: "attribute_not_exists(PK)"
            }
          }
        ]
      })
    );
  }

  async getSplitLinkByExpense(
    tripId: string,
    expenseId: string
  ): Promise<ExpenseSplitLink | null> {
    const { Item } = await this.docClient.send(
      new GetCommand({
        TableName: this.tableName,
        Key: {
          PK: keys.tripPk(tripId),
          SK: keys.tripSkSplitPointer(expenseId)
        }
      })
    );
    return Item ? toLink(Item) : null;
  }

  async getSplitLinkById(shareId: string): Promise<ExpenseSplitLink | null> {
    const { Item } = await this.docClient.send(
      new GetCommand({
        TableName: this.tableName,
        Key: {
          PK: keys.splitPk(shareId),
          SK: keys.splitSkMeta
        }
      })
    );
    return Item ? toLink(Item) : null;
  }

  /** Removes the link, its pointer, and every guest session under it. */
  async deleteSplitLink(link: ExpenseSplitLink): Promise<void> {
    const guests = await this.listGuests(link.shareId);
    const transactItems = [
      {
        Delete: {
          TableName: this.tableName,
          Key: {
            PK: keys.tripPk(link.tripId),
            SK: keys.tripSkSplitPointer(link.expenseId)
          }
        }
      },
      {
        Delete: {
          TableName: this.tableName,
          Key: {
            PK: keys.splitPk(link.shareId),
            SK: keys.splitSkMeta
          }
        }
      },
      ...guests.map((guest) => ({
        Delete: {
          TableName: this.tableName,
          Key: {
            PK: keys.splitPk(link.shareId),
            SK: keys.guestSk(guest.memberId)
          }
        }
      }))
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

  async putGuest(
    shareId: string,
    guest: StoredSplitLinkGuest
  ): Promise<void> {
    await this.docClient.send(
      new PutCommand({
        TableName: this.tableName,
        Item: {
          entityType: "SplitLinkGuest",
          PK: keys.splitPk(shareId),
          SK: keys.guestSk(guest.memberId),
          ...guest
        }
      })
    );
  }

  async getGuest(
    shareId: string,
    memberId: string
  ): Promise<StoredSplitLinkGuest | null> {
    const { Item } = await this.docClient.send(
      new GetCommand({
        TableName: this.tableName,
        Key: {
          PK: keys.splitPk(shareId),
          SK: keys.guestSk(memberId)
        }
      })
    );
    return Item ? toGuest(Item) : null;
  }

  async listGuests(shareId: string): Promise<StoredSplitLinkGuest[]> {
    const { Items } = await this.docClient.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
        ExpressionAttributeValues: {
          ":pk": keys.splitPk(shareId),
          ":sk": keys.guestSkPrefix
        }
      })
    );
    return (Items ?? []).map((item) => toGuest(item));
  }

  async markGuestCompleted(
    shareId: string,
    memberId: string,
    completion: {
      completedAt: string;
      settlementId: string;
      completedAmount: number;
    }
  ): Promise<void> {
    await this.docClient.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: {
          PK: keys.splitPk(shareId),
          SK: keys.guestSk(memberId)
        },
        UpdateExpression:
          "SET completedAt = :at, settlementId = :sid, completedAmount = :amt",
        ExpressionAttributeValues: {
          ":at": completion.completedAt,
          ":sid": completion.settlementId,
          ":amt": completion.completedAmount
        },
        ConditionExpression: "attribute_exists(PK)"
      })
    );
  }

  /** Reopens a completed claim session (settlement undone/deleted). */
  async clearGuestCompletion(
    shareId: string,
    memberId: string
  ): Promise<void> {
    await this.docClient.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: {
          PK: keys.splitPk(shareId),
          SK: keys.guestSk(memberId)
        },
        UpdateExpression:
          "REMOVE completedAt, settlementId, completedAmount",
        ConditionExpression: "attribute_exists(PK)"
      })
    );
  }

  async deleteGuest(shareId: string, memberId: string): Promise<void> {
    await this.docClient.send(
      new DeleteCommand({
        TableName: this.tableName,
        Key: {
          PK: keys.splitPk(shareId),
          SK: keys.guestSk(memberId)
        }
      })
    );
  }
}
