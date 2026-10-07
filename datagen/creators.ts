// Synthetic creator directory for the Influencers product. Every name, handle and bio is fictitious;
// nothing is scraped. Each creator derives its own Rng from (seed, id), so output never depends on
// generation order and a seeded run is reproducible.
import { COUNTRIES } from "./config";
import { rngFor, type Rng } from "./rng";

export const CREATOR_PLATFORMS = ["instagram", "tiktok", "youtube", "x"] as const;
export type CreatorPlatform = (typeof CREATOR_PLATFORMS)[number];

export const CREATOR_NICHES = [
  "beauty",
  "fashion",
  "fitness",
  "food",
  "travel",
  "gaming",
  "tech",
  "parenting",
  "finance",
  "home",
  "sports",
  "music",
  "wellness",
  "pets",
  "automotive",
] as const;
export type CreatorNiche = (typeof CREATOR_NICHES)[number];

export const AGE_BANDS = ["13-17", "18-24", "25-34", "35-44", "45+"] as const;
export type BrandSafety = "safe" | "caution" | "risk";

export interface CreatorAudience {
  /** Share of audience per age band, summing to 100. */
  age: Record<(typeof AGE_BANDS)[number], number>;
  /** Percent of audience that is female / male / other, summing to 100. */
  gender: { female: number; male: number; other: number };
  countries: { code: string; pct: number }[];
  interests: { name: string; pct: number }[];
}

export interface Creator {
  id: number;
  platform: CreatorPlatform;
  handle: string;
  displayName: string;
  bio: string;
  niche: CreatorNiche;
  tags: string[];
  country: string;
  language: string;
  followers: number;
  engagementRate: number; // percent, e.g. 3.42
  avgViews: number;
  postsPerWeek: number;
  growth30d: number; // percent follower change over the last 30 days
  verified: boolean;
  sponsoredPct: number; // share of recent posts that were paid partnerships
  fakeFollowerPct: number;
  authenticityScore: number; // 0-100, higher is better
  brandSafety: BrandSafety;
  ratePerPostUsd: number;
  avatarSeed: number;
  audience: CreatorAudience;
}

export type FollowerTier = "nano" | "micro" | "mid" | "macro" | "mega";
export const TIER_BOUNDS: Record<FollowerTier, [number, number]> = {
  nano: [0, 10_000],
  micro: [10_000, 100_000],
  mid: [100_000, 500_000],
  macro: [500_000, 1_000_000],
  mega: [1_000_000, Number.MAX_SAFE_INTEGER],
};
export const tierOf = (followers: number): FollowerTier =>
  followers < 10_000
    ? "nano"
    : followers < 100_000
      ? "micro"
      : followers < 500_000
        ? "mid"
        : followers < 1_000_000
          ? "macro"
          : "mega";

