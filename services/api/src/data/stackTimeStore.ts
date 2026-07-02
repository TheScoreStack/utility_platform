import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand
} from "@aws-sdk/lib-dynamodb";
import { getDocumentClient } from "./dynamo.js";
import { loadConfig } from "../config.js";
import type {
  StackTimeAccessRecord,
  StackTimeEntry,
  StackTimeProject
} from "../types.js";

// Key patterns
const ACCESS_PK = "STACKTIME#ACCESS";
const ACCESS_SK = (accessId: string) => `ACCESS#${accessId}`;
const PROJECT_PK = "STACKTIME#PROJECT";
const PROJECT_SK = (projectId: string) => `PROJECT#${projectId}`;
const ENTRY_PK = (userId: string) => `USER#${userId}`;
const ENTRY_SK = (date: string, entryId: string) => `STACKTIME#${date}#${entryId}`;

type AccessEntity = StackTimeAccessRecord & {
  entityType: "StackTimeAccess";
  PK: string;
  SK: string;
  normalizedEmail?: string;
  GSI1PK?: string;
  GSI1SK?: string;
  GSI2PK?: string;
  GSI2SK?: string;
};

type ProjectEntity = StackTimeProject & {
  entityType: "StackTimeProject";
  PK: string;
  SK: string;
};

type EntryEntity = StackTimeEntry & {
  entityType: "StackTimeEntry";
  PK: string;
  SK: string;
  GSI1PK?: string;
  GSI1SK?: string;
};

const mapAccess = (item: Record<string, unknown>): StackTimeAccessRecord => ({
  accessId: item.accessId as string,
  userId: (item.userId as string) || undefined,
  email: (item.email as string) || undefined,
  displayName: (item.displayName as string) || undefined,
  isAdmin: Boolean(item.isAdmin),
  addedAt: item.addedAt as string,
  addedBy: item.addedBy as string,
  addedByName: (item.addedByName as string) || undefined
});

const mapProject = (item: Record<string, unknown>): StackTimeProject => ({
  projectId: item.projectId as string,
  name: item.name as string,
  isActive: Boolean(item.isActive),
  createdAt: item.createdAt as string,
  createdBy: item.createdBy as string
});

const mapEntry = (item: Record<string, unknown>): StackTimeEntry => ({
  entryId: item.entryId as string,
  userId: item.userId as string,
  userDisplayName: (item.userDisplayName as string) || undefined,
  projectId: item.projectId as string,
  projectName: (item.projectName as string) || undefined,
  date: item.date as string,
  hours: Number(item.hours),
  description: (item.description as string) || undefined,
  createdAt: item.createdAt as string,
  updatedAt: item.updatedAt as string,
  createdBy: item.createdBy as string,
  createdByName: (item.createdByName as string) || undefined
});

export interface CreateAccessRecordInput {
  accessId: string;
  userId?: string;
  email?: string;
  normalizedEmail?: string;
  displayName?: string;
  isAdmin: boolean;
  addedAt: string;
  addedBy: string;
  addedByName?: string;
}

export class StackTimeStore {
  private readonly tableName: string;
  private readonly docClient = getDocumentClient();

  constructor() {
    this.tableName = loadConfig().tableName;
  }

  // Access records

