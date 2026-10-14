// The human interaction layer: how an agent moves the mouse, types, reads and hesitates, so that a recorded session
// (a replay) and the timing columns in the events look like a person at a screen, not a script.
//
// Everything is derived from the agent's `digital_fluency` and a seed, so a given agent behaves the same way on every
// run, and a fluent agent is faster and slips less than a hesitant one. The numbers below are modelling assumptions:
// they are the owner's to change (docs/agents.md, "Human pacing"). The planners are pure so they can be tested without
// a browser; `Human` applies them to a Playwright page. In `fast` mode nothing is delayed and plain Playwright actions
// are used (tests and development).
import type { Locator, Page } from "@playwright/test";
import { Rng } from "../datagen/rng";

export type Pace = "human" | "fast";

/** The assumptions, in one place. */
export const HUMAN = {
  /** Typing speed in words per minute: a hesitant typist at fluency 0, a fast one at 1. */
  typingWpm: { min: 25, max: 70 },
  /** Reading speed in words per minute, before skimming. */
  readingWpm: { min: 180, max: 300 },
  /** People skim instructions rather than read every word: the share of the words actually read. */
  skimShare: 0.5,
  /** Time to start moving the mouse and reach a target: a + b * log2(distance / width + 1), in ms (Fitts's law). */
  fitts: { a: 120, bMin: 110, bMax: 190 },
  /** Chance per letter of hitting a neighbouring key: more likely for hesitant typists. */
  typoRate: { min: 0.005, max: 0.05 },
  /** Chance that a movement overshoots its target a little and corrects. */
  overshoot: { min: 0.03, max: 0.15 },
  /** Chance per decision of a longer distraction (a notification, a sip of coffee), and its mean length in ms. */
  distraction: { chance: 0.04, meanMs: 6000, maxMs: 20_000 },
  /** Pause between a mouse press and release, ms. */
  pressHoldMs: { min: 60, max: 140 },
} as const;