const FIRST = [
  "Ana",
  "Bram",
  "Cleo",
  "Dara",
  "Eli",
  "Fenn",
  "Gia",
  "Hugo",
  "Isla",
  "Jori",
  "Kai",
  "Lena",
  "Milo",
  "Nia",
  "Otto",
  "Pia",
  "Quin",
  "Rhea",
  "Sol",
  "Tove",
  "Uma",
  "Vik",
  "Wren",
  "Xia",
  "Yara",
  "Zane",
  "Ivo",
  "Mara",
  "Nico",
  "Odalys",
  "Priya",
  "Remy",
  "Saba",
  "Teo",
];
const LAST = [
  "Alder",
  "Brook",
  "Castell",
  "Dunmore",
  "Ember",
  "Falk",
  "Garrow",
  "Hale",
  "Iverson",
  "Jarrow",
  "Kestrel",
  "Lund",
  "Marlow",
  "Norr",
  "Okafor",
  "Pell",
  "Quarry",
  "Rosetti",
  "Sato",
  "Thorne",
  "Umber",
  "Vance",
  "Wick",
  "Yoder",
  "Zeller",
  "Moreau",
  "Duarte",
  "Ibarra",
  "Novak",
  "Rao",
];
const HANDLE_WORDS: Record<CreatorNiche, string[]> = {
  beauty: ["glow", "lash", "dew", "blush", "skin"],
  fashion: ["thread", "wear", "drape", "stitch", "style"],
  fitness: ["lift", "sweat", "reps", "move", "stride"],
  food: ["plate", "spoon", "bake", "simmer", "crumb"],
  travel: ["roam", "wander", "route", "pack", "drift"],
  gaming: ["pixel", "respawn", "loot", "joy", "level"],
  tech: ["byte", "gizmo", "circuit", "stack", "patch"],
  parenting: ["tiny", "nest", "cuddle", "hatch", "bloom"],
  finance: ["ledger", "coin", "save", "yield", "budget"],
  home: ["nook", "reno", "hearth", "shelf", "grain"],
  sports: ["goal", "sprint", "court", "pitch", "serve"],
  music: ["chord", "beat", "tempo", "riff", "echo"],
  wellness: ["calm", "breathe", "root", "still", "balance"],
  pets: ["paw", "whisker", "fetch", "tail", "purr"],
  automotive: ["torque", "gear", "drift", "axle", "rev"],
};
const BASE_ER: Record<CreatorPlatform, number> = {
  instagram: 3.2,
  tiktok: 6.5,
  youtube: 3.8,
  x: 1.4,
};
const CPM_USD: Record<CreatorPlatform, number> = { instagram: 12, tiktok: 9, youtube: 22, x: 6 };
const LANG_BY_COUNTRY = (code: string) => COUNTRIES.find((c) => c.code === code)?.langs[0] ?? "en";
const INTEREST_POOL = [
  "Travel",
  "Fitness",
  "Cooking",
  "Gadgets",
  "Fashion",
  "Gaming",
  "Finance",
  "Home decor",
  "Pets",
  "Music",
  "Outdoors",
  "Wellness",
  "Cars",
  "Parenting",
  "Sports",
  "Skincare",
];

function split(rng: Rng, weights: number[], noise = 0.25): number[] {
  const w = weights.map((x) => Math.max(0.01, x * (1 + noise * rng.normal())));
  const total = w.reduce((a, b) => a + b, 0);
  const pct = w.map((x) => Math.round((x / total) * 100));
  // Rounding drift goes to the largest bucket so the parts always sum to exactly 100.
  const drift = 100 - pct.reduce((a, b) => a + b, 0);
  pct[pct.indexOf(Math.max(...pct))]! += drift;
  return pct;
}

