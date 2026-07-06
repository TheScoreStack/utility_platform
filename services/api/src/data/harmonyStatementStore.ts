import {
  BatchWriteCommand,
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand
} from "@aws-sdk/lib-dynamodb";
import { getDocumentClient } from "./dynamo.js";
import { loadConfig } from "../config.js";
import type {
  HarmonyStagedTransaction,
  HarmonyStatement,
  HarmonyStatementCounts,
  HarmonyStatementStatus
} from "../types.js";

const STATEMENT_PK = "HARMONY_LEDGER#STATEMENT";
const STATEMENT_SK = (statementId: string) => `STATEMENT#${statementId}`;
const STAGED_PK = (statementId: string) => `HARMONY_LEDGER#STAGED#${statementId}`;
const STAGED_SK = (txnDate: string, txnId: string) => `TXN#${txnDate}#${txnId}`;
const FINGERPRINT_PK = "HARMONY_LEDGER#FP";
const FINGERPRINT_SK = (fingerprint: string) => `FP#${fingerprint}`;

type StatementEntity = HarmonyStatement & {
  entityType: "HarmonyStatement";
  PK: string;
  SK: string;
};

type StagedTxnEntity = HarmonyStagedTransaction & {
  entityType: "HarmonyStagedTransaction";
  PK: string;
  SK: string;
};

export interface FingerprintRef {
  fingerprint: string;
  statementId: string;
  txnId: string;
  entryId?: string;
}

type FingerprintEntity = FingerprintRef & {
  entityType: "HarmonyStatementFingerprint";
  PK: string;
  SK: string;
};

const stripKeys = <T>(item: Record<string, unknown>): T => {
  const { PK: _pk, SK: _sk, entityType: _et, ...rest } = item;
  return rest as T;
};

export interface UpdateStatementStatusInput {
  status: HarmonyStatementStatus;
  errorMessage?: string;
  counts?: HarmonyStatementCounts;
  parsedAt?: string;
}

export class HarmonyStatementStore {
  private readonly tableName: string;
  private readonly docClient = getDocumentClient();

  constructor() {
    this.tableName = loadConfig().tableName;
  }

  async createStatement(statement: HarmonyStatement): Promise<HarmonyStatement> {
    const entity: StatementEntity = {
      entityType: "HarmonyStatement",
      PK: STATEMENT_PK,
      SK: STATEMENT_SK(statement.statementId),
      ...statement
    };

    await this.docClient.send(
      new PutCommand({
        TableName: this.tableName,
        Item: entity,
        ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)"
      })
    );

