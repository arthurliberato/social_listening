// Static world definition. Every brand, person, handle and URL is fictitious.

export const HISTORY_START = Date.UTC(2024, 9, 1); // 2024-10-01
export const SIM_NOW = Date.UTC(2026, 9, 1); // end of 24 months of history
export const WORLD_END = Date.UTC(2027, 3, 1); // + 6 months released later on the sim clock
export const DAY_MS = 86_400_000;
export const HOUR_MS = 3_600_000;

export type Lang = "en" | "es" | "pt" | "fr" | "de" | "it";

export interface Country {
  code: string;
  name: string;
  langs: Lang[];
  tz: number; // UTC offset, hours
  weight: number; // share of global posting
  cities: string[];
}

export const COUNTRIES: Country[] = [
  {
    code: "US",
    name: "United States",
    langs: ["en"],
    tz: -6,
    weight: 24,
    cities: ["Austin", "Denver", "Chicago", "Seattle", "Miami"],
  },
  {
    code: "GB",
    name: "United Kingdom",
    langs: ["en"],
    tz: 0,
    weight: 7,
    cities: ["Leeds", "Bristol", "Glasgow"],
  },
  {
    code: "CA",
    name: "Canada",
    langs: ["en", "fr"],
    tz: -5,
    weight: 4,
    cities: ["Toronto", "Montreal", "Calgary"],
  },
  {
    code: "AU",
    name: "Australia",
    langs: ["en"],
    tz: 10,
    weight: 3,
    cities: ["Perth", "Brisbane"],
  },
  {
    code: "IN",
    name: "India",
    langs: ["en"],
    tz: 5.5,
    weight: 8,
    cities: ["Pune", "Jaipur", "Kochi"],
  },
  {
    code: "BR",
    name: "Brazil",
    langs: ["pt"],
    tz: -3,
    weight: 9,
    cities: ["Recife", "Curitiba", "Salvador"],
  },
  { code: "PT", name: "Portugal", langs: ["pt"], tz: 0, weight: 1.5, cities: ["Porto", "Braga"] },
  { code: "MX", name: "Mexico", langs: ["es"], tz: -6, weight: 6, cities: ["Monterrey", "Puebla"] },
  { code: "ES", name: "Spain", langs: ["es"], tz: 1, weight: 4, cities: ["Valencia", "Sevilla"] },
  {
    code: "AR",
    name: "Argentina",
    langs: ["es"],
    tz: -3,
    weight: 2.5,
    cities: ["Rosario", "Mendoza"],
  },
  {
    code: "FR",
    name: "France",
    langs: ["fr"],
    tz: 1,
    weight: 5,
    cities: ["Lyon", "Nantes", "Lille"],
  },
  {
    code: "DE",
    name: "Germany",
    langs: ["de"],
    tz: 1,
    weight: 6,
    cities: ["Leipzig", "Bremen", "Dresden"],
  },
  { code: "IT", name: "Italy", langs: ["it"], tz: 1, weight: 3.5, cities: ["Torino", "Bologna"] },
];

export type SourceType =
  | "x"
  | "instagram"
  | "tiktok"
  | "facebook"
  | "youtube"
  | "reddit"
  | "news"
  | "blog"
  | "forum"
  | "review";

export interface Source {
  id: number;
  type: SourceType;
  displayName: string;
  reachMultiplier: number;
  share: number; // share of ordinary (non-news-story) mentions
  contentTypes: string[];
}

// Display names are deliberately generic: no real platform branding.
export const SOURCES: Source[] = [
  {
    id: 1,
    type: "x",
    displayName: "X (simulated)",
    reachMultiplier: 1,
    share: 30,
    contentTypes: ["post"],
  },
  {
    id: 2,
    type: "instagram",
    displayName: "Instagram (simulated)",
    reachMultiplier: 1.1,
    share: 14,
    contentTypes: ["post"],
  },
  {
    id: 3,
    type: "tiktok",
    displayName: "TikTok (simulated)",
    reachMultiplier: 1.6,
    share: 12,
    contentTypes: ["video"],
  },
  {
    id: 4,
    type: "facebook",
    displayName: "Facebook (simulated)",
    reachMultiplier: 0.9,
    share: 12,
    contentTypes: ["post"],
  },
  {
    id: 5,
    type: "youtube",
    displayName: "YouTube (simulated)",
    reachMultiplier: 2,
    share: 4,
    contentTypes: ["video"],
  },
  {
    id: 6,
    type: "reddit",
    displayName: "Reddit (simulated)",
    reachMultiplier: 0.8,
    share: 10,
    contentTypes: ["post"],
  },
  {
    id: 7,
    type: "news",
    displayName: "News (simulated)",
    reachMultiplier: 6,
    share: 3,
    contentTypes: ["article"],
  },
  {
    id: 8,
    type: "blog",
    displayName: "Blogs (simulated)",
    reachMultiplier: 1.2,
    share: 3,
    contentTypes: ["article"],
  },
  {
    id: 9,
    type: "forum",
    displayName: "Forums (simulated)",
    reachMultiplier: 0.5,
    share: 5,
    contentTypes: ["post"],
  },
  {
    id: 10,
    type: "review",
    displayName: "Reviews (simulated)",
    reachMultiplier: 0.6,
    share: 7,
    contentTypes: ["review"],
  },
];
export const SOURCE_BY_TYPE = Object.fromEntries(SOURCES.map((s) => [s.type, s])) as Record<
  SourceType,
  Source
