import { describe, expect, it } from "vitest";
import { PlacesService } from "./placesService.js";
import { AtlasQuickAddService } from "./atlasQuickAdd.js";
import type { AtlasStore } from "../data/atlasStore.js";

// Opt-in integration tests against real Amazon Location and Bedrock. Run with:
//   RUN_BEDROCK=1 TABLE_NAME=x RECEIPT_BUCKET=x AWS_REGION=us-east-1 npx vitest run atlasLive
describe.runIf(Boolean(process.env.RUN_BEDROCK))("Atlas (live AWS)", () => {
  const places = new PlacesService();

  it("searches and resolves a small town", async () => {
    const results = await places.search("Yountville");
    const town = results.find((r) => r.kind === "city");
    expect(town?.title).toBe("Yountville");
    const place = await places.resolve(town!.providerId);
    expect(place).toMatchObject({ countryCode: "US", regionCode: "US-CA", kind: "city" });
  }, 15000);

  it("puts an exact airport code first", async () => {
    const [first] = await places.search("BNA");
    expect(first.place?.iata).toBe("BNA");
  }, 15000);

  it("turns pasted lines into drafts", async () => {
    const store = {
      loadAll: async () => ({
        circles: [
          { circleId: "circle_wife", name: "Wife", color: "rose", sortOrder: 0, createdAt: "" },
          { circleId: "circle_shop", name: "Barbershop", color: "emerald", sortOrder: 1, createdAt: "" },
          { circleId: "solo", name: "Solo", color: "slate", sortOrder: 999, builtIn: true, createdAt: "" }
        ],
        people: [],
        trips: [],
        wishes: []
      })
    } as unknown as AtlasStore;
    const { drafts } = await new AtlasQuickAddService(store, places).parse(
      { text: "Lisbon and Porto 2019 by myself\nNashville with the barbershop guys April 2025" },
      { userId: "test" }
    );
    expect(drafts).toHaveLength(2);
    expect(drafts[0]).toMatchObject({ start: "2019", circleIds: ["solo"] });
    expect(drafts[0].places.map((p) => p.countryCode)).toEqual(["PT", "PT"]);
    expect(drafts[1]).toMatchObject({ start: "2025-04", circleIds: ["circle_shop"] });
    expect(drafts[1].places[0]).toMatchObject({ regionCode: "US-TN" });
  }, 60000);
});
