// Discovery filters live in the URL, so a search can be bookmarked, shared and survives reload.
import {
  CREATOR_NICHES,
  CREATOR_PLATFORMS,
  TIER_BOUNDS,
  type FollowerTier,
} from "@/datagen/creators";

export const SORTS = ["followers", "engagement", "authenticity", "growth", "rate"] as const;
export type CreatorSort = (typeof SORTS)[number];
export const SORT_LABEL: Record<CreatorSort, string> = {
  followers: "Followers",
  engagement: "Engagement rate",
  authenticity: "Authenticity",
  growth: "30-day growth",
  rate: "Estimated rate",
};
export const PAGE_SIZE = 25;
export const TIERS = Object.keys(TIER_BOUNDS) as FollowerTier[];

export interface CreatorFilters {
  q: string;
  platforms: string[];
  niches: string[];
  tiers: FollowerTier[];
  countries: string[];
  minEngagement: number | null;
  minAuthenticity: number | null;
  safeOnly: boolean;
  sort: CreatorSort;
  page: number;
}

type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const many = (v: string | string[] | undefined, allowed?: readonly string[]) =>
  (Array.isArray(v) ? v : one(v).split(","))
    .map((s) => s.trim())
    .filter((s) => s && (!allowed || allowed.includes(s)));
const num = (v: string | string[] | undefined, min: number, max: number) => {
  const n = Number(one(v));
  return one(v) !== "" && Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : null;
};

export function parseCreatorFilters(sp: Params): CreatorFilters {
  const sort = one(sp.sort);
  const page = Math.floor(Number(one(sp.page)));
  return {
    q: one(sp.q).trim().slice(0, 80),
    platforms: many(sp.platform, CREATOR_PLATFORMS),
    niches: many(sp.niche, CREATOR_NICHES),
    tiers: many(sp.tier, TIERS) as FollowerTier[],
    countries: many(sp.country).filter((c) => /^[A-Z]{2}$/.test(c)),
    minEngagement: num(sp.eng, 0, 100),
    minAuthenticity: num(sp.auth, 0, 100),
    safeOnly: one(sp.safe) === "1",
    sort: (SORTS as readonly string[]).includes(sort) ? (sort as CreatorSort) : "followers",
    page: Number.isFinite(page) && page > 0 ? Math.min(page, 2000) : 1,
  };
}

/** Back to URL params, omitting defaults, so the address stays short and canonical. */
export function filtersToParams(f: Partial<CreatorFilters>): URLSearchParams {
  const p = new URLSearchParams();
  if (f.q) p.set("q", f.q);
  if (f.platforms?.length) p.set("platform", f.platforms.join(","));
  if (f.niches?.length) p.set("niche", f.niches.join(","));
  if (f.tiers?.length) p.set("tier", f.tiers.join(","));
  if (f.countries?.length) p.set("country", f.countries.join(","));
  if (f.minEngagement != null) p.set("eng", String(f.minEngagement));
  if (f.minAuthenticity != null) p.set("auth", String(f.minAuthenticity));
  if (f.safeOnly) p.set("safe", "1");
  if (f.sort && f.sort !== "followers") p.set("sort", f.sort);
  if (f.page && f.page > 1) p.set("page", String(f.page));
  return p;
}

export const activeFilterCount = (f: CreatorFilters) =>
  (f.q ? 1 : 0) +
  (f.platforms.length ? 1 : 0) +
  (f.niches.length ? 1 : 0) +
  (f.tiers.length ? 1 : 0) +
  (f.countries.length ? 1 : 0) +
  (f.minEngagement != null ? 1 : 0) +
  (f.minAuthenticity != null ? 1 : 0) +
  (f.safeOnly ? 1 : 0);
