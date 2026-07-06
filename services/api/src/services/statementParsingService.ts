import { createHash } from "node:crypto";
import { AnthropicBedrockMantle } from "@anthropic-ai/bedrock-sdk";
import { loadConfig } from "../config.js";
import type {
  HarmonyLedgerEntry,
  HarmonyLedgerEntryType,
  HarmonyLedgerGroup,
  HarmonyStatementFileType,
  HarmonyStatementSourceType,
  HarmonyTxnDirection
} from "../types.js";

/** A parsed statement transaction before it gets ids/fingerprints assigned. */
export interface ParsedStatementTransaction {
  txnDate: string;
  amount: number;
  currency: string;
  direction: HarmonyTxnDirection;
  rawDescription: string;
  counterparty?: string;
  suggestedType: HarmonyLedgerEntryType;
  suggestedGroupId?: string;
  suggestedCategory?: string;
  isLikelyInternalTransfer?: boolean;
  confidence?: number;
}

export interface StatementParseContext {
  groups: HarmonyLedgerGroup[];
  recentEntries: HarmonyLedgerEntry[];
}

export interface ParseStatementInput {
  bytes: Buffer;
  fileType: HarmonyStatementFileType;
  sourceType: HarmonyStatementSourceType;
  context: StatementParseContext;
}

const CSV_CHUNK_ROWS = 200;
const MAX_CONTEXT_ENTRIES = 100;

let bedrockClient: AnthropicBedrockMantle | null = null;
const getClient = (): AnthropicBedrockMantle => {
  if (!bedrockClient) {
    const config = loadConfig();
    bedrockClient = new AnthropicBedrockMantle({
      awsRegion: config.bedrockRegion || config.region
    });
  }
  return bedrockClient;
};

/** Test hook — inject a fake client. */
export const setBedrockClientForTesting = (
  client: AnthropicBedrockMantle | null
): void => {
  bedrockClient = client;
};

export const normalizeDescription = (description: string): string =>
  description
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\b\d{6,}\b/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 40)
    .trim();

export const computeFingerprint = (txn: {
  txnDate: string;
  amount: number;
  direction: HarmonyTxnDirection;
  description: string;
}): string =>
  createHash("sha256")
    .update(
      [
        txn.txnDate,
        Math.round(txn.amount * 100),
        txn.direction,
        normalizeDescription(txn.description)
      ].join("|")
    )
    .digest("hex");

const entryDirection = (type: HarmonyLedgerEntryType): HarmonyTxnDirection =>
  type === "EXPENSE" ? "OUT" : "IN";

/**
 * Best-effort fingerprints for existing ledger entries. Imported entries carry
 * an exact importFingerprint; manual entries hash their recorded/occurred date
 * plus amount and description.
 */
export const computeEntryFingerprints = (
  entries: HarmonyLedgerEntry[]
): Map<string, string> => {
  const map = new Map<string, string>();
  for (const entry of entries) {
    if (entry.importFingerprint) {
      map.set(entry.importFingerprint, entry.entryId);
      continue;
    }
    const date = entry.occurredAt ?? entry.recordedAt.slice(0, 10);
    const description = entry.description ?? entry.source ?? "";
    if (!description) continue;
    map.set(
      computeFingerprint({
        txnDate: date,
        amount: entry.amount,
        direction: entryDirection(entry.type),
        description
      }),
      entry.entryId
    );
  }
  return map;
};

/** Split a CSV into chunks of at most maxRows data rows, repeating the header. */
export const chunkCsv = (
  csvText: string,
  maxRows: number = CSV_CHUNK_ROWS
): string[] => {
  const lines = csvText.split(/\r?\n/);
  const firstContent = lines.findIndex((line) => line.trim().length > 0);
  if (firstContent === -1) {
    return [];
  }
  const header = lines[firstContent];
  const rows = lines
    .slice(firstContent + 1)
    .filter((line) => line.trim().length > 0);

  if (rows.length <= maxRows) {
    return [[header, ...rows].join("\n")];
  }

  const chunks: string[] = [];
  for (let i = 0; i < rows.length; i += maxRows) {
    chunks.push([header, ...rows.slice(i, i + maxRows)].join("\n"));
  }
  return chunks;
};

