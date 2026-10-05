import { AuthorPool, type Author, type AuthorType } from "./authors";
import {
  BRANDS,
  COUNTRIES,
  DAY_MS,
  HOUR_MS,
  SOURCES,
  SOURCE_BY_TYPE,
  VERTICALS,
  type BrandDef,
  type Lang,
  type Source,
  type SourceType,
} from "./config";
import { cascade } from "./hawkes";
import { predictEmotion, predictSentiment, type Sentiment, SENTIMENTS } from "./noise";
import { Rng, rngFor } from "./rng";
import { intensity, planStories, sentimentGauge, type SeededPost, type Story } from "./stories";
import {
  SPAM_KINDS,
  commentText,
  headline,
  mediaAlt,
  postText,
  repostText,
  spamText,
} from "./text";

export interface MentionRow {
  id: number;
  sourceId: number;
  authorId: number;
  brandId: number | null;
  parentId: number | null;
  contentType: string;
  title: string | null;
  text: string;
  lang: Lang;
  country: string;
  region: string;
  city: string;
  publishedAt: number;
  url: string;
  hasMedia: boolean;
  mediaAlt: string | null;
  detectedLogos: string[];
  likes: number;
  shares: number;
  comments: number;
  views: number;
  reachEst: number;
  sentimentTrue: Sentiment;
  sentimentPred: Sentiment;
  sentimentConf: number;
  emotionPred: string;
  topics: string[];
  entities: string[];
  isSpam: boolean;
  isSarcastic: boolean;
  storyId: number | null;
  crisisId: number | null;
}

export interface Brand extends BrandDef {
  id: number; // 1-based
  slug: string;
}

export const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "");
export const WORLD_BRANDS: Brand[] = BRANDS.map((b, i) => ({
  ...b,
  id: i + 1,
  slug: slugify(b.name),
}));

export interface GenOptions {
  seed: number;
  pool: AuthorPool;
  startMs: number;
  endMs: number;
  /** Multiplies baseline volume. 1.4 yields ~4M mentions over the full 30-month window. */
  volumeScale: number;
}

const BASE_ROOTS_PER_SIZE = 12; // baseline root posts/day for a brand of size 1.0
const SPAM_RATE = 0.3; // spam posts per baseline root
const HOMONYM_RATE = 0.4; // off-topic homonym posts per baseline root
const DIURNAL = [
  0.3, 0.2, 0.15, 0.12, 0.12, 0.2, 0.5, 0.9, 1.2, 1.3, 1.35, 1.4, 1.5, 1.4, 1.35, 1.4, 1.5, 1.6,
  1.7, 1.8, 1.7, 1.4, 1, 0.6,
];
const COUNTRY = Object.fromEntries(COUNTRIES.map((c) => [c.code, c]));
const SOURCE_WEIGHTS = SOURCES.map((s) => s.share);
const MEDIA_P: Record<SourceType, number> = {
  x: 0.2,
  instagram: 0.9,
  tiktok: 1,
  facebook: 0.35,
  youtube: 1,
  reddit: 0.12,
  news: 0.5,
  blog: 0.4,
  forum: 0.05,
  review: 0.1,
};
const SPAM_SOURCES = [
  "x",
  "instagram",
  "facebook",
  "forum",
  "review",
  "reddit",
  "tiktok",
] as SourceType[];

interface BrandState {
  brand: Brand;
  idx: number;
  counter: number;
  peers: Brand[];
  stories: Story[];
  base: { pos: number; neg: number; mixed: number };
  marketWeights: number[];
  trendSlope: number;
}

export function planAll(opts: GenOptions, brands: Brand[]): Map<number, Story[]> {
  const out = new Map<number, Story[]>();
  for (const b of brands)
    out.set(b.id, planStories(opts.seed, b.id - 1, b, opts.startMs, opts.endMs));
  return out;
}