export function generateCreator(seed: number, id: number): Creator {
  const rng = rngFor(seed, "creator", id);
  const platform = rng.pickWeighted(CREATOR_PLATFORMS, [38, 32, 20, 10]);
  const niche = rng.pick(CREATOR_NICHES);
  const country = rng.pickWeighted(
    COUNTRIES.map((c) => c.code),
    COUNTRIES.map((c) => c.weight),
  );
  const first = rng.pick(FIRST);
  const last = rng.pick(LAST);
  const word = rng.pick(HANDLE_WORDS[niche]);
  const handle = `${rng.bool(0.5) ? word : first.toLowerCase()}${rng.bool(0.5) ? "_" : ""}${
    rng.bool(0.5) ? last.toLowerCase() : word
  }${rng.bool(0.35) ? rng.int(99) : ""}`.slice(0, 24);

  const followers = Math.min(40_000_000, Math.round(rng.pareto(1_500, 0.85)));
  // Large accounts engage less per follower; add per-creator noise.
  const er = Math.max(
    0.2,
    BASE_ER[platform] *
      Math.pow(Math.max(followers, 1_000) / 10_000, -0.12) *
      rng.lognormal(0, 0.35),
  );

  // About 9% of creators have inflated audiences: more fake followers and engagement that doesn't add up.
  const suspicious = rng.bool(0.09);
  const fakeFollowerPct = suspicious
    ? Math.round(rng.range(28, 62) * 10) / 10
    : Math.round(Math.min(25, 2 + rng.exp(5)) * 10) / 10;
  const engagementRate = Math.round((suspicious ? er * rng.range(0.25, 0.55) : er) * 100) / 100;
  const sponsoredPct = Math.round(Math.min(60, rng.exp(12)) * 10) / 10;
  const authenticityScore = Math.max(
    5,
    Math.min(
      99,
      Math.round(
        100 - fakeFollowerPct * 1.3 - Math.max(0, sponsoredPct - 35) * 0.5 + rng.normal() * 2,
      ),
    ),
  );
  const brandSafety: BrandSafety = rng.pickWeighted(
    ["safe", "caution", "risk"] as const,
    [88, 9, 3],
  );

  const avgViews = Math.round(
    followers *
      (platform === "tiktok"
        ? rng.range(0.15, 0.6)
        : platform === "youtube"
          ? rng.range(0.05, 0.25)
          : rng.range(0.08, 0.35)),
  );
  const rate = Math.max(
    25,
    Math.round(((avgViews / 1000) * CPM_USD[platform] * (1 + engagementRate / 20)) / 25) * 25,
  );

  const female = Math.round(
    Math.min(
      92,
      Math.max(
        8,
        52 +
          (["beauty", "fashion", "parenting", "wellness"].includes(niche)
            ? 22
            : ["gaming", "automotive", "sports", "tech"].includes(niche)
              ? -24
              : 0) +
          rng.normal() * 8,
      ),
    ),
  );
  const other = rng.int(3);
  const youth = platform === "tiktok" ? 1.8 : platform === "youtube" ? 0.9 : 1;
  const age = split(rng, [8 * youth, 30 * youth, 32, 18 / youth, 12 / youth]);
  const homeShare = Math.round(rng.range(45, 85));
  const others = COUNTRIES.filter((c) => c.code !== country);
  const second = rng.pickWeighted(
    others,
    others.map((c) => c.weight),
  );
  const third = rng.pick(others.filter((c) => c.code !== second.code));
  const remainder = 100 - homeShare;
  const otherPct = Math.floor(remainder * 0.2);
  const secondPct = Math.round(((remainder - otherPct) * split(rng, [3, 2])[0]!) / 100);
  const countries = [
    { code: country, pct: homeShare },
    { code: second.code, pct: secondPct },
    { code: third.code, pct: remainder - otherPct - secondPct },
    { code: "Other", pct: otherPct },
  ];
  const interestNames = [
    ...new Set([
      niche[0]!.toUpperCase() + niche.slice(1),
      ...Array.from({ length: 3 }, () => rng.pick(INTEREST_POOL)),
    ]),
  ];
  const interests = interestNames.slice(0, 4).map((name, i) => ({
    name,
    pct: Math.round(Math.max(8, 62 - i * 14 + rng.normal() * 5)),
  }));

  const tags = [
    ...new Set([
      niche,
      rng.pick(CREATOR_NICHES),
      rng.pick(["reviews", "tutorials", "vlogs", "challenges", "unboxing", "day-in-the-life"]),
    ]),
  ];
  return {
    id,
    platform,
    handle,
    displayName: `${first} ${last}`,
    bio: `${rng.pick(["Sharing", "Obsessed with", "Making", "Reviewing", "Exploring"])} ${niche} ${rng.pick(["every day", "for real people", "without the filter", "one post at a time"])}. Collabs welcome.`,
    niche,
    tags,
    country,
    language: LANG_BY_COUNTRY(country),
    followers,
    engagementRate,
    avgViews,
    postsPerWeek: Math.round(rng.range(0.5, 9) * 10) / 10,
    growth30d: Math.round((rng.normal() * 2.2 + (suspicious ? 6 : 0.8)) * 10) / 10,
    verified: followers > 100_000 && rng.bool(0.4),
    sponsoredPct,
    fakeFollowerPct,
    authenticityScore,
    brandSafety,
    ratePerPostUsd: rate,
    avatarSeed: rng.int(1_000_000),
    audience: {
      age: Object.fromEntries(AGE_BANDS.map((b, i) => [b, age[i]!])) as CreatorAudience["age"],
      gender: { female: female - other, male: 100 - female, other },
      countries,
      interests,
    },
  };
}

export function generateCreators(seed: number, n: number): Creator[] {
  return Array.from({ length: n }, (_, i) => generateCreator(seed, i + 1));
}
