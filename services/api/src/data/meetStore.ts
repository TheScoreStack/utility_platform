import {
  GetCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand
} from "@aws-sdk/lib-dynamodb";
import { getDocumentClient } from "./dynamo.js";
import { loadConfig } from "../config.js";
import {
  MeetEvent,
  MeetParticipant,
  MeetSlotRef,
  MeetEventSettings,
  MeetMode,
  MeetStatus
} from "../types.js";
import { NotFoundError } from "../lib/errors.js";

const keys = {
  eventPk: (eventId: string) => `MEET#${eventId}`,
  eventSkMeta: "METADATA",
  participantSk: (participantId: string) => `PART#${participantId}`,
  participantSkPrefix: "PART#",
  linkPk: (slug: string) => `MEETLINK#${slug}`,
  linkSk: "METADATA"
};

/** Participant row as stored — carries the guest secret hash, which the
 *  service layer must strip before anything leaves the API. */
export type StoredMeetParticipant = MeetParticipant & {
  secretHash?: string;
};

/** Denormalized summary carried on GSI1 participant rows (mirrors the
 *  TripMember pattern) so "my meets" renders without fetching each event. */
export interface MeetSummary {
  eventId: string;
  title: string;
  status: MeetStatus;
  mode: MeetMode;
  firstDate: string;
  lastDate: string;
  role: MeetParticipant["role"];
  respondedAt?: string;
}

type MeetEventEntity = MeetEvent & {
  entityType: "MeetEvent";
  PK: string;
  SK: string;
};

type MeetParticipantEntity = StoredMeetParticipant & {
  entityType: "MeetParticipant";
  PK: string;
  SK: string;
  GSI1PK?: string;
  GSI1SK?: string;
  title?: string;
  status?: MeetStatus;
  mode?: MeetMode;
  firstDate?: string;
  lastDate?: string;
};

const toEvent = (item: Record<string, unknown>): MeetEvent => ({
  eventId: item.eventId as string,
  slug: item.slug as string,
  organizerId: item.organizerId as string,
  organizerName: (item.organizerName as string) || undefined,
  title: item.title as string,
  description: (item.description as string) || undefined,
  mode: item.mode as MeetMode,
  timezone: item.timezone as string,
  dates: (item.dates as string[]) ?? [],
  startMinute: item.startMinute as number,
  endMinute: item.endMinute as number,
  slotMinutes: item.slotMinutes as number,
  settings: item.settings as MeetEventSettings | undefined,
  status: item.status as MeetStatus,
  finalizedSlot: item.finalizedSlot as MeetSlotRef | undefined,
  version: (item.version as number) ?? 0,
  createdAt: item.createdAt as string,
  updatedAt: item.updatedAt as string
});

const toParticipant = (
  item: Record<string, unknown>
): StoredMeetParticipant => ({
  eventId: item.eventId as string,
  participantId: item.participantId as string,
  displayName: item.displayName as string,
  userId: (item.userId as string) || undefined,
  email: (item.email as string) || undefined,
  timezone: (item.timezone as string) || undefined,
  role: item.role as MeetParticipant["role"],
  availability:
    (item.availability as MeetParticipant["availability"]) ?? {},
  respondedAt: (item.respondedAt as string) || undefined,
  secretHash: (item.secretHash as string) || undefined,
  createdAt: item.createdAt as string,
  updatedAt: item.updatedAt as string
});

export class MeetStore {
  private readonly tableName: string;
  private readonly docClient = getDocumentClient();

  constructor() {
    const config = loadConfig();
    this.tableName = config.tableName;
  }

  private participantItem(
    event: Pick<
      MeetEvent,
      "eventId" | "title" | "status" | "mode" | "dates"
    >,
    participant: StoredMeetParticipant
  ): MeetParticipantEntity {
    const item: MeetParticipantEntity = {
      entityType: "MeetParticipant",
      PK: keys.eventPk(event.eventId),
      SK: keys.participantSk(participant.participantId),
      ...participant
    };
    if (participant.userId) {
      // Signed-in responders get a GSI1 row plus denormalized event fields
      // so GET /meet/events renders from the index alone (TripMember style).
      item.GSI1PK = `USER#${participant.userId}`;
      item.GSI1SK = `MEET#${event.eventId}`;
      item.title = event.title;
      item.status = event.status;
      item.mode = event.mode;
      item.firstDate = event.dates[0];
      item.lastDate = event.dates[event.dates.length - 1];
    }
    return item;
  }

  /** Version bump on the event METADATA item; part of every event or
   *  participant mutation so respond pages can poll `version` cheaply. */
  private versionBump(eventId: string, updatedAt: string) {
    return {
      Update: {
        TableName: this.tableName,
        Key: {
          PK: keys.eventPk(eventId),
          SK: keys.eventSkMeta
        },
        UpdateExpression: "SET updatedAt = :now ADD version :one",
        ExpressionAttributeValues: {
          ":now": updatedAt,
          ":one": 1
        },
        ConditionExpression: "attribute_exists(PK)"
      }
    };
  }