export interface HumanParams {
  typingWpm: number;
  readingWpm: number;
  fittsB: number;
  typoRate: number;
  overshootChance: number;
  /** Multiplies decision times: above 1 for hesitant people. */
  hesitation: number;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/** One person's pace, from their fluency (0 to 1). Slightly different for each agent, the same on every run. */
export function humanParams(fluency: number, rng: Rng): HumanParams {
  const f = clamp(fluency, 0, 1);
  return {
    typingWpm: clamp(lerp(HUMAN.typingWpm.min, HUMAN.typingWpm.max, f) + rng.normal() * 4, 15, 100),
    readingWpm: clamp(
      lerp(HUMAN.readingWpm.min, HUMAN.readingWpm.max, f) + rng.normal() * 12,
      120,
      380,
    ),
    fittsB: lerp(HUMAN.fitts.bMax, HUMAN.fitts.bMin, f),
    typoRate: lerp(HUMAN.typoRate.max, HUMAN.typoRate.min, f),
    overshootChance: lerp(HUMAN.overshoot.max, HUMAN.overshoot.min, f),
    hesitation: lerp(1.35, 0.8, f),
  };
}

/** How long a person takes before acting, in ms. `words` is how much text is on the screen to take in. */
export function thinkMs(
  kind: "glance" | "read" | "decide",
  words: number,
  p: HumanParams,
  rng: Rng,
): number {
  let ms: number;
  if (kind === "glance") ms = rng.lognormal(Math.log(700), 0.4);
  else if (kind === "decide") ms = rng.lognormal(Math.log(1200), 0.6) * p.hesitation;
  else {
    const reading = ((words * HUMAN.skimShare) / p.readingWpm) * 60_000;
    ms = rng.lognormal(Math.log(700), 0.4) + reading * rng.range(0.8, 1.25);
    ms = clamp(ms, 800, 15_000);
  }
  if (kind !== "glance" && rng.bool(HUMAN.distraction.chance))
    ms += Math.min(rng.exp(HUMAN.distraction.meanMs), HUMAN.distraction.maxMs);
  return Math.round(ms);
}

export interface Point {
  x: number;
  y: number;
}

/**
 * A mouse path from one point to another: a curve rather than a line, speeding up then slowing down (minimum jerk),
 * with small tremor, and sometimes an overshoot that is corrected. Returns the points and the time the movement takes.
 */
export function mousePath(
  from: Point,
  to: Point,
  targetWidth: number,
  p: HumanParams,
  rng: Rng,
): { points: Point[]; durationMs: number } {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dist = Math.hypot(dx, dy);
  const durationMs = Math.round(
    (HUMAN.fitts.a + p.fittsB * Math.log2(dist / Math.max(targetWidth, 8) + 1)) *
      rng.range(0.85, 1.2),
  );
  if (dist < 2) return { points: [to], durationMs: 0 };
  // Control points pushed sideways, so the path bows.
  const nx = -dy / dist;
  const ny = dx / dist;
  const bow = dist * rng.range(0.04, 0.14) * (rng.bool(0.5) ? 1 : -1);
  const c1 = { x: from.x + dx * 0.3 + nx * bow, y: from.y + dy * 0.3 + ny * bow };
  const c2 = { x: from.x + dx * 0.75 + nx * bow * 0.5, y: from.y + dy * 0.75 + ny * bow * 0.5 };
  const curve = (a: Point, b: Point, c: Point, d: Point, steps: number): Point[] =>
    Array.from({ length: steps }, (_, i) => {
      const t0 = (i + 1) / steps;
      const t = 10 * t0 ** 3 - 15 * t0 ** 4 + 6 * t0 ** 5; // minimum-jerk easing
      const u = 1 - t;
      return {
        x: u ** 3 * a.x + 3 * u * u * t * b.x + 3 * u * t * t * c.x + t ** 3 * d.x,
        y: u ** 3 * a.y + 3 * u * u * t * b.y + 3 * u * t * t * c.y + t ** 3 * d.y,
      };
    });
  const steps = Math.max(8, Math.round(durationMs / 14));
  const overshoot = rng.bool(p.overshootChance) && dist > 80;
  const aim = overshoot
    ? { x: to.x + (dx / dist) * rng.range(4, 12), y: to.y + (dy / dist) * rng.range(4, 12) }
    : to;
  let points = curve(from, c1, c2, aim, steps).map(
    (pt, i, all) =>
      i === all.length - 1 ? pt : { x: pt.x + rng.normal() * 0.8, y: pt.y + rng.normal() * 0.8 }, // hand tremor
  );
  if (overshoot) points = points.concat(curve(aim, aim, to, to, 4));
  points[points.length - 1] = { ...to };
  return { points, durationMs: durationMs + (overshoot ? 120 : 0) };
}

export interface Keystroke {
  /** A character to type, or `Backspace`. */
  key: string;
  /** Wait before this keystroke, ms. */
  delay: number;
}

const NEIGHBOURS: Record<string, string> = {
  q: "wa",
  w: "qes",
  e: "wrd",
  r: "etf",
  t: "ryg",
  y: "tuh",
  u: "yij",
  i: "uok",
  o: "ipl",
  p: "ol",
  a: "qsz",
  s: "awdx",
  d: "serf",
  f: "drtg",
  g: "fthv",
  h: "gyjb",
  j: "hukn",
  k: "jilm",
  l: "kop",
  z: "asx",
  x: "zsdc",
  c: "xdfv",
  v: "cfgb",
  b: "vghn",
  n: "bhjm",
  m: "njk",
};

/**
 * What a person's fingers do to type `text`: a pace that varies from key to key, longer pauses between words, and now
 * and then a wrong neighbouring key that is noticed a letter or two later, deleted and retyped. Applying the keystrokes
 * in order always ends with exactly `text`.
 */
export function typingPlan(text: string, p: HumanParams, rng: Rng): Keystroke[] {
  const base = 60_000 / (p.typingWpm * 5); // ms per character
  const plan: Keystroke[] = [];
  const stroke = (key: string, extra = 0) =>
    plan.push({ key, delay: Math.round(rng.lognormal(Math.log(base), 0.35) + extra) });
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    const wordGap = i > 0 && text[i - 1] === " " ? rng.exp(90) : 0;
    const neighbours = NEIGHBOURS[ch.toLowerCase()];
    if (neighbours && rng.bool(p.typoRate)) {
      const wrong = neighbours[rng.int(neighbours.length)]!;
      const runOn = Math.min(rng.int(3), text.length - i - 1); // letters typed before noticing
      stroke(ch === ch.toLowerCase() ? wrong : wrong.toUpperCase(), wordGap);
      for (let k = 1; k <= runOn; k++) stroke(text[i + k]!);
      plan.push({ key: "Backspace", delay: Math.round(rng.range(250, 600)) }); // notice
      for (let k = 0; k < runOn; k++)
        plan.push({ key: "Backspace", delay: Math.round(rng.range(80, 150)) });
      stroke(ch, 0);
      for (let k = 1; k <= runOn; k++) stroke(text[i + k]!);
      i += runOn;
    } else stroke(ch, wordGap);
  }
  return plan;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Drives a page the way a person would. One per agent run; remembers where the mouse is. */
export class Human {
  readonly params: HumanParams;
  private readonly rng: Rng;
  private pos: Point;