    return statement;
  }

  async getStatement(statementId: string): Promise<HarmonyStatement | null> {
    const { Item } = await this.docClient.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { PK: STATEMENT_PK, SK: STATEMENT_SK(statementId) }
      })
    );

    if (!Item) {
      return null;
    }

    return stripKeys<HarmonyStatement>(Item as Record<string, unknown>);
  }

  async listStatements(): Promise<HarmonyStatement[]> {
    const { Items } = await this.docClient.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: "PK = :pk",
        ExpressionAttributeValues: { ":pk": STATEMENT_PK }
      })
    );

    if (!Items?.length) {
      return [];
    }

    return Items.map((item) =>
      stripKeys<HarmonyStatement>(item as Record<string, unknown>)
    ).sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
  }

  /**
   * Transition a statement into PROCESSING only from PENDING_UPLOAD or FAILED.
   * Returns false when the guard fails (already processing/parsed) so duplicate
   * S3 events can be ignored.
   */
  async claimStatementForProcessing(statementId: string): Promise<boolean> {
    try {
      await this.docClient.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: { PK: STATEMENT_PK, SK: STATEMENT_SK(statementId) },
          UpdateExpression: "SET #status = :processing REMOVE errorMessage",
          ConditionExpression: "#status IN (:pending, :failed)",
          ExpressionAttributeNames: { "#status": "status" },
          ExpressionAttributeValues: {
            ":processing": "PROCESSING",
            ":pending": "PENDING_UPLOAD",
            ":failed": "FAILED"
          }
        })
      );
      return true;
    } catch (error) {
      if ((error as Error).name === "ConditionalCheckFailedException") {
        return false;
      }
      throw error;
    }
  }

  async updateStatementStatus(
    statementId: string,
    updates: UpdateStatementStatusInput
  ): Promise<void> {
    const sets: string[] = ["#status = :status"];
    const removes: string[] = [];
    const values: Record<string, unknown> = { ":status": updates.status };

    if (updates.errorMessage !== undefined) {
      sets.push("errorMessage = :errorMessage");
      values[":errorMessage"] = updates.errorMessage;
    } else {
      removes.push("errorMessage");
    }
    if (updates.counts !== undefined) {
      sets.push("counts = :counts");
      values[":counts"] = updates.counts;
    }
    if (updates.parsedAt !== undefined) {
      sets.push("parsedAt = :parsedAt");
      values[":parsedAt"] = updates.parsedAt;
    }

    await this.docClient.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { PK: STATEMENT_PK, SK: STATEMENT_SK(statementId) },
        UpdateExpression:
          `SET ${sets.join(", ")}` +
          (removes.length ? ` REMOVE ${removes.join(", ")}` : ""),
        ExpressionAttributeNames: { "#status": "status" },
        ExpressionAttributeValues: values
      })
    );
  }

  async updateStatementCounts(
    statementId: string,
    counts: HarmonyStatementCounts
  ): Promise<void> {
    await this.docClient.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { PK: STATEMENT_PK, SK: STATEMENT_SK(statementId) },
        UpdateExpression: "SET counts = :counts",
        ExpressionAttributeValues: { ":counts": counts }
      })
    );
  }

  async deleteStatement(statementId: string): Promise<void> {
    await this.docClient.send(
      new DeleteCommand({
        TableName: this.tableName,
        Key: { PK: STATEMENT_PK, SK: STATEMENT_SK(statementId) }
      })
    );
  }

  async putStagedTransactions(txns: HarmonyStagedTransaction[]): Promise<void> {
    for (let i = 0; i < txns.length; i += 25) {
      const batch = txns.slice(i, i + 25).map((txn) => {
        const entity: StagedTxnEntity = {
          entityType: "HarmonyStagedTransaction",
          PK: STAGED_PK(txn.statementId),
          SK: STAGED_SK(txn.txnDate, txn.txnId),
          ...txn
        };
        return { PutRequest: { Item: entity } };
      });

      await this.docClient.send(
        new BatchWriteCommand({
          RequestItems: { [this.tableName]: batch }
        })
      );
    }
  }

  async listStagedTransactions(
    statementId: string
  ): Promise<HarmonyStagedTransaction[]> {
    const items: HarmonyStagedTransaction[] = [];
    let lastKey: Record<string, unknown> | undefined;

    do {
      const { Items, LastEvaluatedKey } = await this.docClient.send(
        new QueryCommand({
          TableName: this.tableName,
          KeyConditionExpression: "PK = :pk",
          ExpressionAttributeValues: { ":pk": STAGED_PK(statementId) },
          ExclusiveStartKey: lastKey
        })
      );
      for (const item of Items ?? []) {
        items.push(
          stripKeys<HarmonyStagedTransaction>(item as Record<string, unknown>)
        );
      }
      lastKey = LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (lastKey);

    return items;
  }

  async getStagedTransaction(
    statementId: string,
    txnDate: string,
    txnId: string
  ): Promise<HarmonyStagedTransaction | null> {
    const { Item } = await this.docClient.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { PK: STAGED_PK(statementId), SK: STAGED_SK(txnDate, txnId) }
      })
    );

    if (!Item) {
      return null;
    }

    return stripKeys<HarmonyStagedTransaction>(Item as Record<string, unknown>);
  }

  async updateStagedTransaction(
    statementId: string,
    txnDate: string,
    txnId: string,
    updates: {
      status: HarmonyStagedTransaction["status"];
      createdEntryId?: string;
      createdEntryRecordedAt?: string;
      reviewedAt: string;
      reviewedBy: string;
      /** Drop the created-entry pointers (un-confirm). */
      clearCreatedEntry?: boolean;
    }
  ): Promise<HarmonyStagedTransaction> {
    const sets = [
      "#status = :status",
      "reviewedAt = :reviewedAt",
      "reviewedBy = :reviewedBy"
    ];
    const removes: string[] = [];
    const values: Record<string, unknown> = {
      ":status": updates.status,
      ":reviewedAt": updates.reviewedAt,
      ":reviewedBy": updates.reviewedBy
    };
    if (updates.clearCreatedEntry) {
      removes.push("createdEntryId", "createdEntryRecordedAt");
    } else {
      if (updates.createdEntryId !== undefined) {
        sets.push("createdEntryId = :createdEntryId");
        values[":createdEntryId"] = updates.createdEntryId;
      }
      if (updates.createdEntryRecordedAt !== undefined) {
        sets.push("createdEntryRecordedAt = :createdEntryRecordedAt");
        values[":createdEntryRecordedAt"] = updates.createdEntryRecordedAt;
      }
    }

    const response = await this.docClient.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { PK: STAGED_PK(statementId), SK: STAGED_SK(txnDate, txnId) },
        UpdateExpression:
          `SET ${sets.join(", ")}` +
          (removes.length ? ` REMOVE ${removes.join(", ")}` : ""),
        ExpressionAttributeNames: { "#status": "status" },
        ExpressionAttributeValues: values,
        ReturnValues: "ALL_NEW"
      })
    );

    return stripKeys<HarmonyStagedTransaction>(
      response.Attributes as Record<string, unknown>
    );
  }

  async deleteStagedTransactionsForStatement(statementId: string): Promise<void> {
    const txns = await this.listStagedTransactions(statementId);
    await this.batchDelete(
      txns.map((txn) => ({
        PK: STAGED_PK(statementId),
        SK: STAGED_SK(txn.txnDate, txn.txnId)
      }))
    );
  }

  /**
   * Register a fingerprint. Returns null when this call claimed it, or the
   * existing owner when another transaction already holds it.
   */
  async claimFingerprint(ref: FingerprintRef): Promise<FingerprintRef | null> {
    const entity: FingerprintEntity = {
      entityType: "HarmonyStatementFingerprint",
      PK: FINGERPRINT_PK,
      SK: FINGERPRINT_SK(ref.fingerprint),
      ...ref
    };

    try {
      await this.docClient.send(
        new PutCommand({
          TableName: this.tableName,
          Item: entity,
          ConditionExpression:
            "attribute_not_exists(PK) AND attribute_not_exists(SK)"
        })
      );
      return null;
    } catch (error) {
      if ((error as Error).name !== "ConditionalCheckFailedException") {
        throw error;
      }
      const { Item } = await this.docClient.send(
        new GetCommand({
          TableName: this.tableName,
          Key: { PK: FINGERPRINT_PK, SK: FINGERPRINT_SK(ref.fingerprint) }
        })
      );
      return Item
        ? stripKeys<FingerprintRef>(Item as Record<string, unknown>)
        : null;
    }
  }

  async attachEntryToFingerprint(
    fingerprint: string,
    entryId: string
  ): Promise<void> {
    await this.docClient.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { PK: FINGERPRINT_PK, SK: FINGERPRINT_SK(fingerprint) },
        UpdateExpression: "SET entryId = :entryId",
        ExpressionAttributeValues: { ":entryId": entryId }
      })
    );
  }

  async clearEntryFromFingerprint(fingerprint: string): Promise<void> {
    await this.docClient.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { PK: FINGERPRINT_PK, SK: FINGERPRINT_SK(fingerprint) },
        UpdateExpression: "REMOVE entryId"
      })
    );
  }

  async deleteFingerprintsForStatement(statementId: string): Promise<void> {
    // Only delete fingerprints this statement owns — a duplicate txn's
    // fingerprint belongs to the original statement.
    const txns = await this.listStagedTransactions(statementId);
    const owned = txns
      .filter((txn) => !txn.duplicateOf)
      .map((txn) => ({
        PK: FINGERPRINT_PK,
        SK: FINGERPRINT_SK(txn.fingerprint)
      }));
    await this.batchDelete(owned);
  }

  private async batchDelete(keys: { PK: string; SK: string }[]): Promise<void> {
    for (let i = 0; i < keys.length; i += 25) {
      const batch = keys.slice(i, i + 25).map((key) => ({
        DeleteRequest: { Key: key }
      }));
      await this.docClient.send(
        new BatchWriteCommand({
          RequestItems: { [this.tableName]: batch }
        })
      );
    }
  }
}
