import { describe, expect, it } from "vitest";
import { detectSpikes, type Point } from "@/lib/analytics/spikes";
import { WIDGETS, WIDGET_TYPES, widgetAllowed } from "./catalog";
import { PLANS } from "@/lib/entitlements/plans";
import { bottom, canMove, compact, firstFree, moveBy, moveTo, resize, type Box } from "./layout";

const b = (id: string, x: number, y: number, w: number, h: number): Box => ({ id, x, y, w, h });
const overlapping = (items: Box[]) =>
  items.some((a, i) =>
    items
      .slice(i + 1)
      .some((c) => a.x < c.x + c.w && c.x < a.x + a.w && a.y < c.y + c.h && c.y < a.y + a.h),
  );

describe("layout engine", () => {
  it("lets widgets fall to fill gaps (vertical gravity)", () => {
    const out = compact([b("a", 0, 0, 6, 3), b("b", 0, 9, 6, 3)]);
    expect(out.find((i) => i.id === "b")).toMatchObject({ x: 0, y: 3 });
  });
  it("pushes others down when a widget is moved onto them, never overlapping", () => {
    const start = [b("a", 0, 0, 6, 3), b("b", 6, 0, 6, 3), b("c", 0, 3, 12, 3)];
    const out = moveTo(start, "b", 0, 0);
    expect(overlapping(out)).toBe(false);
    expect(out.find((i) => i.id === "b")).toMatchObject({ x: 0, y: 0 });
    expect(out.find((i) => i.id === "a")!.y).toBeGreaterThanOrEqual(3);
  });
  it("clamps moves to the 12-column grid", () => {
    const out = moveBy([b("a", 0, 0, 6, 3)], "a", 99, -5);
    expect(out[0]).toMatchObject({ x: 6, y: 0 });
    expect(moveBy([b("a", 6, 0, 6, 3)], "a", -99, 0)[0]!.x).toBe(0);
  });
  it("keeps the input order and is idempotent", () => {
    const start = [b("a", 0, 0, 6, 3), b("b", 6, 0, 3, 3), b("c", 9, 0, 3, 3)];
    const once = compact(start);
    expect(once.map((i) => i.id)).toEqual(["a", "b", "c"]);
    expect(compact(once)).toEqual(once);
  });
  it("resizes without overlap and keeps widgets inside the grid", () => {
    const out = resize([b("a", 6, 0, 6, 3), b("b", 0, 3, 6, 3)], "a", 12, 5);
    expect(out[0]).toMatchObject({ x: 0, w: 12, h: 5 }); // widened widgets shift left to fit
    expect(overlapping(out)).toBe(false);
    expect(out[1]!.y).toBeGreaterThanOrEqual(5);
  });
  it("places new widgets in the first free spot", () => {
    expect(firstFree([], 6, 3)).toEqual({ x: 0, y: 0 });
    expect(firstFree([b("a", 0, 0, 6, 3)], 6, 3)).toEqual({ x: 6, y: 0 });
    expect(firstFree([b("a", 0, 0, 12, 3)], 3, 3)).toEqual({ x: 0, y: 3 });
    expect(bottom([b("a", 0, 0, 6, 3), b("b", 0, 3, 6, 5)])).toBe(8);
  });
  it("reports which directions a widget can still move", () => {
    expect(canMove([b("a", 0, 0, 12, 3)], "a")).toEqual({
      left: false,
      right: false,
      up: false,
      down: true,
    });
    expect(canMove([b("a", 3, 4, 3, 3)], "a")).toEqual({
      left: true,
      right: true,
      up: true,
      down: true,
    });
  });
  it("survives random move sequences without overlap or leaving the grid", () => {
    let items = [
      b("a", 0, 0, 6, 3),
      b("b", 6, 0, 6, 3),
      b("c", 0, 3, 3, 3),
      b("d", 3, 3, 3, 3),
      b("e", 6, 3, 6, 5),
    ];
    let seed = 7;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 300; i++) {
      const id = "abcde"[Math.floor(rnd() * 5)]!;
      items =
        rnd() < 0.7
          ? moveBy(items, id, Math.floor(rnd() * 5) - 2, Math.floor(rnd() * 5) - 2)
          : resize(items, id, 1 + Math.floor(rnd() * 12), 1 + Math.floor(rnd() * 5));
      expect(overlapping(items)).toBe(false);
      for (const it of items) expect(it.x >= 0 && it.y >= 0 && it.x + it.w <= 12).toBe(true);
    }
  });
});

describe("spike detection", () => {
  const day = (i: number) => new Date(Date.UTC(2026, 8, 1 + i)).toISOString().slice(0, 10);
  const series = (vals: number[]): Point[] => vals.map((value, i) => ({ day: day(i), value }));
  const noise = (n: number, base: number) =>
    Array.from({ length: n }, (_, i) => base + ((i * 7) % 9) - 4);

  it("flags a crisis-sized spike and measures it against baseline", () => {
    const s = detectSpikes(series([...noise(20, 50), 600, 380, 200, ...noise(10, 55)]));
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ day: day(20), value: 600 });
    expect(s[0]!.multiple).toBeGreaterThan(8);
  });
  it("merges consecutive elevated days into one episode and keeps the peak", () => {
    const s = detectSpikes(series([...noise(20, 50), 300, 700, 500, ...noise(5, 52)]));
    expect(s).toHaveLength(1);
    expect(s[0]!.value).toBe(700);
  });
  it("ignores steady series and ordinary noise", () => {
    expect(detectSpikes(series(noise(40, 50)))).toEqual([]);
  });
  it("ignores tiny absolute volumes even when the multiple is large", () => {
    expect(detectSpikes(series([...noise(20, 2), 12, 3, 2]))).toEqual([]);
  });
  it("returns separate episodes biggest first, capped at top", () => {
    const vals = [...noise(20, 40), 500, ...noise(15, 40), 900, ...noise(15, 40), 300];
    const s = detectSpikes(series(vals), { top: 2 });
    expect(s.map((x) => x.value)).toEqual([900, 500]);
  });
  it("handles short or empty series", () => {
    expect(detectSpikes([])).toEqual([]);
    expect(detectSpikes(series([5, 500]))).toEqual([]);
  });
});

describe("widget catalog", () => {
  it("defines every widget type with a size, explanation and a plan rule", () => {
    expect(WIDGET_TYPES).toHaveLength(12);
    for (const t of WIDGET_TYPES) {
      expect(WIDGETS[t].howCalculated.length).toBeGreaterThan(20);
      expect(["S", "M", "L", "XL"]).toContain(WIDGETS[t].size);
    }
  });
  it("gates Share of voice and Emotions behind plan features", () => {
    expect(widgetAllowed("share_of_voice", PLANS.trial.features)).toBe(false);
    expect(widgetAllowed("emotion", PLANS.starter.features)).toBe(false);
    expect(widgetAllowed("share_of_voice", PLANS.growth.features)).toBe(true);
    expect(widgetAllowed("volume", PLANS.trial.features)).toBe(true);
  });
});
