import { describe, expect, it } from "vitest";
import { Rng } from "../datagen/rng";
import { humanParams, mousePath, thinkMs, typingPlan } from "./human";

const apply = (plan: { key: string }[]) =>
  plan.reduce((s, k) => (k.key === "Backspace" ? s.slice(0, -1) : s + k.key), "");

describe("typing", () => {
  it("always ends with exactly the intended text, typos included", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const p = humanParams((seed % 10) / 10, new Rng(seed));
      const text = "Juniper Roast, a Maple Street cafe: 42 orders!";
      expect(apply(typingPlan(text, p, new Rng(seed * 7)))).toBe(text);
    }
  });
  it("makes more slips and takes longer for a hesitant typist", () => {
    const text = "the quick brown fox jumps over the lazy dog ".repeat(10);
    const run = (fluency: number) => {
      let slips = 0;
      let ms = 0;
      for (let seed = 1; seed <= 20; seed++) {
        const plan = typingPlan(text, humanParams(fluency, new Rng(seed)), new Rng(seed + 99));
        slips += plan.filter((k) => k.key === "Backspace").length;
        ms += plan.reduce((s, k) => s + k.delay, 0);
      }
      return { slips, ms };
    };
    const slow = run(0.1);
    const fast = run(0.9);
    expect(slow.slips).toBeGreaterThan(fast.slips);
    expect(slow.ms).toBeGreaterThan(fast.ms);
  });
  it("has a believable speed: about 40 words a minute for a middling typist", () => {
    const p = humanParams(0.4, new Rng(3));
    const text = "hello there ".repeat(40); // 480 characters, about 96 words
    const plan = typingPlan(text, { ...p, typoRate: 0 }, new Rng(5));
    const minutes = plan.reduce((s, k) => s + k.delay, 0) / 60_000;
    const wpm = text.length / 5 / minutes;
    expect(wpm).toBeGreaterThan(30);
    expect(wpm).toBeLessThan(65);
  });
});

describe("mouse", () => {
  const p = humanParams(0.5, new Rng(1));
  it("arrives exactly on the target, in many small steps, along a curve", () => {
    const from = { x: 100, y: 100 };
    const to = { x: 900, y: 500 };
    const { points, durationMs } = mousePath(from, to, 80, p, new Rng(4));
    expect(points.length).toBeGreaterThan(10);
    expect(points.at(-1)).toEqual(to);
    expect(durationMs).toBeGreaterThan(200);
    expect(durationMs).toBeLessThan(2500);
    // Not a straight line: some point is clearly off the direct line.
    const off = points.some(
      (pt) =>
        Math.abs((to.y - from.y) * (pt.x - from.x) - (to.x - from.x) * (pt.y - from.y)) /
          Math.hypot(to.x - from.x, to.y - from.y) >
        6,
    );
    expect(off).toBe(true);
  });
  it("takes longer for small, far targets than for big, near ones (Fitts's law)", () => {
    const far = mousePath({ x: 0, y: 0 }, { x: 1200, y: 0 }, 20, p, new Rng(2)).durationMs;
    const near = mousePath({ x: 0, y: 0 }, { x: 100, y: 0 }, 200, p, new Rng(2)).durationMs;
    expect(far).toBeGreaterThan(near);
  });
});

describe("thinking", () => {
  it("reading a long screen takes longer than glancing at it", () => {
    const p = humanParams(0.5, new Rng(1));
    const mean = (kind: "glance" | "read", words: number) =>
      Array.from({ length: 200 }, (_, i) => thinkMs(kind, words, p, new Rng(i))).reduce(
        (a, b) => a + b,
      ) / 200;
    expect(mean("read", 60)).toBeGreaterThan(mean("glance", 60) * 2);
    expect(mean("read", 60)).toBeGreaterThan(mean("read", 5));
  });
  it("is slower to decide for hesitant people", () => {
    const mean = (f: number) =>
      Array.from({ length: 300 }, (_, i) =>
        thinkMs("decide", 0, humanParams(f, new Rng(1)), new Rng(i)),
      ).reduce((a, b) => a + b) / 300;
    expect(mean(0.1)).toBeGreaterThan(mean(0.9));
  });
  it("is the same for the same agent every time", () => {
    const a = humanParams(0.6, new Rng(11));
    const b = humanParams(0.6, new Rng(11));
    expect(a).toEqual(b);
  });
});
