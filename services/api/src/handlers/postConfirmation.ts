import type { PostConfirmationTriggerEvent } from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand
} from "@aws-sdk/lib-dynamodb";

const TABLE_NAME = process.env.TABLE_NAME;
const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const userPk = (userId: string) => `USER#${userId}`;
const userSk = "PROFILE";
const emailPartitionKey = "EMAIL";
const emailSortKey = (email: string) => `EMAIL#${email.toLowerCase()}`;
const namePartitionKey = "NAME";
const nameSortKey = (name: string, userId: string) =>
  `NAME#${name.toLowerCase()}#${userId}`;

const findExistingProfileByEmail = async (
  email: string,
  excludeUserId: string
): Promise<{ userId: string } | null> => {
  const { Items } = await client.send(
    new QueryCommand({
      TableName: TABLE_NAME,
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

  return match ? { userId: match.userId as string } : null;
};

export const handler = async (event: PostConfirmationTriggerEvent) => {
  if (!TABLE_NAME) {
    throw new Error("TABLE_NAME environment variable is required");
  }

  const userId = event.userName;
  if (!userId) {
    return event;
  }

  const attributes = event.request.userAttributes ?? {};
  const email = attributes.email;
  const preferredName =
    attributes.name ??
    (email ? email.split("@")[0] : undefined) ??
    "Unnamed Person";
  const normalizedName = preferredName
    ? preferredName.trim().toLowerCase()
    : undefined;
  const now = new Date().toISOString();

  const existing = await client.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: {
        PK: userPk(userId),
        SK: userSk
      }
    })
  );

  const existingItem = existing.Item as Record<string, unknown> | undefined;

  if (!existingItem) {
    const canonical = email
      ? await findExistingProfileByEmail(email, userId)
      : null;

    if (canonical) {
      console.warn(
        `postConfirmation: profile already exists for ${email} under userId ${canonical.userId}; writing alias from new sub ${userId}`
      );
      await client.send(
        new PutCommand({
          TableName: TABLE_NAME,
          Item: {
            entityType: "UserProfileAlias" as const,
            PK: userPk(userId),
            SK: userSk,
            userId,
            aliasOf: canonical.userId,
            email,
            createdAt: now,
            updatedAt: now
          },
          ConditionExpression: "attribute_not_exists(PK)"
        })
      );
      return event;
    }

    const item = {
      entityType: "UserProfile" as const,
      PK: userPk(userId),
      SK: userSk,
      userId,
      displayName: preferredName,
      displayNameLower: normalizedName,
      email,
      createdAt: now,
      updatedAt: now,
      ...(email
        ? {
            GSI2PK: emailPartitionKey,
            GSI2SK: `${emailSortKey(email)}#${userId}`
          }
        : {}),
      ...(normalizedName
        ? {
            GSI3PK: namePartitionKey,
            GSI3SK: nameSortKey(normalizedName, userId)
          }
        : {})
    };

    await client.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: item,
        ConditionExpression: "attribute_not_exists(PK)"
      })
    );

    return event;
  }

  if (existingItem.aliasOf) {
    return event;
  }

  const updateExpressionParts: string[] = ["updatedAt = :updatedAt"];
  const expressionValues: Record<string, unknown> = {
    ":updatedAt": now
  };
  const expressionNames: Record<string, string> = {};

  const existingEmail = existingItem.email as string | undefined;
  if (email && email !== existingEmail) {
    updateExpressionParts.push("#email = :email");
    expressionValues[":email"] = email;
    expressionNames["#email"] = "email";
    updateExpressionParts.push("GSI2PK = :gsi2pk");
    expressionValues[":gsi2pk"] = emailPartitionKey;
    updateExpressionParts.push("GSI2SK = :gsi2sk");
    expressionValues[":gsi2sk"] = `${emailSortKey(email)}#${userId}`;
  }

  const existingDisplayName = existingItem.displayName as string | undefined;
  const existingDisplayNameLower = existingItem.displayNameLower as string | undefined;

  if (
    normalizedName &&
    (existingDisplayName !== preferredName ||
      existingDisplayNameLower !== normalizedName)
  ) {
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

  if (updateExpressionParts.length > 1) {
    await client.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
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

  return event;
};
