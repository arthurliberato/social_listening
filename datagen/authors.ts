import { COUNTRIES, SOURCES, type Lang, type SourceType } from "./config";
import { Rng, rngFor } from "./rng";

export type AuthorType = "consumer" | "influencer" | "journalist" | "brand" | "bot";

export interface Author {
  id: number;
  sourceId: number;
  sourceType: SourceType;
  handle: string;
  displayName: string;
  followers: number;
  following: number;
  verified: boolean;
  country: string;
  language: Lang;
  type: AuthorType;
  botScore: number;
  bio: string;
  avatarSeed: number;
  createdAt: number;
}

const SYL = [
  "ka",
  "lo",
  "mi",
  "ra",
  "ten",
  "vo",
  "su",
  "ni",
  "bel",
  "dor",
  "fin",
  "gar",
  "hal",
  "jun",
  "kel",
  "lum",
  "mor",
  "nex",
  "pol",
  "quin",
  "sar",
  "tov",
  "ulm",
  "vex",
  "wyn",
  "zed",
];
const FIRST = [
  "Alex",
  "Sam",
  "Jordan",
  "Maria",
  "Lucas",
  "Sofia",
  "Hugo",
  "Ana",
  "Tom",
  "Lena",
  "Marco",
  "Chloe",
  "Ravi",
  "Mei",
  "Diego",
  "Nora",
  "Ivan",
  "Zoe",
  "Omar",
  "Elsa",
];
const LAST = [
  "Alder",
  "Brook",
  "Castell",
  "Duarte",
  "Eklund",
  "Ferro",
  "Gallo",
  "Hart",
  "Ibarra",
  "Jansen",
  "Keller",
  "Lima",
  "Moreau",
  "Novak",
  "Okoye",
  "Pires",
  "Quade",
  "Rossi",
  "Sato",
  "Tran",
];
const OUTLET = [
  "Daily Ledger",
  "The Courier",
  "Metro Wire",
  "Signal Post",
  "Harbor Times",
  "Capital Brief",
  "Open Desk",
  "The Dispatch",
];
const BIO = [
  "coffee, code, chaos",
  "runner. reader. opinions are mine",
  "travel | food | tech",
  "mum of two, proud of both",
  "reviews and rants",
  "just here for the memes",
  "photographer based in the city",
  "student of everything",
];

const TYPE_WEIGHTS: [AuthorType, number][] = [
  ["consumer", 93.5],
  ["influencer", 2],
  ["journalist", 1],
  ["brand", 0.5],
  ["bot", 3],
];

/** Which author types may live on which source. */
const ALLOWED: Record<SourceType, AuthorType[]> = {
  x: ["consumer", "influencer", "journalist", "brand", "bot"],
  instagram: ["consumer", "influencer", "brand", "bot"],
  tiktok: ["consumer", "influencer", "bot"],
  facebook: ["consumer", "influencer", "brand", "bot"],
  youtube: ["consumer", "influencer"],
  reddit: ["consumer", "bot"],
  news: ["journalist"],
  blog: ["consumer", "influencer", "journalist"],
  forum: ["consumer", "bot"],
  review: ["consumer", "bot"],
};

function handleFor(rng: Rng): string {
  const n = 2 + rng.int(2);
  let h = "";
  for (let i = 0; i < n; i++) h += rng.pick(SYL);
  return rng.bool(0.4) ? `${h}${rng.int(99)}` : h;
}

function followersFor(type: AuthorType, rng: Rng): number {
  switch (type) {
    case "influencer":
      return Math.min(5_000_000, Math.round(rng.pareto(20_000, 1.1)));
    case "journalist":
      return Math.min(400_000, Math.round(rng.pareto(3_000, 1.3)));
    case "brand":
      return Math.round(rng.pareto(10_000, 1.2));
    case "bot":
      return Math.round(rng.lognormal(3, 1.2));
    default:
      return Math.min(2_000_000, Math.round(rng.pareto(25, 0.85))); // most < 500, rare giants
  }
}

