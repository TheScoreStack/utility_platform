import type { Context, S3Event, S3EventRecord } from "aws-lambda";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { nanoid } from "nanoid";
import { HarmonyLedgerStore } from "../data/harmonyLedgerStore.js";
import { HarmonyStatementStore } from "../data/harmonyStatementStore.js";
import { loadConfig } from "../config.js";
import {
  computeEntryFingerprints,
  computeFingerprint,
  parseStatement
} from "../services/statementParsingService.js";
import type { HarmonyStagedTransaction } from "../types.js";

const MAX_STATEMENT_BYTES = 18 * 1024 * 1024;

const statementStore = new HarmonyStatementStore();
const ledgerStore = new HarmonyLedgerStore();

let s3Client: S3Client | null = null;
const getS3Client = () => {
  if (!s3Client) {
    s3Client = new S3Client({ region: loadConfig().region });
  }
  return s3Client;
};

const isoNow = () => new Date().toISOString();

const extractStatementId = (record: S3EventRecord): string | null => {
  const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, " "));
  const match = key.match(/^harmony\/statements\/(stmt_[^/.]+)/);
  if (!match) {
    console.warn("Unable to parse key for harmony statement", key);
    return null;
  }
  return match[1];
};

const processRecord = async (record: S3EventRecord): Promise<void> => {
  const statementId = extractStatementId(record);
  if (!statementId) return;

  const statement = await statementStore.getStatement(statementId);
  if (!statement) {
    console.warn("No statement record for uploaded object", { statementId });
    return;
  }

  // Retry invocations (via the /retry endpoint) have already moved the
  // statement into PROCESSING, so the duplicate-event claim must be skipped.
  const isRetry = Boolean(
    (record as S3EventRecord & { harmonyRetry?: boolean }).harmonyRetry
  );
  if (!isRetry) {
    // Duplicate S3 events (and re-uploads mid-parse) are ignored; only
    // PENDING_UPLOAD or FAILED statements may enter PROCESSING.
    const claimed =
      await statementStore.claimStatementForProcessing(statementId);
    if (!claimed) {
      console.info("Statement already processing or parsed; skipping", {
        statementId
      });
      return;
    }
  }

  try {
    if ((record.s3.object.size ?? 0) > MAX_STATEMENT_BYTES) {
      throw new Error(
        "Statement is too large to parse (18 MB max). Try exporting a shorter date range."
      );
    }

    const s3 = getS3Client();
    const object = await s3.send(
      new GetObjectCommand({
        Bucket: record.s3.bucket.name,
        Key: decodeURIComponent(record.s3.object.key.replace(/\+/g, " "))
      })
    );
    const bytes = Buffer.from(
      await object.Body!.transformToByteArray()
    );
    if (bytes.length > MAX_STATEMENT_BYTES) {
      throw new Error(
        "Statement is too large to parse (18 MB max). Try exporting a shorter date range."
      );
    }

    const [groups, entries] = await Promise.all([
      ledgerStore.listGroups(),
      ledgerStore.listEntries()
    ]);

    const parsed = await parseStatement({
      bytes,
      fileType: statement.fileType,
      sourceType: statement.sourceType,
      context: { groups, recentEntries: entries }
    });

    // Re-parses of a FAILED statement start from a clean slate.
    await statementStore.deleteFingerprintsForStatement(statementId);
    await statementStore.deleteStagedTransactionsForStatement(statementId);

    const entryFingerprints = computeEntryFingerprints(entries);
    const groupNames = new Map(groups.map((g) => [g.groupId, g.name]));

    const staged: HarmonyStagedTransaction[] = [];
    for (const txn of parsed) {
      const fingerprint = computeFingerprint({
        txnDate: txn.txnDate,
        amount: txn.amount,
        direction: txn.direction,
        description: txn.rawDescription
      });
      const txnId = `stx_${nanoid(10)}`;

      let duplicateOf: HarmonyStagedTransaction["duplicateOf"];
      const matchingEntry = entryFingerprints.get(fingerprint);
      if (matchingEntry) {
        duplicateOf = { kind: "entry", id: matchingEntry };
      } else {
        const existing = await statementStore.claimFingerprint({
          fingerprint,
          statementId,
          txnId
        });
        if (existing) {
          duplicateOf = existing.entryId
            ? { kind: "entry", id: existing.entryId }
            : { kind: "staged", id: existing.txnId };
        }
      }

      staged.push({
        txnId,
        statementId,
        txnDate: txn.txnDate,
        amount: txn.amount,
        currency: txn.currency,
        direction: txn.direction,
        rawDescription: txn.rawDescription,
        counterparty: txn.counterparty,
        suggestedType: txn.suggestedType,
        suggestedGroupId: txn.suggestedGroupId,
        suggestedGroupName: txn.suggestedGroupId
          ? groupNames.get(txn.suggestedGroupId)
          : undefined,
        isLikelyInternalTransfer: txn.isLikelyInternalTransfer,
        confidence: txn.confidence,
        fingerprint,
        duplicateOf,
        status: "PENDING"
      });
    }

    await statementStore.putStagedTransactions(staged);
    await statementStore.updateStatementStatus(statementId, {
      status: "PARSED",
      parsedAt: isoNow(),
      counts: {
        total: staged.length,
        pending: staged.length,
        confirmed: 0,
        dismissed: 0,
        duplicates: staged.filter((txn) => Boolean(txn.duplicateOf)).length
      }
    });
  } catch (error) {
    console.error("Failed to parse harmony statement", { statementId, error });
    const message =
      error instanceof Error ? error.message : "Unknown parsing error";
    await statementStore.updateStatementStatus(statementId, {
      status: "FAILED",
      errorMessage: message.slice(0, 500)
    });
  }
};

export const handler = async (
  event: S3Event,
  _context: Context
): Promise<void> => {
  // Statements are parsed sequentially — Bedrock calls are heavy and events
  // rarely batch more than one object.
  for (const record of event.Records) {
    await processRecord(record);
  }
};