>;

export type Vertical = "coffee" | "sneakers" | "fintech" | "airlines" | "beauty" | "ev";

export interface VerticalConfig {
  topics: string[];
  /** Mon..Sun volume multipliers */
  weekday: number[];
  /** Seasonal windows [month(1-12), startDay, endDay, multiplier, label] */
  seasonal: [number, number, number, number, string][];
  /** Marker words that appear in pickup/news headlines */
  nouns: string[];
}

export const VERTICALS: Record<Vertical, VerticalConfig> = {
  coffee: {
    topics: ["price", "taste", "service", "app", "queue", "sustainability"],
    weekday: [1.15, 1.1, 1.05, 1.05, 1.0, 0.85, 0.8],
    seasonal: [
      [10, 15, 31, 1.3, "autumn menu"],
      [12, 1, 24, 1.35, "holiday drinks"],
    ],
    nouns: ["latte", "roast", "cafe"],
  },
  sneakers: {
    topics: ["comfort", "design", "price", "quality", "delivery", "sizing"],
    weekday: [0.95, 0.95, 1.0, 1.0, 1.1, 1.05, 1.0],
    seasonal: [
      [11, 20, 30, 1.6, "Black Friday"],
      [8, 15, 31, 1.2, "back to school"],
    ],
    nouns: ["sneaker", "drop", "collab"],
  },
  fintech: {
    topics: ["fees", "app", "support", "security", "transfers", "onboarding"],
    weekday: [1.2, 1.15, 1.1, 1.05, 1.0, 0.7, 0.65],
    seasonal: [
      [4, 1, 15, 1.3, "tax season"],
      [1, 2, 20, 1.25, "new year budgets"],
    ],
    nouns: ["wallet", "payments", "app"],
  },
  airlines: {
    topics: ["delays", "baggage", "service", "price", "seats", "refunds"],
    weekday: [1.1, 1.0, 0.95, 1.0, 1.15, 1.0, 1.05],
    seasonal: [
      [7, 1, 31, 1.4, "summer travel"],
      [12, 15, 31, 1.5, "holiday travel"],
    ],
    nouns: ["flight", "route", "airline"],
  },
  beauty: {
    topics: ["quality", "price", "packaging", "skin reaction", "sustainability", "delivery"],
    weekday: [0.95, 1.0, 1.0, 1.05, 1.05, 1.05, 1.0],
    seasonal: [
      [2, 1, 14, 1.4, "Valentine's"],
      [5, 1, 12, 1.25, "Mother's Day"],
    ],
    nouns: ["serum", "palette", "skincare"],
  },
  ev: {
    topics: ["range", "charging", "price", "software", "service", "design"],
    weekday: [1.1, 1.1, 1.05, 1.0, 1.0, 0.85, 0.8],
    seasonal: [
      [3, 1, 20, 1.2, "spring deliveries"],
      [10, 1, 20, 1.15, "model year"],
    ],
    nouns: ["EV", "charger", "model"],
  },
};

export interface BrandDef {
  name: string;
  vertical: Vertical;
  /** Short form used by naive queries; collides with another meaning when homonym is set. */
  short: string;
  /** Other sense of the short name (null = none). */
  homonym: { sense: string; phrases: string[] } | null;
  size: number; // relative baseline weight
  markets: string[]; // country codes
}

const H = (sense: string, ...phrases: string[]) => ({ sense, phrases });

