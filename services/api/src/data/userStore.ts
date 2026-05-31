import {
  BatchGetCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand
} from "@aws-sdk/lib-dynamodb";
import type { UpdateCommandInput } from "@aws-sdk/lib-dynamodb";
import { getDocumentClient } from "./dynamo.js";
import { loadConfig } from "../config.js";
import type { AuthContext } from "../auth.js";
import type { UserProfile } from "../types.js";

const userPk = (userId: string) => `USER#${userId}`;
const userSk = "PROFILE";
const emailPartitionKey = "EMAIL";
const emailSortKey = (email: string) => `EMAIL#${email.toLowerCase()}`;
const namePartitionKey = "NAME";
const nameSortKey = (name: string, userId: string) =>
  `NAME#${name.toLowerCase()}#${userId}`;

const mapToProfile = (item: Record<string, unknown>): UserProfile => ({
  userId: item.userId as string,
  displayName: (item.displayName as string) || undefined,
  email: (item.email as string) || undefined,
  displayNameLower: (item.displayNameLower as string) || undefined,
  paymentMethods: item.paymentMethods as UserProfile["paymentMethods"],
  createdAt: item.createdAt as string,
  updatedAt: item.updatedAt as string
});

export class UserStore {
  private readonly tableName: string;
  private readonly docClient = getDocumentClient();

  constructor() {
    const config = loadConfig();
    this.tableName = config.tableName;
  }

