// Feed filters <-> URL. Client-safe (no server imports): the URL is the single source of truth, so
// every filtered view is shareable and back-button safe.

export const SENTIMENTS = ["positive", "neutral", "negative", "mixed"] as const;
export const CONTENT_TYPES = ["post", "comment", "repost", "article", "video", "review"] as const;
export const RANGES = ["24h", "7d", "30d", "90d", "12m"] as const;
export const SORTS = ["newest", "reach", "engagement", "negative"] as const;
export const VIEWS = ["card", "list", "table"] as const;
export const PAGE_SIZES = [50, 100, 200] as const;
export const RANGE_DAYS: Record<(typeof RANGES)[number], number> = {
  "24h": 1,
  "7d": 7,
  "30d": 30,
  "90d": 90,
  "12m": 365,
};
export const FOLLOWER_BANDS = [
  { id: "nano", label: "Under 1K", min: 0, max: 999 },
  { id: "micro", label: "1K – 10K", min: 1_000, max: 9_999 },
  { id: "mid", label: "10K – 100K", min: 10_000, max: 99_999 },
  { id: "macro", label: "100K+", min: 100_000, max: undefined },
] as const;

export interface FeedFilters {
  q?: string;
  search?: string;
  source: string[];
  sentiment: string[];
  lang: string[];
  country: string[];
  tag: string[];
  type: string[];
  author?: string;
  followers?: string; // band id
  media?: boolean;
  spam: "hide" | "show" | "only";
  flagged?: boolean;
  range: string; // preset or "custom"
  from?: string;
  to?: string;
  since?: "last";
  sort: (typeof SORTS)[number];
  view: (typeof VIEWS)[number];
  page: number;
  size: (typeof PAGE_SIZES)[number];
  m?: string; // open mention (drawer)
}

export const DEFAULTS = {
  spam: "hide",
  range: "30d",
  sort: "newest",
  view: "card",
  page: 1,
  size: 50,
} as const;

type Raw = Record<string, string | string[] | undefined> | URLSearchParams;

const list = (raw: Raw, key: string, allowed?: readonly string[]): string[] => {
  const v =
    raw instanceof URLSearchParams ? raw.getAll(key) : ([] as string[]).concat(raw[key] ?? []);
  const out = v
    .flatMap((x) => x.split(","))
    .map((x) => x.trim())
    .filter(Boolean);
  return [...new Set(allowed ? out.filter((x) => allowed.includes(x)) : out)].slice(0, 20);
};
const one = (raw: Raw, key: string): string | undefined => {
  const v = raw instanceof URLSearchParams ? raw.get(key) : raw[key];
  const s = Array.isArray(v) ? v[0] : v;
  return s && s.trim() ? s.trim() : undefined;
};
const oneOf = <T extends string>(v: string | undefined, allowed: readonly T[], d: T): T =>
  allowed.includes(v as T) ? (v as T) : d;
const isoDate = (v?: string) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);

export function parseFilters(raw: Raw): FeedFilters {
  const range = one(raw, "range");
  const size = Number(one(raw, "size"));
  const uuid = (v?: string) => (v && /^[0-9a-f-]{36}$/i.test(v) ? v : undefined);
  return {
    q: uuid(one(raw, "q")),
    search: one(raw, "search")?.slice(0, 500),
    source: list(raw, "source"),
    sentiment: list(raw, "sentiment", SENTIMENTS),
    lang: list(raw, "lang"),
    country: list(raw, "country").map((c) => c.toUpperCase()),
    tag: list(raw, "tag"),
    type: list(raw, "type", CONTENT_TYPES),
    author: one(raw, "author")?.replace(/^@/, "").slice(0, 60),
    followers: FOLLOWER_BANDS.some((b) => b.id === one(raw, "followers"))
      ? one(raw, "followers")
      : undefined,
    media: one(raw, "media") === "1" ? true : undefined,
    spam: oneOf(one(raw, "spam"), ["hide", "show", "only"] as const, DEFAULTS.spam),
    flagged: one(raw, "flagged") === "1" ? true : undefined,
    range:
      range === "custom" || (RANGES as readonly string[]).includes(range ?? "")
        ? range!
        : DEFAULTS.range,
    from: isoDate(one(raw, "from")),
    to: isoDate(one(raw, "to")),
    since: one(raw, "since") === "last" ? "last" : undefined,
    sort: oneOf(one(raw, "sort"), SORTS, DEFAULTS.sort),
    view: oneOf(one(raw, "view"), VIEWS, DEFAULTS.view),
    page: Math.max(1, Math.min(10_000, Math.floor(Number(one(raw, "page"))) || 1)),
    size: (PAGE_SIZES as readonly number[]).includes(size)
      ? (size as FeedFilters["size"])
      : DEFAULTS.size,
    m: /^\d{1,18}$/.test(one(raw, "m") ?? "") ? one(raw, "m") : undefined,
  };
}