export const BRANDS: BrandDef[] = [
  // coffee
  {
    name: "Juniper Roast",
    vertical: "coffee",
    short: "Juniper",
    homonym: H(
      "plant/network vendor",
      "juniper berries in the gin",
      "juniper bush needs trimming",
      "juniper router firmware update",
    ),
    size: 2.2,
    markets: ["US", "GB", "CA", "AU"],
  },
  {
    name: "Brewline",
    vertical: "coffee",
    short: "Brewline",
    homonym: null,
    size: 1.6,
    markets: ["US", "CA", "GB"],
  },
  {
    name: "Kopa Roasters",
    vertical: "coffee",
    short: "Kopa",
    homonym: null,
    size: 1.0,
    markets: ["BR", "PT", "ES", "MX"],
  },
  {
    name: "Daybreak Cup",
    vertical: "coffee",
    short: "Daybreak",
    homonym: H("sunrise", "daybreak over the lake", "at daybreak we left", "daybreak patrol"),
    size: 0.8,
    markets: ["US", "GB", "AU"],
  },
  {
    name: "Ember Bean",
    vertical: "coffee",
    short: "Ember",
    homonym: H(
      "glowing coal",
      "the last ember of the fire",
      "ember glow",
      "ember framework upgrade",
    ),
    size: 0.6,
    markets: ["US", "DE", "FR"],
  },
  {
    name: "Latte Lane",
    vertical: "coffee",
    short: "Latte Lane",
    homonym: null,
    size: 0.5,
    markets: ["GB", "IN", "AU"],
  },
  {
    name: "Quill & Cup",
    vertical: "coffee",
    short: "Quill",
    homonym: H("pen", "a goose quill pen", "quill and ink calligraphy", "quill rich text editor"),
    size: 0.35,
    markets: ["US", "GB"],
  },
  // sneakers
  {
    name: "Stridewell",
    vertical: "sneakers",
    short: "Stridewell",
    homonym: null,
    size: 2.4,
    markets: ["US", "GB", "DE", "FR", "BR"],
  },
  {
    name: "Nimbus Run",
    vertical: "sneakers",
    short: "Nimbus",
    homonym: H("cloud", "nimbus clouds rolling in", "dark nimbus overhead", "nimbus 2000 broom"),
    size: 1.8,
    markets: ["US", "GB", "IN", "AU"],
  },
  {
    name: "Apex Sole",
    vertical: "sneakers",
    short: "Apex",
    homonym: H(
      "peak/generic",
      "apex predator documentary",
      "apex legends ranked",
      "apex of the curve",
    ),
    size: 1.5,
    markets: ["US", "BR", "MX", "ES"],
  },
  {
    name: "Kickforge",
    vertical: "sneakers",
    short: "Kickforge",
    homonym: null,
    size: 0.9,
    markets: ["US", "CA", "GB"],
  },
  {
    name: "Lumen Low",
    vertical: "sneakers",
    short: "Lumen",
    homonym: H(
      "light unit",
      "400 lumen flashlight",
      "lumen output of the bulb",
      "lumen database library",
    ),
    size: 0.7,
    markets: ["DE", "FR", "IT", "ES"],
  },
  {
    name: "Tempo Tread",
    vertical: "sneakers",
    short: "Tempo",
    homonym: H("musical speed", "tempo of the song", "slow tempo jazz", "tempo run training plan"),
    size: 0.55,
    markets: ["US", "GB", "AU"],
  },
  {
    name: "Orbit Lace",
    vertical: "sneakers",
    short: "Orbit",
    homonym: H("space path", "orbit of the moon", "low earth orbit launch", "orbit gum"),
    size: 0.3,
    markets: ["IN", "US"],
  },
  // fintech
  {
    name: "Pocketly",
    vertical: "fintech",
    short: "Pocketly",
    homonym: null,
    size: 2.0,
    markets: ["US", "GB", "IN", "BR"],
  },
  {
    name: "Ledgerly",
    vertical: "fintech",
    short: "Ledgerly",
    homonym: null,
    size: 1.2,
    markets: ["US", "GB", "CA"],
  },
  {
    name: "Fernpay",
    vertical: "fintech",
    short: "Fernpay",
    homonym: null,
    size: 0.9,
    markets: ["DE", "FR", "IT", "ES"],
  },
  {
    name: "Coinleaf",
    vertical: "fintech",
    short: "Coinleaf",
    homonym: null,
    size: 1.4,
    markets: ["US", "BR", "MX", "AR"],
  },
  {
    name: "Tallyfy",
    vertical: "fintech",
    short: "Tallyfy",
    homonym: null,
    size: 0.6,
    markets: ["US", "IN"],
  },
  {
    name: "Northvault",
    vertical: "fintech",
    short: "Northvault",
    homonym: null,
    size: 0.8,
    markets: ["CA", "US", "GB"],
  },
  {
    name: "Zephyr Pay",
    vertical: "fintech",
    short: "Zephyr",
    homonym: H("wind", "a gentle zephyr in the evening", "zephyr breeze", "zephyr real-time os"),
    size: 0.45,
    markets: ["US", "AU", "GB"],
  },
  // airlines
  {
    name: "Skyharbor Air",
    vertical: "airlines",
    short: "Skyharbor",
    homonym: null,
    size: 2.6,
    markets: ["US", "CA", "MX", "GB"],
  },
  {
    name: "Meridian Air",
    vertical: "airlines",
    short: "Meridian",
    homonym: H(
      "longitude line",
      "prime meridian marker",
      "meridian of the map",
      "meridian hotel lobby",
    ),
    size: 1.9,
    markets: ["GB", "DE", "FR", "IT", "ES"],
  },
  {
    name: "Condor Lines",
    vertical: "airlines",
    short: "Condor",
    homonym: H(
      "bird",
      "condor soaring over the andes",
      "california condor recovery",
      "condor network service",
    ),
    size: 1.3,
    markets: ["AR", "BR", "MX", "ES"],
  },
  {
    name: "Aurora Jet",
    vertical: "airlines",
    short: "Aurora",
    homonym: H(
      "polar lights",
      "aurora borealis tonight",
      "aurora photos from iceland",
      "aurora is my niece's name",
    ),
    size: 0.9,
    markets: ["CA", "GB", "DE"],
  },
  {
    name: "Bluewing",
    vertical: "airlines",
    short: "Bluewing",
    homonym: H(
      "insect/bird",
      "bluewing teal duck",
      "bluewing butterfly",
      "blue wing of the museum",
    ),
    size: 0.7,
    markets: ["US", "AU", "IN"],
  },
  {
    name: "Tradewind Air",
    vertical: "airlines",
    short: "Tradewind",
    homonym: H(
      "wind pattern",
      "tradewind sailing route",
      "tradewind currents",
      "tradewind island resort",
    ),
    size: 0.4,
    markets: ["PT", "BR", "ES"],
  },
  // beauty
  {
    name: "Velour Skin",
    vertical: "beauty",
    short: "Velour",
    homonym: H("fabric", "velour tracksuit", "velour curtains", "crushed velour sofa"),
    size: 2.1,
    markets: ["US", "GB", "FR", "BR"],
  },
  {
    name: "Petalmint",
    vertical: "beauty",
    short: "Petalmint",
    homonym: null,
    size: 1.1,
    markets: ["US", "IN", "AU"],
  },
  {
    name: "Glowmade",
    vertical: "beauty",
    short: "Glowmade",
    homonym: null,
    size: 1.5,
    markets: ["US", "GB", "MX"],
  },
  {
    name: "Aureline",
    vertical: "beauty",
    short: "Aureline",
    homonym: null,
    size: 0.8,
    markets: ["FR", "DE", "IT"],
  },
  {
    name: "Mossrose",
    vertical: "beauty",
    short: "Mossrose",
    homonym: H("flower", "mossrose in the garden", "moss rose planting tips", "mossrose cottage"),
    size: 0.5,
    markets: ["GB", "DE", "US"],
  },
  {
    name: "Lumiere Lab",
    vertical: "beauty",
    short: "Lumiere",
    homonym: H(
      "cinema pioneers",
      "the lumiere brothers film",
      "lumiere festival lights",
      "lumiere hotel",
    ),
    size: 0.6,
    markets: ["FR", "CA", "IT"],
  },
  {
    name: "Dewmark",
    vertical: "beauty",
    short: "Dewmark",
    homonym: null,
    size: 0.3,
    markets: ["IN", "US"],
  },
  // EV
  {
    name: "Voltara",
    vertical: "ev",
    short: "Voltara",
    homonym: null,
    size: 2.8,
    markets: ["US", "DE", "GB", "CA", "AU"],
  },
  {
    name: "Tessera Motors",
    vertical: "ev",
    short: "Tessera",
    homonym: H(
      "mosaic tile",
      "a mosaic tessera fell out",
      "tessera tiles",
      "tessera of roman glass",
    ),
    size: 1.7,
    markets: ["US", "DE", "FR", "IT"],
  },
  {
    name: "Rivenar",
    vertical: "ev",
    short: "Rivenar",
    homonym: null,
    size: 1.2,
    markets: ["US", "CA", "GB"],
  },
  {
    name: "Ampere Drive",
    vertical: "ev",
    short: "Ampere",
    homonym: H(
      "unit of current",
      "ampere rating of the fuse",
      "10 ampere circuit",
      "ampere hour capacity",
    ),
    size: 0.9,
    markets: ["DE", "FR", "GB", "ES"],
  },
  {
    name: "Nordcell",
    vertical: "ev",
    short: "Nordcell",
    homonym: null,
    size: 0.6,
    markets: ["DE", "GB", "CA"],
  },
  {
    name: "Zenith EV",
    vertical: "ev",
    short: "Zenith",
    homonym: H(
      "highest point",
      "the sun at its zenith",
      "zenith of his career",
      "zenith watch collection",
    ),
    size: 0.4,
    markets: ["US", "IN", "AU"],
  },
];
