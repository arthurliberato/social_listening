// The rules and arithmetic of tracking links, kept free of the database so they can be tested directly: what a good
// destination is, what counts as a bot, how a destination URL is built, and how clicks and conversions become the
// numbers a brand reads (cost per click, cost per conversion, return on spend).

const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789"; // no look-alikes (i, l, o, 0, 1)
const bytes = (n: number) => crypto.getRandomValues(new Uint8Array(n));

/** Ten characters from 31 symbols: short enough to put in a bio, far too many to guess. */
export const newLinkCode = () =>
  Array.from(bytes(10), (b) => ALPHABET[b % ALPHABET.length]).join("");
export const isLinkCode = (s: string) => /^[a-hj-km-np-z2-9]{10}$/.test(s);
export const newConversionKey = () =>
  Array.from(bytes(24), (b) => b.toString(16).padStart(2, "0")).join("");
export const newClickId = () =>
  Array.from(bytes(12), (b) => b.toString(16).padStart(2, "0")).join("");
export const isClickId = (s: string) => /^[0-9a-f]{24}$/.test(s);

export const ATTRIBUTION_WINDOW_DAYS = 30;
export const MAX_CONVERSION_USD = 10_000_000;

export function checkDestination(
  raw: string,
): { ok: true; url: string } | { ok: false; reason: string } {
  const t = raw.trim();
  if (!t) return { ok: false, reason: "Enter the page people should land on." };
  if (t.length > 500) return { ok: false, reason: "That link is too long." };
  let u: URL;
  try {
    u = new URL(t);
  } catch {
    return { ok: false, reason: "Enter a full link, starting with https://" };
  }
  if (u.protocol !== "https:" && u.protocol !== "http:")
    return { ok: false, reason: "Enter a full link, starting with https://" };
  if (u.username || u.password)
    return { ok: false, reason: "Leave out any username or password in the link." };
  return { ok: true, url: u.toString() };
}

/** The destination with the campaign's tags and the click id added, keeping whatever the brand already had. */
export function destinationFor(
  destination: string,
  o: { creatorHandle: string; campaignId: string; clickId: string },
): string {
  const u = new URL(destination);
  const set = (k: string, v: string) => {
    if (!u.searchParams.has(k)) u.searchParams.set(k, v); // the brand's own tags win
  };
  set("utm_source", o.creatorHandle.toLowerCase());
  set("utm_medium", "influencer");
  set("utm_campaign", o.campaignId.slice(0, 8));
  u.searchParams.set("rw_cid", o.clickId);
  return u.toString();
}

/** Crawlers and link-preview fetchers: they get redirected like anyone, but never count as people. */
const BOT =
  /bot\b|bot[\/ ;)]|crawl|spider|slurp|facebookexternalhit|embedly|preview|monitor|uptime|curl\/|wget|python-requests|go-http-client|okhttp|java\//i;
export const isBotAgent = (ua: string | null | undefined) => !ua || BOT.test(ua);

export function checkConversion(input: {
  value?: unknown;
  ref?: unknown;
}): { ok: true; valueUsd: number; ref: string | null } | { ok: false; reason: string } {
  const raw =
    input.value === undefined || input.value === null || input.value === "" ? 0 : input.value;
  const n = typeof raw === "string" ? Number(raw) : raw;
  if (typeof n !== "number" || !Number.isFinite(n) || n < 0 || n > MAX_CONVERSION_USD)
    return { ok: false, reason: "value must be a number of dollars from 0 to 10,000,000" };
  const ref =
    input.ref === undefined || input.ref === null || input.ref === "" ? null : String(input.ref);
  if (ref !== null && !/^[\w.:-]{1,100}$/.test(ref))
    return { ok: false, reason: "ref may use letters, digits and . _ : - (up to 100 characters)" };
  return { ok: true, valueUsd: Math.round(n), ref };
}

export const withinWindow = (clickAt: Date, now: Date) =>
  now.getTime() - clickAt.getTime() <= ATTRIBUTION_WINDOW_DAYS * 86_400_000 && now >= clickAt;

export interface Totals {
  clicks: number;
  visitors: number;
  conversions: number;
  revenueUsd: number;
  spendUsd: number;
}
export interface Results extends Totals {
  /** Spend per click / per conversion, return on spend, and share of visitors who converted. Null if undefined. */
  cpc: number | null;
  cpa: number | null;
  roas: number | null;
  conversionRate: number | null;
}
const ratio = (a: number, b: number, digits: number) =>
  b > 0 ? Math.round((a / b) * 10 ** digits) / 10 ** digits : null;

export function resultsOf(t: Totals): Results {
  return {
    ...t,
    cpc: ratio(t.spendUsd, t.clicks, 2),
    cpa: ratio(t.spendUsd, t.conversions, 2),
    roas: ratio(t.revenueUsd, t.spendUsd, 2),
    conversionRate: ratio(t.conversions * 100, t.visitors, 1),
  };
}

export interface DayPoint {
  day: string;
  clicks: number;
  conversions: number;
}

/** The last `days` UTC days ending today, zero-filled, so a quiet day shows as a zero and not a gap. */
export function dailySeries(
  clicks: Date[],
  conversions: Date[],
  now: Date,
  days: number,
): DayPoint[] {
  const key = (d: Date) => d.toISOString().slice(0, 10);
  const out = new Map<string, DayPoint>();
  for (let i = days - 1; i >= 0; i--) {
    const day = key(new Date(now.getTime() - i * 86_400_000));
    out.set(day, { day, clicks: 0, conversions: 0 });
  }
  for (const c of clicks) {
    const p = out.get(key(c));
    if (p) p.clicks++;
  }
  for (const c of conversions) {
    const p = out.get(key(c));
    if (p) p.conversions++;
  }
  return [...out.values()];
}