function sentimentFrom(rng: Rng, dist: { pos: number; neg: number; mixed: number }): Sentiment {
  const r = rng.float();
  if (r < dist.pos) return "positive";
  if (r < dist.pos + dist.neg) return "negative";
  if (r < dist.pos + dist.neg + dist.mixed) return "mixed";
  return "neutral";
}

/** Blend a story's target sentiment into the base distribution. */
function storyDist(base: BrandState["base"], s: Story, t: number) {
  if (!s.sentTarget) return base;
  const k = sentimentGauge(s, t);
  const target = s.sentTarget;
  const rest = (v: number, own: number) => v * ((1 - (own + (target.share - own) * k)) / (1 - own));
  if (target.sentiment === "negative") {
    const neg = base.neg + (target.share - base.neg) * k;
    return { neg, pos: rest(base.pos, base.neg), mixed: rest(base.mixed, base.neg) };
  }
  const pos = base.pos + (target.share - base.pos) * k;
  return { pos, neg: rest(base.neg, base.pos), mixed: rest(base.mixed, base.pos) };
}

export function generateBrand(
  opts: GenOptions,
  brand: Brand,
  allStories: Map<number, Story[]>,
  emit: (m: MentionRow) => void,
): void {
  const { pool } = opts;
  const idx = brand.id - 1;
  const seedRng = rngFor(opts.seed, "brand", idx);
  const quality = seedRng.range(-0.08, 0.08);
  const st: BrandState = {
    brand,
    idx,
    counter: 0,
    peers: WORLD_BRANDS.filter((b) => b.vertical === brand.vertical && b.id !== brand.id),
    stories: allStories.get(brand.id)!,
    base: { pos: 0.3 + quality, neg: 0.17 - quality, mixed: 0.05 },
    marketWeights: brand.markets.map((c) => COUNTRY[c]!.weight),
    trendSlope: seedRng.range(-0.15, 0.15),
  };
  const vertical = VERTICALS[brand.vertical];
  const peerStories = st.peers.flatMap((p) =>
    allStories.get(p.id)!.filter((s) => s.type === "crisis"),
  );

  const newId = () => brand.id * 10_000_000 + ++st.counter;

  function makeRow(
    rng: Rng,
    o: {
      t: number;
      author: Author;
      contentType: string;
      text: string;
      title?: string | null;
      sentiment: Sentiment;
      sarcastic?: boolean;
      spam?: boolean;
      relevant?: boolean;
      story?: Story | null;
      parentId?: number | null;
      hasMedia?: boolean;
      logos?: string[];
      entities?: string[];
      topics?: string[];
      engagementScale?: number;
    },
  ): MentionRow {
    const a = o.author;
    const src = SOURCE_BY_TYPE[a.sourceType];
    const country = COUNTRY[a.country]!;
    const { pred, conf } = predictSentiment(rng, o.sentiment, {
      lang: a.language,
      sarcastic: !!o.sarcastic,
      spam: !!o.spam,
    });
    const eng = (o.engagementScale ?? 1) * Math.pow(a.followers + 10, 0.6) * rng.lognormal(0, 0.9);
    const likes = Math.round(eng * 0.05 * (o.spam ? 0.05 : 1));
    const views = Math.round(
      (a.followers * rng.range(0.03, 0.4) + eng * 3) * src.reachMultiplier * (o.spam ? 0.1 : 1),
    );
    return {
      id: newId(),
      sourceId: a.sourceId,
      authorId: a.id,
      brandId: o.relevant === false ? null : brand.id,
      parentId: o.parentId ?? null,
      contentType: o.contentType,
      title: o.title ?? null,
      text: o.text,
      lang: a.language,
      country: a.country,
      region: a.country,
      city: rng.pick(country.cities),
      publishedAt: o.t,
      url: `https://${a.sourceType}-sim.ripplewise.test/@${a.handle}/${st.counter}`,
      hasMedia: !!o.hasMedia,
      mediaAlt: o.hasMedia ? mediaAlt(rng, brand.name, brand.vertical, !!o.logos?.length) : null,
      detectedLogos: o.logos ?? [],
      likes,
      shares: 0,
      comments: 0,
      views,
      reachEst: Math.round(views + likes * 12),
      sentimentTrue: o.sentiment,
      sentimentPred: pred,
      sentimentConf: Math.round(conf * 100) / 100,
      emotionPred: predictEmotion(rng, pred),
      topics: o.topics ?? [],
      entities: o.relevant === false ? [] : (o.entities ?? [brand.slug]),
      isSpam: !!o.spam,
      isSarcastic: !!o.sarcastic,
      storyId: o.story?.id ?? null,
      crisisId: o.story?.type === "crisis" ? o.story.id : null,
    };
  }

  function pickMarket(rng: Rng): string {
    return brand.markets[rng.weighted(st.marketWeights)]!;
  }

  function timeInDay(rng: Rng, dayStart: number, country: string): number {
    const local = rng.weighted(DIURNAL);
    const utcHour = (((local - COUNTRY[country]!.tz) % 24) + 24) % 24;
    return dayStart + Math.floor(utcHour * HOUR_MS) + Math.floor(rng.float() * HOUR_MS);
  }

  /** A legitimate root post (plus its cascade). */
  function emitRoot(
    rng: Rng,
    o: {
      t: number;
      sentiment: Sentiment;
      story: Story | null;
      source?: SourceType;
      authorType?: AuthorType;
      country?: string;
      seed?: SeededPost;
      author?: Author;
    },
  ) {
    const country = o.country ?? pickMarket(rng);
    const sourceType = o.source ?? SOURCES[rng.weighted(SOURCE_WEIGHTS)]!.type;
    const authorType: AuthorType =
      o.authorType ??
      (sourceType === "news"
        ? "journalist"
        : rng.bool(0.04)
          ? "influencer"
          : rng.bool(0.012)
            ? "brand"
            : "consumer");
    const author = o.author ?? pool.pick(rng, sourceType, authorType, country);
    const src = SOURCE_BY_TYPE[author.sourceType];
    const topics = [rng.pick(vertical.topics)];
    if (rng.bool(0.3)) topics.push(rng.pick(vertical.topics));
    const isNews = src.type === "news";
    const competitor =
      st.peers.length && rng.bool(o.story?.type === "crisis" ? 0.3 : 0.1)
        ? rng.pick(st.peers)
        : undefined;
    const sarcastic = o.sentiment === "negative" && !isNews && rng.bool(0.22);

    const hasMedia = rng.bool(MEDIA_P[author.sourceType]);
    const withLogo = hasMedia && rng.bool(0.35);
    const logoOnly = withLogo && rng.bool(0.4);
    let text: string;
    let title: string | null = null;
    if (isNews) {
      const kind =
        o.story?.type === "crisis"
          ? "crisis"
          : o.story?.type === "launch"
            ? "launch"
            : o.story?.type === "campaign"
              ? "campaign"
              : "news";
      const h = headline(rng, brand.name, kind, rng.pick(vertical.nouns));
      title = h.title;
      text = h.text;
    } else {
      text = postText({
        rng,
        lang: author.language,
        brand: brand.name,
        short: brand.short,
        handle: brand.slug,
        topic: topics[0]!,
        sentiment: o.sentiment,
        sarcastic,
        mentionBrand: !logoOnly,
        competitor: competitor?.name,
      });
    }
    const entities = [brand.slug, ...(competitor ? [competitor.slug] : [])];
    const root = makeRow(rng, {
      t: o.t,
      author,
      contentType: isNews ? "article" : SOURCE_BY_TYPE[author.sourceType].contentTypes[0]!,
      text,
      title,
      sentiment: o.sentiment,
      sarcastic,
      story: o.story,
      hasMedia,
      logos: withLogo ? [brand.slug] : [],
      entities,
      topics,
      engagementScale: o.seed ? o.seed.boost : 1,
    });
    // Hawkes cascade of reposts / comments.
    const boost = (o.story && !o.story.crowdless ? 1.3 : 1) * (o.seed?.boost ?? 1);
    const nodes = cascade(rng, author.followers, boost);
    const rows: MentionRow[] = [root];
    const rowOfNode: (MentionRow | null)[] = [root];
    for (let i = 1; i < nodes.length; i++) {
      const n = nodes[i]!;
      const parent = rowOfNode[n.parent];
      const t = o.t + n.delayMs;
      if (!parent || t >= opts.endMs) {
        rowOfNode.push(null);
        continue;
      }
      const cAuthor = pool.pick(
        rng,
        author.sourceType === "news" ? "x" : author.sourceType,
        rng.bool(0.05) ? "influencer" : "consumer",
        rng.bool(0.5) ? author.country : pickMarket(rng),
      );
      const sentiment: Sentiment = rng.bool(0.65)
        ? parent.sentimentTrue
        : sentimentFrom(rng, o.story ? storyDist(st.base, o.story, t) : st.base);
      const mention = rng.bool(0.5);
      const text =
        n.kind === "repost"
          ? repostText(pool.authors[parent.authorId - 1]!.handle, parent.text)
          : commentText(rng, parent.sentimentTrue, sentiment, brand.name, mention);
      const row = makeRow(rng, {
        t,
        author: cAuthor,
        contentType: n.kind,
        text,
        sentiment,
        story: o.story,
        parentId: parent.id,
        entities,
        topics,
        engagementScale: 0.15,
      });
      if (n.kind === "repost") parent.shares++;
      else parent.comments++;
      rows.push(row);
      rowOfNode.push(row);
    }
    // Ambient (non-cascaded) engagement keeps root counts realistic.
    root.shares += Math.round(root.likes * 0.04);
    root.comments += Math.round(root.likes * 0.02);
    for (const r of rows) emit(r);
  }

  function emitSpam(rng: Rng, t: number, country: string) {
    const source = rng.pick(SPAM_SOURCES);
    const author = pool.pick(rng, source, "bot", country);
    const kind = rng.pick(SPAM_KINDS);
    const text = spamText(rng, kind, brand.name, brand.short, author.language);
    emit(
      makeRow(rng, {
        t,
        author,
        contentType: SOURCE_BY_TYPE[source].contentTypes[0]!,
        text,
        sentiment: rng.bool(0.6) ? "neutral" : "positive",
        spam: true,
        topics: [],
      }),
    );
  }

  function emitHomonym(rng: Rng, t: number, country: string) {
    const h = brand.homonym!;
    const source = rng.pick(["x", "reddit", "blog", "forum", "facebook"] as SourceType[]);
    const author = pool.pick(rng, source, "consumer", country);
    const phrase = rng.pick(h.phrases);
    emit(
      makeRow(rng, {
        t,
        author,
        contentType: SOURCE_BY_TYPE[source].contentTypes[0]!,
        text: rng.bool(0.5)
          ? phrase
          : `${phrase} ${rng.pick(["😊", "lol", "anyone else?", "#mood"])}`,
        sentiment: sentimentFrom(rng, { pos: 0.3, neg: 0.1, mixed: 0.02 }),
        relevant: false,
        topics: [],
      }),
    );
  }

  // Seeded posts (e.g. news that precedes social pickup) can predate a story's crowd start.
  const activeFrom = new Map(
    st.stories.map((s) => [s.id, Math.min(s.startMs, ...s.seeds.map((p) => p.tMs))]),
  );
  const dayCount = Math.ceil((opts.endMs - opts.startMs) / DAY_MS);
  for (let d = 0; d < dayCount; d++) {
    const dayStart = opts.startMs + d * DAY_MS;
    const dow = (new Date(dayStart).getUTCDay() + 6) % 7; // Mon=0
    const rng = rngFor(opts.seed, "day", idx, d);

    // Baseline volume: size × weekday × slow trend × seasonal windows × noise.
    let seasonal = 1;
    for (const s of st.stories)
      if (s.crowdless && dayStart >= s.startMs && dayStart < s.endMs) seasonal *= s.peakMult;
    // A competitor's active crisis lifts share of voice for its peers.
    let peerLift = 1;
    for (const c of peerStories)
      if (dayStart >= c.startMs && dayStart < c.endMs)
        peerLift = Math.max(peerLift, 1 + 0.15 * intensity(c, dayStart + 12 * HOUR_MS));
    const trend = 1 + st.trendSlope * (d / 365);
    const lambdaDay =
      BASE_ROOTS_PER_SIZE *
      brand.size *
      opts.volumeScale *
      vertical.weekday[dow]! *
      trend *
      seasonal *
      peerLift *
      rng.lognormal(0, 0.2);

    const activeStories = st.stories.filter(
      (s) => !s.crowdless && activeFrom.get(s.id)! < dayStart + DAY_MS && s.endMs > dayStart,
    );

    const n = rng.poisson(lambdaDay);
    const peerPos = peerLift > 1 ? { ...st.base, pos: st.base.pos + 0.04 } : st.base;
    for (let i = 0; i < n; i++) {
      const country = pickMarket(rng);
      emitRoot(rng, {
        t: timeInDay(rng, dayStart, country),
        sentiment: sentimentFrom(rng, peerPos),
        story: null,
        country,
      });
    }
    for (let i = rng.poisson(lambdaDay * SPAM_RATE); i > 0; i--) {
      const country = pickMarket(rng);
      emitSpam(rng, timeInDay(rng, dayStart, country), country);
    }
    if (brand.homonym) {
      for (let i = rng.poisson(lambdaDay * HOMONYM_RATE); i > 0; i--) {
        const country = pickMarket(rng);
        emitHomonym(rng, timeInDay(rng, dayStart, country), country);
      }
    }

    // Story crowd: hourly intensity, plus any seeded high-reach posts landing today.
    for (const s of activeStories) {
      const peakPerHour = ((s.peakMult - 1) * lambdaDay) / 24 / 0.75; // ~0.75 = cascade multiplier (≈1.35) offset by intra-day decay
      for (let h = 0; h < 24; h++) {
        const t = dayStart + h * HOUR_MS;
        const lam = intensity(s, t + HOUR_MS / 2) * peakPerHour;
        for (let k = rng.poisson(lam); k > 0; k--) {
          const tt = t + Math.floor(rng.float() * HOUR_MS);
          const infl = (s.type === "launch" || s.type === "campaign") && rng.bool(0.1);
          emitRoot(rng, {
            t: tt,
            sentiment: sentimentFrom(rng, storyDist(st.base, s, tt)),
            story: s,
            authorType: infl ? "influencer" : undefined,
          });
        }
      }
      for (const p of s.seeds) {
        if (p.tMs < dayStart || p.tMs >= dayStart + DAY_MS) continue;
        const country = pickMarket(rng);
        if (p.kind === "news") {
          emitRoot(rng, {
            t: p.tMs,
            sentiment: p.sentiment,
            story: s,
            source: "news",
            authorType: "journalist",
            country,
            seed: p,
          });
        } else if (p.kind === "influencer") {
          const src = rng.pick(["x", "tiktok", "instagram", "youtube"] as SourceType[]);
          emitRoot(rng, {
            t: p.tMs,
            sentiment: p.sentiment,
            story: s,
            source: src,
            authorType: "influencer",
            country,
            seed: p,
          });
        } else {
          const author = pool.pickMidReach(rng, country);
          emitRoot(rng, { t: p.tMs, sentiment: p.sentiment, story: s, author, country, seed: p });
        }
      }
    }
  }
}

export { SENTIMENTS };
export type { Source };