export class AuthorPool {
  readonly authors: Author[] = [];
  /** `${sourceType}:${type}:${country}` -> author indexes */
  private buckets = new Map<string, number[]>();
  private bySourceType = new Map<string, number[]>();

  constructor(seed: number, count: number) {
    const rng = rngFor(seed, "authors");
    const sourceWeights = SOURCES.map((s) => s.share);
    const countryWeights = COUNTRIES.map((c) => c.weight);
    const typeWeights = TYPE_WEIGHTS.map(([, w]) => w);
    for (let id = 1; id <= count; id++) {
      const source = SOURCES[rng.weighted(sourceWeights)]!;
      let type = TYPE_WEIGHTS[rng.weighted(typeWeights)]![0];
      const allowed = ALLOWED[source.type];
      if (!allowed.includes(type)) type = allowed[0]!;
      const country = COUNTRIES[rng.weighted(countryWeights)]!;
      const language = rng.pick(country.langs);
      const followers = followersFor(type, rng);
      const outlet = type === "journalist" && source.type === "news";
      const handle = outlet
        ? rng.pick(OUTLET).toLowerCase().replace(/\s+/g, "") + rng.int(50)
        : handleFor(rng);
      const a: Author = {
        id,
        sourceId: source.id,
        sourceType: source.type,
        handle,
        displayName: outlet ? rng.pick(OUTLET) : `${rng.pick(FIRST)} ${rng.pick(LAST)}`,
        followers,
        following: Math.round(followers * rng.range(0.05, 2) + rng.int(300)),
        verified:
          type === "journalist" || type === "brand"
            ? rng.bool(0.8)
            : type === "influencer"
              ? rng.bool(0.5)
              : rng.bool(0.003),
        country: country.code,
        language,
        type,
        botScore: type === "bot" ? rng.range(0.7, 0.99) : rng.range(0, 0.25),
        bio: type === "bot" ? "follow back | dm for promo" : rng.pick(BIO),
        avatarSeed: rng.int(1_000_000),
        createdAt: Date.UTC(2012 + rng.int(13), rng.int(12), 1 + rng.int(28)),
      };
      this.authors.push(a);
      const idx = id - 1;
      const key = `${source.type}:${type}:${country.code}`;
      (this.buckets.get(key) ?? this.buckets.set(key, []).get(key)!).push(idx);
      const k2 = `${source.type}:${type}`;
      (this.bySourceType.get(k2) ?? this.bySourceType.set(k2, []).get(k2)!).push(idx);
    }
  }

  /** Pick an author for a source/type/country, falling back gracefully. Low indexes post more. */
  pick(rng: Rng, sourceType: SourceType, type: AuthorType, country: string): Author {
    const bucket =
      this.buckets.get(`${sourceType}:${type}:${country}`) ??
      this.bySourceType.get(`${sourceType}:${type}`) ??
      this.bySourceType.get(`${sourceType}:${ALLOWED[sourceType][0]}`)!;
    const i = Math.floor(bucket.length * Math.pow(rng.float(), 1.6));
    return this.authors[bucket[i]!]!;
  }

  /** Mid-reach author (5k..80k followers) to seed a crisis trigger post. */
  pickMidReach(rng: Rng, country: string): Author {
    for (let tries = 0; tries < 200; tries++) {
      const a = this.pick(
        rng,
        rng.pick(["x", "tiktok", "instagram", "reddit"] as SourceType[]),
        "consumer",
        country,
      );
      if (a.followers >= 5_000 && a.followers <= 80_000) return a;
    }
    return this.pick(rng, "x", "influencer", country);
  }

  influencers(sourceType: SourceType): number[] {
    return this.bySourceType.get(`${sourceType}:influencer`) ?? [];
  }
  journalists(): number[] {
    return this.bySourceType.get("news:journalist") ?? [];
  }
}