  /** Event, slug pointer, and organizer participant are created in one
   *  transaction (the INVITE# two-item pattern from tripStore). */
  async createEvent(
    event: MeetEvent,
    organizer: MeetParticipant
  ): Promise<void> {
    const eventItem: MeetEventEntity = {
      entityType: "MeetEvent",
      PK: keys.eventPk(event.eventId),
      SK: keys.eventSkMeta,
      ...event
    };

    await this.docClient.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Put: {
              TableName: this.tableName,
              Item: eventItem,
              ConditionExpression: "attribute_not_exists(PK)"
            }
          },
          {
            Put: {
              TableName: this.tableName,
              Item: {
                entityType: "MeetLink",
                PK: keys.linkPk(event.slug),
                SK: keys.linkSk,
                slug: event.slug,
                eventId: event.eventId,
                createdAt: event.createdAt
              },
              ConditionExpression: "attribute_not_exists(PK)"
            }
          },
          {
            Put: {
              TableName: this.tableName,
              Item: this.participantItem(event, organizer)
            }
          }
        ]
      })
    );
  }

  async getEvent(eventId: string): Promise<MeetEvent> {
    const { Item } = await this.docClient.send(
      new GetCommand({
        TableName: this.tableName,
        Key: {
          PK: keys.eventPk(eventId),
          SK: keys.eventSkMeta
        }
      })
    );

    if (!Item) {
      throw new NotFoundError(`Meet event ${eventId} not found`);
    }

    return toEvent(Item);
  }

  async getEventIdBySlug(slug: string): Promise<string | null> {
    const { Item } = await this.docClient.send(
      new GetCommand({
        TableName: this.tableName,
        Key: {
          PK: keys.linkPk(slug),
          SK: keys.linkSk
        }
      })
    );
    if (!Item) return null;
    return Item.eventId as string;
  }

  async listParticipants(eventId: string): Promise<StoredMeetParticipant[]> {
    const { Items } = await this.docClient.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
        ExpressionAttributeValues: {
          ":pk": keys.eventPk(eventId),
          ":sk": keys.participantSkPrefix
        }
      })
    );
    return (Items ?? [])
      .map((item) => toParticipant(item))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async getParticipant(
    eventId: string,
    participantId: string
  ): Promise<StoredMeetParticipant | null> {
    const { Item } = await this.docClient.send(
      new GetCommand({
        TableName: this.tableName,
        Key: {
          PK: keys.eventPk(eventId),
          SK: keys.participantSk(participantId)
        }
      })
    );
    if (!Item) return null;
    return toParticipant(Item);
  }

  /** Inserts a new participant; fails if the row already exists. Bumps the
   *  event version in the same transaction. */
  async createParticipant(
    event: MeetEvent,
    participant: StoredMeetParticipant
  ): Promise<void> {
    await this.docClient.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Put: {
              TableName: this.tableName,
              Item: this.participantItem(event, participant),
              ConditionExpression: "attribute_not_exists(PK)"
            }
          },
          this.versionBump(event.eventId, participant.updatedAt)
        ]
      })
    );
  }

  /** Overwrites an existing participant (read-modify-write in the service);
   *  fails if the row vanished. Bumps the event version transactionally. */
  async updateParticipant(
    event: MeetEvent,
    participant: StoredMeetParticipant
  ): Promise<void> {
    await this.docClient.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Put: {
              TableName: this.tableName,
              Item: this.participantItem(event, participant),
              ConditionExpression: "attribute_exists(PK)"
            }
          },
          this.versionBump(event.eventId, participant.updatedAt)
        ]
      })
    );
  }

  /** Applies title/description/settings edits to the METADATA item and
   *  bumps the version. Denormalized participant copies are refreshed via
   *  updateParticipantsDenorm. */
  async updateEventFields(
    eventId: string,
    updates: {
      title?: string;
      description?: string;
      settings?: MeetEventSettings;
      updatedAt: string;
    }
  ): Promise<void> {
    const names: Record<string, string> = {
      "#updatedAt": "updatedAt",
      "#version": "version"
    };
    const values: Record<string, unknown> = {
      ":updatedAt": updates.updatedAt,
      ":one": 1
    };
    const setParts: string[] = ["#updatedAt = :updatedAt"];

    if (updates.title !== undefined) {
      names["#title"] = "title";
      values[":title"] = updates.title;
      setParts.push("#title = :title");
    }
    if (updates.description !== undefined) {
      names["#description"] = "description";
      values[":description"] = updates.description;
      setParts.push("#description = :description");
    }
    if (updates.settings !== undefined) {
      names["#settings"] = "settings";
      values[":settings"] = updates.settings;
      setParts.push("#settings = :settings");
    }

    await this.docClient.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: {
          PK: keys.eventPk(eventId),
          SK: keys.eventSkMeta
        },
        UpdateExpression: `SET ${setParts.join(", ")} ADD #version :one`,
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
        ConditionExpression: "attribute_exists(PK)"
      })
    );
  }

  async finalizeEvent(
    eventId: string,
    finalizedSlot: MeetSlotRef,
    updatedAt: string
  ): Promise<void> {
    await this.docClient.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: {
          PK: keys.eventPk(eventId),
          SK: keys.eventSkMeta
        },
        UpdateExpression:
          "SET #status = :status, finalizedSlot = :slot, updatedAt = :now " +
          "ADD version :one",
        ExpressionAttributeNames: {
          "#status": "status"
        },
        ExpressionAttributeValues: {
          ":status": "finalized",
          ":slot": finalizedSlot,
          ":now": updatedAt,
          ":one": 1
        },
        ConditionExpression: "attribute_exists(PK)"
      })
    );
  }

  async reopenEvent(eventId: string, updatedAt: string): Promise<void> {
    await this.docClient.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: {
          PK: keys.eventPk(eventId),
          SK: keys.eventSkMeta
        },
        UpdateExpression:
          "SET #status = :status, updatedAt = :now " +
          "REMOVE finalizedSlot ADD version :one",
        ExpressionAttributeNames: {
          "#status": "status"
        },
        ExpressionAttributeValues: {
          ":status": "open",
          ":now": updatedAt,
          ":one": 1
        },
        ConditionExpression: "attribute_exists(PK)"
      })
    );
  }

  /** Refreshes the denormalized event fields on every signed-in
   *  participant's GSI1 row (mirrors updateTripMetadata's member sweep). */
  async updateParticipantsDenorm(
    eventId: string,
    participants: StoredMeetParticipant[],
    updates: { title?: string; status?: MeetStatus }
  ): Promise<void> {
    const names: Record<string, string> = {};
    const values: Record<string, unknown> = {};
    const setParts: string[] = [];

    if (updates.title !== undefined) {
      names["#title"] = "title";
      values[":title"] = updates.title;
      setParts.push("#title = :title");
    }
    if (updates.status !== undefined) {
      names["#status"] = "status";
      values[":status"] = updates.status;
      setParts.push("#status = :status");
    }
    if (!setParts.length) return;

    const indexedIds = participants
      .filter((participant) => participant.userId)
      .map((participant) => participant.participantId);

    await Promise.all(
      indexedIds.map((participantId) =>
        this.docClient.send(
          new UpdateCommand({
            TableName: this.tableName,
            Key: {
              PK: keys.eventPk(eventId),
              SK: keys.participantSk(participantId)
            },
            UpdateExpression: `SET ${setParts.join(", ")}`,
            ExpressionAttributeNames: names,
            ExpressionAttributeValues: values,
            ConditionExpression: "attribute_exists(PK)"
          })
        )
      )
    );
  }

  /** Removes the event, all participants, and the slug pointer. */
  async deleteEvent(event: MeetEvent): Promise<void> {
    const { Items } = await this.docClient.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: "PK = :pk",
        ExpressionAttributeValues: {
          ":pk": keys.eventPk(event.eventId)
        }
      })
    );

    const transactItems: object[] = [
      ...(Items ?? []).map((item) => ({
        Delete: {
          TableName: this.tableName,
          Key: {
            PK: item.PK,
            SK: item.SK
          }
        }
      })),
      {
        Delete: {
          TableName: this.tableName,
          Key: {
            PK: keys.linkPk(event.slug),
            SK: keys.linkSk
          }
        }
      }
    ];

    // DynamoDB limits to 25 items per transaction.
    const chunkSize = 25;
    for (let i = 0; i < transactItems.length; i += chunkSize) {
      await this.docClient.send(
        new TransactWriteCommand({
          TransactItems: transactItems.slice(i, i + chunkSize)
        })
      );
    }
  }

  /** "My meets": GSI1 rows under USER#<userId> with the MEET# SK prefix. */
  async listMeetsForUser(userId: string): Promise<MeetSummary[]> {
    const { Items } = await this.docClient.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: "GSI1",
        KeyConditionExpression:
          "GSI1PK = :user AND begins_with(GSI1SK, :meet)",
        ExpressionAttributeValues: {
          ":user": `USER#${userId}`,
          ":meet": "MEET#"
        }
      })
    );

    return (Items ?? []).map((item) => ({
      eventId: item.eventId as string,
      title: item.title as string,
      status: item.status as MeetStatus,
      mode: item.mode as MeetMode,
      firstDate: item.firstDate as string,
      lastDate: item.lastDate as string,
      role: item.role as MeetParticipant["role"],
      respondedAt: (item.respondedAt as string) || undefined
    }));
  }
}