  constructor(
    private readonly page: Page,
    seed: number,
    fluency: number,
    readonly pace: Pace = "human",
  ) {
    this.rng = new Rng(seed);
    this.params = humanParams(fluency, this.rng);
    this.pos = { x: this.rng.range(300, 900), y: this.rng.range(150, 500) };
  }

  /** Time spent doing nothing observable. Returns how long it was. */
  async think(kind: "glance" | "read" | "decide", words = 0): Promise<number> {
    if (this.pace === "fast") return 0;
    const ms = thinkMs(kind, words, this.params, this.rng);
    await this.drift(ms);
    return ms;
  }

  /** Looking at a screen: the mouse idles and drifts a little instead of freezing. */
  async drift(ms: number) {
    if (this.pace === "fast") return;
    let left = ms;
    while (left > 0) {
      const wait = Math.min(left, this.rng.range(700, 2200));
      await sleep(wait);
      left -= wait;
      if (left > 0 && this.rng.bool(0.5)) {
        const next = {
          x: clamp(this.pos.x + this.rng.normal() * 25, 5, 1350),
          y: clamp(this.pos.y + this.rng.normal() * 18, 5, 850),
        };
        await this.travel(next, 40);
      }
    }
  }

  private async travel(to: Point, width: number) {
    const { points, durationMs } = mousePath(this.pos, to, width, this.params, this.rng);
    const gap = durationMs / points.length;
    for (const pt of points) {
      await this.page.mouse.move(pt.x, pt.y);
      if (gap >= 1) await sleep(gap);
    }
    this.pos = to;
  }

  /** Words of text a person would take in on the current screen (capped: nobody reads a whole page). */
  async wordsOnScreen(selector = "main"): Promise<number> {
    const text = await this.page
      .locator(selector)
      .first()
      .innerText({ timeout: 2000 })
      .catch(() => "");
    return Math.min(80, text.split(/\s+/).filter(Boolean).length);
  }

  private async ready(target: Locator) {
    await target.waitFor({ state: "visible" });
    for (let i = 0; i < 60 && !(await target.isEnabled()); i++) await sleep(250);
  }

  /** Move to an element, pause on it, press and release. */
  async click(target: Locator) {
    if (this.pace === "fast") return void (await target.click());
    await this.ready(target);
    await target.scrollIntoViewIfNeeded();
    for (let attempt = 0; attempt < 2; attempt++) {
      const box = await target.boundingBox();
      if (!box) return void (await target.click());
      const clampTo = (v: number, lo: number, hi: number) =>
        clamp(v, lo + 3, Math.max(lo + 3, hi - 3));
      const to = {
        x: clampTo(
          box.x + box.width * (0.5 + clamp(this.rng.normal() * 0.14, -0.35, 0.35)),
          box.x,
          box.x + box.width,
        ),
        y: clampTo(
          box.y + box.height * (0.5 + clamp(this.rng.normal() * 0.14, -0.35, 0.35)),
          box.y,
          box.y + box.height,
        ),
      };
      await this.travel(to, Math.min(box.width, box.height));
      await sleep(this.rng.range(80, 250)); // settle on the target
      const now = await target.boundingBox();
      if (
        now &&
        to.x >= now.x &&
        to.x <= now.x + now.width &&
        to.y >= now.y &&
        to.y <= now.y + now.height
      )
        break;
    }
    await this.page.mouse.down();
    await sleep(this.rng.range(HUMAN.pressHoldMs.min, HUMAN.pressHoldMs.max));
    await this.page.mouse.up();
    await sleep(this.rng.range(120, 400));
  }

  /** Tick a checkbox or radio button only if it is not already on. */
  async check(target: Locator) {
    if (this.pace === "fast") return void (await target.check());
    if (!(await target.isChecked())) await this.click(target);
  }

  /** Click into a field and type into it, key by key. */
  async type(target: Locator, text: string) {
    if (this.pace === "fast") return void (await target.fill(text));
    await this.click(target);
    for (const k of typingPlan(text, this.params, this.rng)) {
      await sleep(k.delay);
      if (k.key === "Backspace") await this.page.keyboard.press("Backspace");
      else await this.page.keyboard.type(k.key);
    }
    await sleep(this.rng.range(200, 600));
  }
}
