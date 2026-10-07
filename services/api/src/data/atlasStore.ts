import {
  BatchWriteCommand,
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand
} from "@aws-sdk/lib-dynamodb";
import { getDocumentClient } from "./dynamo.js";
import { loadConfig } from "../config.js";
import type {
  AtlasCircle,
  AtlasPerson,
  AtlasProfile,
  AtlasTrip,
  AtlasWish
} from "../types.js";

// Everything Atlas stores sits in the owner's partition, so one query
// returns a whole atlas and no other user's key is ever constructed.
const PK = (userId: string) => `USER#${userId}`;
const PREFIX = "ATLAS#";
const PROFILE_SK = "ATLAS#PROFILE";
const CIRCLE_SK = (id: string) => `ATLAS#CIRCLE#${id}`;
const PERSON_SK = (id: string) => `ATLAS#PERSON#${id}`;
const TRIP_SK = (id: string) => `ATLAS#TRIP#${id}`;
const WISH_SK = (id: string) => `ATLAS#WISH#${id}`;

type EntityType =
  | "AtlasProfile"
  | "AtlasCircle"
  | "AtlasPerson"
  | "AtlasTrip"
  | "AtlasWish";

export interface AtlasRecords {
  profile?: AtlasProfile;
  circles: AtlasCircle[];
  people: AtlasPerson[];
  trips: AtlasTrip[];
  wishes: AtlasWish[];
}

const strip = <T>(item: Record<string, unknown>): T => {
  const { PK: _pk, SK: _sk, entityType: _type, ...rest } = item;
  return rest as T;
};

export class AtlasStore {
  private readonly tableName: string;
  private readonly docClient = getDocumentClient();

  constructor() {
    this.tableName = loadConfig().tableName;
  }

  async loadAll(userId: string): Promise<AtlasRecords> {
    const records: AtlasRecords = { circles: [], people: [], trips: [], wishes: [] };
    let startKey: Record<string, unknown> | undefined;
    do {
      const { Items, LastEvaluatedKey } = await this.docClient.send(
        new QueryCommand({
          TableName: this.tableName,
          KeyConditionExpression: "PK = :pk AND begins_with(SK, :prefix)",
          ExpressionAttributeValues: { ":pk": PK(userId), ":prefix": PREFIX },
          ExclusiveStartKey: startKey
        })
      );
      for (const raw of Items ?? []) {
        const item = raw as Record<string, unknown>;
        switch (item.entityType as EntityType) {
          case "AtlasProfile":
            records.profile = strip<AtlasProfile>(item);
            break;
          case "AtlasCircle":
            records.circles.push(strip<AtlasCircle>(item));
            break;
          case "AtlasPerson":
            records.people.push(strip<AtlasPerson>(item));
            break;
          case "AtlasTrip":
            records.trips.push(strip<AtlasTrip>(item));
            break;
          case "AtlasWish":
            records.wishes.push(strip<AtlasWish>(item));
            break;
        }
      }
      startKey = LastEvaluatedKey;
    } while (startKey);
    return records;
  }

  private async put(
    userId: string,
    sk: string,
    entityType: EntityType,
    value: object
  ): Promise<void> {
    await this.docClient.send(
      new PutCommand({
        TableName: this.tableName,
        Item: { PK: PK(userId), SK: sk, entityType, ...value }
      })
    );
  }

  private async get<T>(userId: string, sk: string): Promise<T | undefined> {
    const { Item } = await this.docClient.send(
      new GetCommand({ TableName: this.tableName, Key: { PK: PK(userId), SK: sk } })
    );
    return Item ? strip<T>(Item as Record<string, unknown>) : undefined;
  }

  private async remove(userId: string, sk: string): Promise<void> {
    await this.docClient.send(
      new DeleteCommand({ TableName: this.tableName, Key: { PK: PK(userId), SK: sk } })
    );
  }

  // Profile
  getProfile = (userId: string) => this.get<AtlasProfile>(userId, PROFILE_SK);
  putProfile = (userId: string, profile: AtlasProfile) =>
    this.put(userId, PROFILE_SK, "AtlasProfile", profile);

  // Circles
  getCircle = (userId: string, id: string) => this.get<AtlasCircle>(userId, CIRCLE_SK(id));
  putCircle = (userId: string, circle: AtlasCircle) =>
    this.put(userId, CIRCLE_SK(circle.circleId), "AtlasCircle", circle);
  deleteCircle = (userId: string, id: string) => this.remove(userId, CIRCLE_SK(id));

  // People
  getPerson = (userId: string, id: string) => this.get<AtlasPerson>(userId, PERSON_SK(id));
  putPerson = (userId: string, person: AtlasPerson) =>
    this.put(userId, PERSON_SK(person.personId), "AtlasPerson", person);
  deletePerson = (userId: string, id: string) => this.remove(userId, PERSON_SK(id));

  // Trips
  getTrip = (userId: string, id: string) => this.get<AtlasTrip>(userId, TRIP_SK(id));
  putTrip = (userId: string, trip: AtlasTrip) =>
    this.put(userId, TRIP_SK(trip.tripId), "AtlasTrip", { ...trip, coverUrl: undefined });
  deleteTrip = (userId: string, id: string) => this.remove(userId, TRIP_SK(id));

  // Wishes
  getWish = (userId: string, id: string) => this.get<AtlasWish>(userId, WISH_SK(id));
  putWish = (userId: string, wish: AtlasWish) =>
    this.put(userId, WISH_SK(wish.wishId), "AtlasWish", wish);
  deleteWish = (userId: string, id: string) => this.remove(userId, WISH_SK(id));

  /** Rewrites many items at once, 25 per batch (DynamoDB's limit). */
  async putMany(
    userId: string,
    items: Array<
      | { kind: "trip"; value: AtlasTrip }
      | { kind: "person"; value: AtlasPerson }
      | { kind: "wish"; value: AtlasWish }
      | { kind: "circle"; value: AtlasCircle }
    >
  ): Promise<void> {
    const requests = items.map((entry) => {
      const [sk, entityType] =
        entry.kind === "trip"
          ? [TRIP_SK(entry.value.tripId), "AtlasTrip"]
          : entry.kind === "person"
            ? [PERSON_SK(entry.value.personId), "AtlasPerson"]
            : entry.kind === "wish"
              ? [WISH_SK(entry.value.wishId), "AtlasWish"]
              : [CIRCLE_SK(entry.value.circleId), "AtlasCircle"];
      const value =
        entry.kind === "trip" ? { ...entry.value, coverUrl: undefined } : entry.value;
      return { PutRequest: { Item: { PK: PK(userId), SK: sk, entityType, ...value } } };
    });
    for (let i = 0; i < requests.length; i += 25) {
      let pending: typeof requests | undefined = requests.slice(i, i + 25);
      for (let attempt = 0; pending?.length && attempt < 5; attempt++) {
        const { UnprocessedItems } = await this.docClient.send(
          new BatchWriteCommand({ RequestItems: { [this.tableName]: pending } })
        );
        pending = UnprocessedItems?.[this.tableName] as typeof requests | undefined;
        if (pending?.length) {
          await new Promise((r) => setTimeout(r, 50 * 2 ** attempt));
        }
      }
    }
  }
}