const SYSTEM_PROMPT = `You extract financial transactions from bank, Venmo, and PayPal statements for a small private collective ledger ("Harmony Collective").

Entry types:
- DONATION: money given to the collective with nothing owed in return
- INCOME: earned money (payouts, sales, show revenue, interest)
- EXPENSE: money spent by the collective
- REIMBURSEMENT: money coming back in that repays a prior expense

Rules:
- Every row or line that represents a completed money movement becomes exactly one transaction. Skip pending, declined, and authorization-only lines. Skip balance summaries and totals.
- amount is always positive; use direction IN for money in and OUT for money out.
- date is the transaction date in YYYY-MM-DD.
- Flag transfers between the collective's own accounts (e.g. "Transfer to Savings", Venmo-to-bank cashouts, PayPal withdrawals to bank) with isLikelyInternalTransfer=true.
- suggestedGroupId must be one of the provided group ids, or null when unsure.
- suggestedCategory is a short lowercase bookkeeping category (one or two words, e.g. "supplies", "equipment", "food", "venue", "fees", "merch", "door"). Prefer a category already used in the ledger when one fits; null when unsure.
- For Venmo/PayPal, put the other party's name in counterparty and use the memo or note to infer the entry type and group.
- IN transactions must be DONATION, INCOME, or REIMBURSEMENT; OUT transactions must be EXPENSE.
- confidence is your 0-1 confidence in the suggested type and group.`;

export const buildStatementPrompt = (input: {
  sourceType: HarmonyStatementSourceType;
  fileType: HarmonyStatementFileType;
  context: StatementParseContext;
}): { system: string; userPrefix: string } => {
  const groups = input.context.groups
    .filter((group) => group.isActive)
    .map((group) => ({ groupId: group.groupId, name: group.name }));

  const contextLines = input.context.recentEntries
    .slice(0, MAX_CONTEXT_ENTRIES)
    .filter((entry) => entry.description || entry.source)
    .map(
      (entry) =>
        `- "${entry.description ?? entry.source}" -> ${entry.type}${
          entry.groupId ? ` / ${entry.groupId}` : ""
        }${entry.category ? ` / ${entry.category}` : ""}`
    );

  const knownCategories = [
    ...new Set(
      input.context.recentEntries
        .map((entry) => entry.category)
        .filter((category): category is string => Boolean(category))
    )
  ].slice(0, 30);

  const userPrefix = [
    `Statement source: ${input.sourceType} (${input.fileType})`,
    `Groups: ${JSON.stringify(groups)}`,
    knownCategories.length
      ? `Categories already used in the ledger: ${knownCategories.join(", ")}`
      : "",
    contextLines.length
      ? `Recent ledger entries for context (description -> type / group / category):\n${contextLines.join("\n")}`
      : "No prior ledger entries available for context.",
    "Extract all transactions from the following statement as JSON matching the schema."
  ]
    .filter(Boolean)
    .join("\n\n");

  return { system: SYSTEM_PROMPT, userPrefix };
};

const TXN_SCHEMA = {
  type: "object",
  properties: {
    transactions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          date: { type: "string", description: "YYYY-MM-DD" },
          amount: { type: "number", description: "Always positive" },
          currency: { type: "string" },
          direction: { type: "string", enum: ["IN", "OUT"] },
          description: { type: "string" },
          counterparty: { type: ["string", "null"] },
          suggestedType: {
            type: "string",
            enum: ["DONATION", "INCOME", "EXPENSE", "REIMBURSEMENT"]
          },
          suggestedGroupId: { type: ["string", "null"] },
          suggestedCategory: { type: ["string", "null"] },
          isLikelyInternalTransfer: { type: "boolean" },
          confidence: { type: "number" }
        },
        required: [
          "date",
          "amount",
          "currency",
          "direction",
          "description",
          "counterparty",
          "suggestedType",
          "suggestedGroupId",
          "suggestedCategory",
          "isLikelyInternalTransfer",
          "confidence"
        ],
        additionalProperties: false
      }
    }
  },
  required: ["transactions"],
  additionalProperties: false
} as const;

interface RawParsedTxn {
  date: string;
  amount: number;
  currency: string;
  direction: string;
  description: string;
  counterparty: string | null;
  suggestedType: string;
  suggestedGroupId: string | null;
  suggestedCategory?: string | null;
  isLikelyInternalTransfer: boolean;
  confidence: number;
}

const ENTRY_TYPES: HarmonyLedgerEntryType[] = [
  "DONATION",
  "INCOME",
  "EXPENSE",
  "REIMBURSEMENT"
];

/**
 * Validate and clamp a raw model transaction. Returns null for rows that are
 * unusable (bad date or non-positive amount).
 */