/** Serialise to a URL query string, omitting defaults so shared links stay short. */
export function toSearchParams(
  f: FeedFilters,
  opts: { includeDrawer?: boolean } = {},
): URLSearchParams {
  const p = new URLSearchParams();
  const arr = (k: string, v: string[]) => v.forEach((x) => p.append(k, x));
  if (f.q) p.set("q", f.q);
  if (f.search) p.set("search", f.search);
  arr("source", f.source);
  arr("sentiment", f.sentiment);
  arr("lang", f.lang);
  arr("country", f.country);
  arr("tag", f.tag);
  arr("type", f.type);
  if (f.author) p.set("author", f.author);
  if (f.followers) p.set("followers", f.followers);
  if (f.media) p.set("media", "1");
  if (f.spam !== DEFAULTS.spam) p.set("spam", f.spam);
  if (f.flagged) p.set("flagged", "1");
  if (f.range !== DEFAULTS.range) p.set("range", f.range);
  if (f.range === "custom") {
    if (f.from) p.set("from", f.from);
    if (f.to) p.set("to", f.to);
  }
  if (f.since) p.set("since", f.since);
  if (f.sort !== DEFAULTS.sort) p.set("sort", f.sort);
  if (f.view !== DEFAULTS.view) p.set("view", f.view);
  if (f.page !== DEFAULTS.page) p.set("page", String(f.page));
  if (f.size !== DEFAULTS.size) p.set("size", String(f.size));
  if (opts.includeDrawer && f.m) p.set("m", f.m);
  return p;
}

export interface Chip {
  key: string;
  label: string;
  value?: string;
}

/** One removable chip per active filter, for the filter bar. */
export function activeChips(
  f: FeedFilters,
  queryName?: (id: string) => string | undefined,
): Chip[] {
  const out: Chip[] = [];
  if (f.q) out.push({ key: "q", label: `Query: ${queryName?.(f.q) ?? "selected"}` });
  if (f.search) out.push({ key: "search", label: `Search: ${f.search}` });
  for (const v of f.source) out.push({ key: "source", value: v, label: `Source: ${v}` });
  for (const v of f.sentiment) out.push({ key: "sentiment", value: v, label: `Sentiment: ${v}` });
  for (const v of f.lang) out.push({ key: "lang", value: v, label: `Language: ${v}` });
  for (const v of f.country) out.push({ key: "country", value: v, label: `Country: ${v}` });
  for (const v of f.tag) out.push({ key: "tag", value: v, label: `Tag: ${v}` });
  for (const v of f.type) out.push({ key: "type", value: v, label: `Type: ${v}` });
  if (f.author) out.push({ key: "author", label: `Author: @${f.author}` });
  if (f.followers)
    out.push({
      key: "followers",
      label: `Followers: ${FOLLOWER_BANDS.find((b) => b.id === f.followers)?.label}`,
    });
  if (f.media) out.push({ key: "media", label: "Has media" });
  if (f.flagged) out.push({ key: "flagged", label: "Flagged" });
  if (f.since) out.push({ key: "since", label: "Since last visit" });
  if (f.spam === "show") out.push({ key: "spam", label: "Including likely spam" });
  if (f.spam === "only") out.push({ key: "spam", label: "Only likely spam" });
  return out;
}

export function removeChip(f: FeedFilters, c: Chip): FeedFilters {
  const next: FeedFilters = { ...f, page: 1 };
  const k = c.key as keyof FeedFilters;
  if (c.value !== undefined && Array.isArray(f[k]))
    (next[k] as string[]) = (f[k] as string[]).filter((x) => x !== c.value);
  else if (k === "spam") next.spam = "hide";
  else (next as unknown as Record<string, unknown>)[c.key] = undefined;
  return next;
}