  async listAccessRecords(): Promise<StackTimeAccessRecord[]> {
    const { Items } = await this.docClient.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: "PK = :pk",
        ExpressionAttributeValues: {
          ":pk": ACCESS_PK
        }
      })
    );

    if (!Items?.length) {
      return [];
    }

    return Items.map((item) => mapAccess(item as Record<string, unknown>));
  }

  async findAccessByUserId(userId: string): Promise<StackTimeAccessRecord | null> {
    const { Items } = await this.docClient.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: "GSI1",
        KeyConditionExpression: "GSI1PK = :pk",
        ExpressionAttributeValues: {
          ":pk": `STACKTIME#USER#${userId}`
        },
        Limit: 1
      })
    );

    if (!Items?.length) {
      return null;
    }

    return mapAccess(Items[0] as Record<string, unknown>);
  }

  async findAccessByEmail(normalizedEmail: string): Promise<StackTimeAccessRecord | null> {
    const { Items } = await this.docClient.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: "GSI2",
        KeyConditionExpression: "GSI2PK = :pk AND begins_with(GSI2SK, :sk)",
        ExpressionAttributeValues: {
          ":pk": "STACKTIME#EMAIL",
          ":sk": `EMAIL#${normalizedEmail}`
        },
        Limit: 1
      })
    );

    if (!Items?.length) {
      return null;
    }

    return mapAccess(Items[0] as Record<string, unknown>);
  }

  async createAccessRecord(record: CreateAccessRecordInput): Promise<StackTimeAccessRecord> {
    const entity: AccessEntity = {
      entityType: "StackTimeAccess",
      PK: ACCESS_PK,
      SK: ACCESS_SK(record.accessId),
      accessId: record.accessId,
      userId: record.userId,
      email: record.email,
      normalizedEmail: record.normalizedEmail,
      displayName: record.displayName,
      isAdmin: record.isAdmin,
      addedAt: record.addedAt,
      addedBy: record.addedBy,
      addedByName: record.addedByName,
      ...(record.userId
        ? {
            GSI1PK: `STACKTIME#USER#${record.userId}`,
            GSI1SK: ACCESS_SK(record.accessId)
          }
        : {}),
      ...(record.normalizedEmail
        ? {
            GSI2PK: "STACKTIME#EMAIL",
            GSI2SK: `EMAIL#${record.normalizedEmail}#${record.accessId}`
          }
        : {})
    };

    await this.docClient.send(
      new PutCommand({
        TableName: this.tableName,
        Item: entity,
        ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)"
      })
    );

    return mapAccess(entity as unknown as Record<string, unknown>);
  }

  async attachUserToAccess(accessId: string, userId: string): Promise<void> {
    await this.docClient.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: {
          PK: ACCESS_PK,
          SK: ACCESS_SK(accessId)
        },
        UpdateExpression: "SET userId = :userId, GSI1PK = :gsi1pk, GSI1SK = :gsi1sk",
        ExpressionAttributeValues: {
          ":userId": userId,
          ":gsi1pk": `STACKTIME#USER#${userId}`,
          ":gsi1sk": ACCESS_SK(accessId)
        }
      })
    );
  }

  async deleteAccessRecord(accessId: string): Promise<void> {
    await this.docClient.send(
      new DeleteCommand({
        TableName: this.tableName,
        Key: {
          PK: ACCESS_PK,
          SK: ACCESS_SK(accessId)
        }
      })
    );
  }

  async updateAccessDisplayName(accessId: string, displayName: string): Promise<void> {
    await this.docClient.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: {
          PK: ACCESS_PK,
          SK: ACCESS_SK(accessId)
        },
        UpdateExpression: "SET displayName = :displayName",
        ExpressionAttributeValues: {
          ":displayName": displayName
        }
      })
    );
  }

  // Projects

  async listProjects(): Promise<StackTimeProject[]> {
    const { Items } = await this.docClient.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: "PK = :pk",
        ExpressionAttributeValues: {
          ":pk": PROJECT_PK
        }
      })
    );

    if (!Items?.length) {
      return [];
    }

    return Items.map((item) => mapProject(item as Record<string, unknown>));
  }

  async getProject(projectId: string): Promise<StackTimeProject | null> {
    const { Item } = await this.docClient.send(
      new GetCommand({
        TableName: this.tableName,
        Key: {
          PK: PROJECT_PK,
          SK: PROJECT_SK(projectId)
        }
      })
    );

    if (!Item) {
      return null;
    }

    return mapProject(Item as Record<string, unknown>);
  }

  async createProject(project: StackTimeProject): Promise<void> {
    const entity: ProjectEntity = {
      entityType: "StackTimeProject",
      PK: PROJECT_PK,
      SK: PROJECT_SK(project.projectId),
      ...project
    };

    await this.docClient.send(
      new PutCommand({
        TableName: this.tableName,
        Item: entity,
        ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)"
      })
    );
  }

  async updateProject(
    projectId: string,
    updates: { name?: string; isActive?: boolean }
  ): Promise<void> {
    const expressions: string[] = [];
    const values: Record<string, unknown> = {};

    if (updates.name !== undefined) {
      expressions.push("name = :name");
      values[":name"] = updates.name;
    }
    if (updates.isActive !== undefined) {
      expressions.push("isActive = :isActive");
      values[":isActive"] = updates.isActive;
    }

    if (!expressions.length) {
      return;
    }

    await this.docClient.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: {
          PK: PROJECT_PK,
          SK: PROJECT_SK(projectId)
        },
        UpdateExpression: `SET ${expressions.join(", ")}`,
        ExpressionAttributeValues: values
      })
    );
  }

  // Time entries

  async listEntriesForUser(
    userId: string,
    dateRange?: { startDate?: string; endDate?: string }
  ): Promise<StackTimeEntry[]> {
    const keyCondition = "PK = :pk AND begins_with(SK, :skPrefix)";
    const values: Record<string, unknown> = {
      ":pk": ENTRY_PK(userId),
      ":skPrefix": "STACKTIME#"
    };

    // If date range provided, we filter after query since SK includes date
    const { Items } = await this.docClient.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: keyCondition,
        ExpressionAttributeValues: values,
        ScanIndexForward: false // Most recent first
      })
    );

    if (!Items?.length) {
      return [];
    }

    let entries = Items.map((item) => mapEntry(item as Record<string, unknown>));

    // Apply date range filter
    if (dateRange?.startDate) {
      entries = entries.filter((e) => e.date >= dateRange.startDate!);
    }
    if (dateRange?.endDate) {
      entries = entries.filter((e) => e.date <= dateRange.endDate!);
    }

    return entries;
  }

  async listEntriesForProject(projectId: string): Promise<StackTimeEntry[]> {
    const { Items } = await this.docClient.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: "GSI1",
        KeyConditionExpression: "GSI1PK = :pk",
        ExpressionAttributeValues: {
          ":pk": `STACKTIME#PROJECT#${projectId}`
        },
        ScanIndexForward: false
      })
    );

    if (!Items?.length) {
      return [];
    }

    return Items.map((item) => mapEntry(item as Record<string, unknown>));
  }

  async listAllEntries(
    dateRange?: { startDate?: string; endDate?: string }
  ): Promise<StackTimeEntry[]> {
    // Query all projects and aggregate
    const projects = await this.listProjects();
    const allEntries: StackTimeEntry[] = [];

    for (const project of projects) {
      const entries = await this.listEntriesForProject(project.projectId);
      allEntries.push(...entries);
    }

    // Apply date filters
    let filtered = allEntries;
    if (dateRange?.startDate) {
      filtered = filtered.filter((e) => e.date >= dateRange.startDate!);
    }
    if (dateRange?.endDate) {
      filtered = filtered.filter((e) => e.date <= dateRange.endDate!);
    }

    // Sort by date descending
    filtered.sort((a, b) => b.date.localeCompare(a.date));

    return filtered;
  }

  async createEntry(entry: StackTimeEntry): Promise<void> {
    const entity: EntryEntity = {
      entityType: "StackTimeEntry",
      PK: ENTRY_PK(entry.userId),
      SK: ENTRY_SK(entry.date, entry.entryId),
      GSI1PK: `STACKTIME#PROJECT#${entry.projectId}`,
      GSI1SK: ENTRY_SK(entry.date, entry.entryId),
      ...entry
    };

    await this.docClient.send(
      new PutCommand({
        TableName: this.tableName,
        Item: entity,
        ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)"
      })
    );
  }

  async getEntry(userId: string, date: string, entryId: string): Promise<StackTimeEntry | null> {
    const { Item } = await this.docClient.send(
      new GetCommand({
        TableName: this.tableName,
        Key: {
          PK: ENTRY_PK(userId),
          SK: ENTRY_SK(date, entryId)
        }
      })
    );

    if (!Item) {
      return null;
    }

    return mapEntry(Item as Record<string, unknown>);
  }

  async updateEntry(
    userId: string,
    date: string,
    entryId: string,
    updates: {
      projectId?: string;
      projectName?: string;
      hours?: number;
      description?: string;
      updatedAt: string;
    }
  ): Promise<void> {
    const expressions: string[] = ["updatedAt = :updatedAt"];
    const values: Record<string, unknown> = { ":updatedAt": updates.updatedAt };

    if (updates.projectId !== undefined) {
      expressions.push("projectId = :projectId");
      values[":projectId"] = updates.projectId;
      expressions.push("GSI1PK = :gsi1pk");
      values[":gsi1pk"] = `STACKTIME#PROJECT#${updates.projectId}`;
    }
    if (updates.projectName !== undefined) {
      expressions.push("projectName = :projectName");
      values[":projectName"] = updates.projectName;
    }
    if (updates.hours !== undefined) {
      expressions.push("hours = :hours");
      values[":hours"] = updates.hours;
    }
    if (updates.description !== undefined) {
      expressions.push("description = :description");
      values[":description"] = updates.description;
    }

    await this.docClient.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: {
          PK: ENTRY_PK(userId),
          SK: ENTRY_SK(date, entryId)
        },
        UpdateExpression: `SET ${expressions.join(", ")}`,
        ExpressionAttributeValues: values
      })
    );
  }

  async deleteEntry(userId: string, date: string, entryId: string): Promise<void> {
    await this.docClient.send(
      new DeleteCommand({
        TableName: this.tableName,
        Key: {
          PK: ENTRY_PK(userId),
          SK: ENTRY_SK(date, entryId)
        }
      })
    );
  }

  async moveEntry(
    userId: string,
    oldDate: string,
    entryId: string,
    newEntry: StackTimeEntry
  ): Promise<void> {
    // Delete old entry and create new one with updated date
    // This is necessary because date is part of the sort key
    await this.deleteEntry(userId, oldDate, entryId);
    await this.createEntry(newEntry);
  }
}