export const sanitizeParsedTransaction = (
  raw: RawParsedTxn,
  validGroupIds: Set<string>
): ParsedStatementTransaction | null => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw.date)) {
    return null;
  }
  const amount = Math.round(Math.abs(Number(raw.amount)) * 100) / 100;
  if (!Number.isFinite(amount) || amount <= 0) {
    return null;
  }

  const direction: HarmonyTxnDirection = raw.direction === "OUT" ? "OUT" : "IN";
  let suggestedType = ENTRY_TYPES.includes(
    raw.suggestedType as HarmonyLedgerEntryType
  )
    ? (raw.suggestedType as HarmonyLedgerEntryType)
    : direction === "OUT"
      ? "EXPENSE"
      : "INCOME";
  if (direction === "OUT" && suggestedType !== "EXPENSE") {
    suggestedType = "EXPENSE";
  }
  if (direction === "IN" && suggestedType === "EXPENSE") {
    suggestedType = "INCOME";
  }

  const suggestedGroupId =
    raw.suggestedGroupId && validGroupIds.has(raw.suggestedGroupId)
      ? raw.suggestedGroupId
      : undefined;

  return {
    txnDate: raw.date,
    amount,
    currency: (raw.currency || "USD").toUpperCase().slice(0, 3),
    direction,
    rawDescription: raw.description.slice(0, 500),
    counterparty: raw.counterparty || undefined,
    suggestedType,
    suggestedGroupId,
    suggestedCategory: raw.suggestedCategory
      ? raw.suggestedCategory.toLowerCase().trim().slice(0, 40)
      : undefined,
    isLikelyInternalTransfer: raw.isLikelyInternalTransfer || undefined,
    confidence:
      typeof raw.confidence === "number"
        ? Math.min(1, Math.max(0, raw.confidence))
        : undefined
  };
};

const extractTransactions = (
  input: unknown,
  validGroupIds: Set<string>
): ParsedStatementTransaction[] => {
  const parsed = input as { transactions?: RawParsedTxn[] };
  if (!Array.isArray(parsed?.transactions)) {
    throw new Error("Model response did not include a transactions array");
  }
  return parsed.transactions
    .map((raw) => sanitizeParsedTransaction(raw, validGroupIds))
    .filter((txn): txn is ParsedStatementTransaction => txn !== null);
};

const callModel = async (
  content:
    | string
    | {
        type: "document";
        source: { type: "base64"; media_type: "application/pdf"; data: string };
      },
  prompt: { system: string; userPrefix: string }
): Promise<unknown> => {
  const client = getClient();
  const config = loadConfig();

  const userContent =
    typeof content === "string"
      ? [{ type: "text" as const, text: `${prompt.userPrefix}\n\n${content}` }]
      : [content, { type: "text" as const, text: prompt.userPrefix }];

  // Forced (non-strict) tool use instead of output_config structured outputs:
  // the Bedrock Mantle endpoint currently rejects `output_config` and
  // `strict`, and Haiku 4.5 has no adaptive thinking — the tool input still
  // comes back as parsed JSON, and sanitizeParsedTransaction clamps any
  // loosely-followed fields.
  const stream = client.messages.stream({
    model: config.bedrockModelId,
    max_tokens: 64000,
    system: prompt.system,
    tools: [
      {
        name: "record_transactions",
        description:
          "Record every completed money movement extracted from the statement.",
        input_schema: TXN_SCHEMA as unknown as {
          type: "object";
          [key: string]: unknown;
        }
      }
    ],
    tool_choice: { type: "tool", name: "record_transactions" },
    messages: [{ role: "user", content: userContent }]
  });

  const message = await stream.finalMessage();
  const toolUse = message.content.find((block) => block.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error("Model response contained no tool call");
  }
  return toolUse.input;
};

export const parseStatement = async (
  input: ParseStatementInput
): Promise<ParsedStatementTransaction[]> => {
  const prompt = buildStatementPrompt({
    sourceType: input.sourceType,
    fileType: input.fileType,
    context: input.context
  });
  const validGroupIds = new Set(
    input.context.groups.map((group) => group.groupId)
  );

  if (input.fileType === "PDF") {
    const output = await callModel(
      {
        type: "document",
        source: {
          type: "base64",
          media_type: "application/pdf",
          data: input.bytes.toString("base64")
        }
      },
      prompt
    );
    return extractTransactions(output, validGroupIds);
  }

  const chunks = chunkCsv(input.bytes.toString("utf8"));
  const results: ParsedStatementTransaction[] = [];
  for (const chunk of chunks) {
    const output = await callModel(chunk, prompt);
    results.push(...extractTransactions(output, validGroupIds));
  }
  return results;
};