  async ensureUserProfile(auth: AuthContext): Promise<UserProfile> {
    const canonicalUserId = await this.resolveAliasedUserId(auth.userId);
    if (canonicalUserId !== auth.userId) {
      auth.userId = canonicalUserId;
    }

    const userId = auth.userId;
    const existing = await this.getUser(userId);
    const preferredName =
      auth.name ??
      (auth.email ? auth.email.split("@")[0] : undefined) ??
      "Unnamed Person";
    const now = new Date().toISOString();
    const normalizedName = preferredName
      ? preferredName.trim().toLowerCase()
      : undefined;

    if (!existing) {
      if (auth.email) {
        const canonical = await this.findCanonicalProfileByEmail(
          auth.email,
          userId
        );
        if (canonical) {
          await this.docClient.send(
            new PutCommand({
              TableName: this.tableName,
              Item: {
                entityType: "UserProfileAlias" as const,
                PK: userPk(userId),
                SK: userSk,
                userId,
                aliasOf: canonical.userId,
                email: auth.email,
                createdAt: now,
                updatedAt: now
              },
              ConditionExpression: "attribute_not_exists(PK)"
            })
          );
          auth.userId = canonical.userId;
          return canonical;
        }
      }

      const item = {
        entityType: "UserProfile" as const,
        PK: userPk(userId),
        SK: userSk,
        userId,
        displayName: preferredName,
        displayNameLower: normalizedName,
        email: auth.email,
        createdAt: now,
        updatedAt: now,
        ...(auth.email
          ? {
              GSI2PK: emailPartitionKey,
              GSI2SK: `${emailSortKey(auth.email)}#${userId}`
            }
          : {}),
        ...(normalizedName
          ? {
              GSI3PK: namePartitionKey,
              GSI3SK: nameSortKey(normalizedName, userId)
            }
          : {})
      };

      await this.docClient.send(
        new PutCommand({
          TableName: this.tableName,
          Item: item,
          ConditionExpression: "attribute_not_exists(PK)"
        })
      );
      return {
        userId,
        displayName: preferredName,
        email: auth.email,
        displayNameLower: normalizedName,
        paymentMethods: undefined,
        createdAt: now,
        updatedAt: now
      };
    }

    const updateExpressionParts: string[] = ["updatedAt = :updatedAt"];
    const expressionValues: Record<string, unknown> = {
      ":updatedAt": now
    };
    const expressionNames: Record<string, string> = {};

    const shouldUpdateNameIndex =
      !!normalizedName &&
      (!!preferredName &&
        (preferredName !== existing.displayName ||
          existing.displayNameLower !== normalizedName));

    if (shouldUpdateNameIndex && normalizedName) {
      updateExpressionParts.push("#displayName = :displayName");
      expressionValues[":displayName"] = preferredName;
      expressionNames["#displayName"] = "displayName";
      updateExpressionParts.push("#displayNameLower = :displayNameLower");
      expressionValues[":displayNameLower"] = normalizedName;
      expressionNames["#displayNameLower"] = "displayNameLower";
      updateExpressionParts.push("GSI3PK = :gsi3pk");
      expressionValues[":gsi3pk"] = namePartitionKey;
      updateExpressionParts.push("GSI3SK = :gsi3sk");
      expressionValues[":gsi3sk"] = nameSortKey(normalizedName, userId);
    }

    if (auth.email && auth.email !== existing.email) {
      updateExpressionParts.push("#email = :email");
      expressionValues[":email"] = auth.email;
      expressionNames["#email"] = "email";
      updateExpressionParts.push("GSI2PK = :gsi2pk");
      expressionValues[":gsi2pk"] = emailPartitionKey;
      updateExpressionParts.push("GSI2SK = :gsi2sk");
      expressionValues[":gsi2sk"] = `${emailSortKey(auth.email)}#${userId}`;
    }

    if (updateExpressionParts.length > 1) {
      await this.docClient.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: {
            PK: userPk(userId),
            SK: userSk
          },
          UpdateExpression: `SET ${updateExpressionParts.join(", ")}`,
          ExpressionAttributeValues: expressionValues,
          ExpressionAttributeNames: Object.keys(expressionNames).length
            ? expressionNames
            : undefined
        })
      );
    }

    return {
      ...existing,
      displayName: preferredName ?? existing.displayName,
      email: auth.email ?? existing.email,
      displayNameLower: normalizedName ?? existing.displayNameLower,
      updatedAt: now
    };
  }

  async getUser(userId: string): Promise<UserProfile | null> {
    const { Item } = await this.docClient.send(
      new GetCommand({
        TableName: this.tableName,
        Key: {
          PK: userPk(userId),
          SK: userSk
        }
      })
    );

    if (!Item) {
      return null;
    }

    if (typeof Item.aliasOf === "string" && Item.aliasOf) {
      return null;
    }

    return mapToProfile(Item as Record<string, unknown>);
  }

  async resolveAliasedUserId(userId: string): Promise<string> {
    const { Item } = await this.docClient.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { PK: userPk(userId), SK: userSk }
      })
    );
    if (Item && typeof Item.aliasOf === "string" && Item.aliasOf) {
      return Item.aliasOf;
    }
    return userId;
  }

  private async findCanonicalProfileByEmail(
    email: string,
    excludeUserId: string
  ): Promise<UserProfile | null> {
    const { Items } = await this.docClient.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: "GSI2",
        KeyConditionExpression: "GSI2PK = :pk AND begins_with(GSI2SK, :sk)",
        ExpressionAttributeValues: {
          ":pk": emailPartitionKey,
          ":sk": emailSortKey(email)
        },
        Limit: 5
      })
    );

    const match = (Items ?? []).find(
      (item) =>
        typeof item.userId === "string" &&
        item.userId !== excludeUserId &&
        !item.aliasOf
    );

    return match ? mapToProfile(match as Record<string, unknown>) : null;
  }

  async getUsersByIds(userIds: string[]): Promise<UserProfile[]> {
    if (!userIds.length) {
      return [];
    }

    const { Responses } = await this.docClient.send(
      new BatchGetCommand({
        RequestItems: {
          [this.tableName]: {
            Keys: userIds.map((userId) => ({
              PK: userPk(userId),
              SK: userSk
            }))
          }
        }
      })
    );

    const items = Responses?.[this.tableName] ?? [];
    return items.map((item) => mapToProfile(item as Record<string, unknown>));
  }

  async searchUsers(
    query: string,
    limit = 10
  ): Promise<UserProfile[]> {
    const normalized = query.trim().toLowerCase();
    if (!normalized.length) {
      return [];
    }

    const isEmailQuery = normalized.includes("@");
    const indexName = isEmailQuery ? "GSI2" : "GSI3";
    const partitionKey = isEmailQuery ? emailPartitionKey : namePartitionKey;
    const sortKeyPrefix = isEmailQuery
      ? emailSortKey(normalized)
      : `NAME#${normalized}`;
    const attributeNames = isEmailQuery
      ? { pk: "GSI2PK", sk: "GSI2SK" }
      : { pk: "GSI3PK", sk: "GSI3SK" };

    const { Items } = await this.docClient.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: indexName,
        KeyConditionExpression:
          "#pk = :pk AND begins_with(#sk, :sk)",
        ExpressionAttributeNames: {
          "#pk": attributeNames.pk,
          "#sk": attributeNames.sk
        },
        ExpressionAttributeValues: {
          ":pk": partitionKey,
          ":sk": sortKeyPrefix
        },
        Limit: limit
      })
    );

    if (!Items?.length) {
      return [];
    }

    return Items.map((item) => mapToProfile(item as Record<string, unknown>));
  }

  async updatePaymentMethods(
    userId: string,
    methods: Partial<Record<keyof NonNullable<UserProfile["paymentMethods"]>, string | null>>
  ): Promise<void> {
    const names: Record<string, string> = { "#pm": "paymentMethods" };
    const provided = Object.entries(methods).filter(
      ([, value]) => value !== undefined
    ) as Array<[keyof NonNullable<UserProfile["paymentMethods"]>, string | null]>;

    const cleaned: Record<string, string> = {};
    for (const [key, value] of provided) {
      if (value === null) continue;
      cleaned[key] = value;
    }

    const hasValues = Object.keys(cleaned).length > 0;

    const params: UpdateCommandInput = {
      TableName: this.tableName,
      Key: { PK: userPk(userId), SK: userSk },
      ConditionExpression: "attribute_exists(PK)",
      UpdateExpression: hasValues ? "SET #pm = :pm" : "REMOVE #pm",
      ExpressionAttributeNames: names
    };

    if (hasValues) {
      params.ExpressionAttributeValues = { ":pm": cleaned };
    }

    await this.docClient.send(new UpdateCommand(params));
  }
}
