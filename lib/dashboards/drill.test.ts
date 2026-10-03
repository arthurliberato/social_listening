import { describe, expect, it } from "vitest";
import { parseFilters } from "@/lib/mentions/filters";
import { drillParams } from "./drill";

const dash = new URLSearchParams("range=7d");
const f = (type: Parameters<typeof drillParams>[0], pick = {}, cfg = {}, breakdown?: string) =>
  parseFilters(drillParams(type, cfg, dash, pick, breakdown));

describe("drill-down", () => {
  it("carries the dashboard range and the widget's query scope", () => {
    const q = "11111111-1111-1111-1111-111111111111";
    expect(f("kpi", {}, { queryId: q })).toMatchObject({ range: "7d", q });
  });
  it("turns a clicked day into a one-day custom range", () => {
    expect(f("volume", { day: "2026-09-12" })).toMatchObject({
      range: "custom",
      from: "2026-09-12",
      to: "2026-09-12",
    });
    expect(f("sentiment_area", { day: "2026-09-12" })).toMatchObject({
      range: "custom",
      from: "2026-09-12",
    });
  });
  it("maps each dimension to the feed filter that counts the same mentions", () => {
    expect(f("sentiment_donut", { key: "negative" }).sentiment).toEqual(["negative"]);
    expect(f("bar", { key: "reddit" }, {}, "source").source).toEqual(["reddit"]);
    expect(f("bar", { key: "pt" }, {}, "language").lang).toEqual(["pt"]);
    expect(f("bar", { key: "BR" }, {}, "country").country).toEqual(["BR"]);
    expect(f("bar", { key: "review" }, {}, "type").type).toEqual(["review"]);
    expect(f("geo", { key: "DE" }).country).toEqual(["DE"]);
    expect(f("emotion", { key: "anger" }).emotion).toEqual(["anger"]);
    expect(f("topic_cloud", { key: "price" }).topic).toEqual(["price"]);
    expect(f("top_authors", { key: "jane" }).author).toBe("jane");
    expect(f("top_mentions", { key: "60042318" }).m).toBe("60042318");
    expect(f("heatmap", { key: "1:9" })).toMatchObject({ dow: ["1"], hour: ["9"] });
  });
  it("lets share-of-voice narrow to one query", () => {
    const q = "22222222-2222-2222-2222-222222222222";
    expect(f("share_of_voice", { key: q }).q).toBe(q);
  });
  it("does not filter on the grouped 'Other' bucket", () => {
    expect(f("bar", { key: "other" }, {}, "source").source).toEqual([]);
  });
});
