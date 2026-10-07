import { AnthropicBedrockMantle } from "@anthropic-ai/bedrock-sdk";
import { loadConfig } from "../config.js";
import { ValidationError } from "../lib/errors.js";
import { parseWith, quickAddSchema } from "../lib/atlasValidation.js";
import {
  sanitizeQuickAddLines,
  type QuickAddLine
} from "../lib/atlasQuickAdd.js";
import type { AuthContext } from "../auth.js";
import type { AtlasCircle, AtlasDraftTrip, AtlasPlace } from "../types.js";
import { AtlasStore } from "../data/atlasStore.js";
import { PlacesService } from "./placesService.js";

// Quick add turns pasted lines ("Lisbon 2019 solo", "Napa w/ wife June 2025")
// into draft trips. Nothing is saved here: the client reviews the drafts and
// posts the ones it keeps to /atlas/trips.

const MAX_LINES = 40;

const QUICK_ADD_SCHEMA = {
  type: "object",
  properties: {
    trips: {
      type: "array",
      items: {
        type: "object",
        properties: {
          line: { type: "string", description: "The input line, verbatim" },
          title: { type: "string", description: "Short trip title, e.g. 'Lisbon' or 'Napa anniversary'" },
          places: {
            type: "array",
            items: { type: "string" },
            description:
              "Each place visited, as a searchable name with its country or US state, e.g. 'Lisbon, Portugal', 'Napa, California'. Use a 3-letter IATA code only when the line names an airport."
          },
          year: { type: "integer" },
          month: { type: "integer", description: "1-12, only if stated" },
          day: { type: "integer", description: "1-31, only if stated" },
          circleIds: {
            type: "array",
            items: { type: "string" },
            description: "Ids of the circles the line says came along"
          }
        },
        required: ["line", "title", "places", "circleIds"]
      }
    }
  },
  required: ["trips"]
} as const;

let bedrock: AnthropicBedrockMantle | null = null;
const getBedrock = () => {
  if (!bedrock) {
    const config = loadConfig();
    bedrock = new AnthropicBedrockMantle({ awsRegion: config.bedrockRegion || config.region });
  }
  return bedrock;
};

/** Test hook. */
export const setQuickAddBedrockForTesting = (client: AnthropicBedrockMantle | null) => {
  bedrock = client;
};

export const buildQuickAddPrompt = (circles: AtlasCircle[]): string =>
  [
    "You turn a person's notes about past trips into structured records for their travel map.",
    "Each non-empty input line is one trip. Return exactly one record per line, in order.",
    "Only use facts in the line; leave year, month or day out when the line doesn't say them.",
    "Circles are the groups of people they travel with. Match words like names, 'wife', 'the guys' or 'alone' to these circles:",
    ...circles.map((c) => `- ${c.circleId}: ${c.name}`),
    "Use the solo circle when the line says they went alone. Leave circleIds empty when unsure."
  ].join("\n");

export class AtlasQuickAddService {
  constructor(
    private readonly store = new AtlasStore(),
    private readonly places = new PlacesService()
  ) {}

  async parse(body: unknown, auth: AuthContext): Promise<{ drafts: AtlasDraftTrip[] }> {
    const { text } = parseWith(quickAddSchema, body);
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (lines.length > MAX_LINES) {
      throw new ValidationError(`Paste up to ${MAX_LINES} lines at a time`);
    }
    const { circles } = await this.store.loadAll(auth.userId);
    const config = loadConfig();

    const message = await getBedrock().messages.create({
      model: config.bedrockModelId,
      max_tokens: 8000,
      system: buildQuickAddPrompt(circles),
      // Forced tool use: the Mantle endpoint rejects output_config/strict.
      tools: [
        {
          name: "record_trips",
          description: "Record one draft trip per input line.",
          input_schema: QUICK_ADD_SCHEMA as unknown as { type: "object"; [k: string]: unknown }
        }
      ],
      tool_choice: { type: "tool", name: "record_trips" },
      messages: [{ role: "user", content: lines.join("\n") }]
    });
    const toolUse = message.content.find((block) => block.type === "tool_use");
    if (!toolUse || toolUse.type !== "tool_use") {
      throw new Error("Quick add: model returned no tool call");
    }

    const parsed = sanitizeQuickAddLines(
      toolUse.input,
      new Set(circles.map((c) => c.circleId))
    );
    const drafts = await Promise.all(parsed.map((line) => this.resolveLine(line)));
    return { drafts };
  }

  private async resolveLine(line: QuickAddLine): Promise<AtlasDraftTrip> {
    const places: AtlasPlace[] = [];
    const unresolved: string[] = [];
    for (const name of line.places) {
      const place = await this.places.resolveText(name).catch(() => undefined);
      if (place) places.push(place);
      else unresolved.push(name);
    }
    return {
      line: line.line,
      title: line.title,
      start: line.start,
      datePrecision: line.datePrecision,
      circleIds: line.circleIds,
      places,
      unresolved
    };
  }
}
