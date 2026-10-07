import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  smallint,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

const tsvector = customType<{ data: string }>({ dataType: () => "tsvector" });

/** Simulated platforms. */
export const sources = pgTable("sources", {
  id: smallint("id").primaryKey(),
  type: text("type").notNull(),
  displayName: text("display_name").notNull(),
  reachMultiplier: real("reach_multiplier").notNull(),
});

/** Fictitious world brands (ground truth, not tenant data). */
export const brands = pgTable("brands", {
  id: smallint("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  shortName: text("short_name").notNull(),
  vertical: text("vertical").notNull(),
  homonymSense: text("homonym_sense"),
  markets: text("markets").array().notNull(),
  aliases: text("aliases")
    .array()
    .notNull()
    .default(sql`'{}'`),
  competitorIds: smallint("competitor_ids")
    .array()
    .notNull()
    .default(sql`'{}'`),
});

export const authors = pgTable("authors", {
  id: integer("id").primaryKey(),
  sourceId: smallint("source_id")
    .notNull()
    .references(() => sources.id),
  handle: text("handle").notNull(),
  displayName: text("display_name").notNull(),
  followers: integer("followers").notNull(),
  following: integer("following").notNull(),
  verified: boolean("verified").notNull(),
  country: text("country").notNull(),
  language: text("language").notNull(),
  authorType: text("author_type").notNull(), // consumer|influencer|journalist|brand|bot
  botScore: real("bot_score").notNull(),
  bio: text("bio").notNull(),
  avatarSeed: integer("avatar_seed").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
});

/** Event clusters: launch|campaign|crisis|news|meme|seasonal. */
export const stories = pgTable("stories", {
  id: bigint("id", { mode: "number" }).primaryKey(),
  type: text("type").notNull(),
  brandId: smallint("brand_id")
    .notNull()
    .references(() => brands.id),
  startAt: timestamp("start_at", { withTimezone: true }).notNull(),
  peakAt: timestamp("peak_at", { withTimezone: true }).notNull(),
  endAt: timestamp("end_at", { withTimezone: true }).notNull(),
  decayHalfLifeHours: real("decay_half_life_hours").notNull(),
  peakMultiple: real("peak_multiple").notNull(),
  keywords: text("keywords").array().notNull(),
  meta: jsonb("meta"),
});

/**
 * The shared synthetic corpus. User edits never mutate it (see mention_overrides).
 * sentiment_true / is_spam / is_sarcastic / brand_id are generator ground truth and must not be
 * exposed through product UI or APIs; sentiment_pred is what the product shows.
 */
export const mentions = pgTable(
  "mentions",
  {
    id: bigint("id", { mode: "number" }).primaryKey(),
    sourceId: smallint("source_id")
      .notNull()
      .references(() => sources.id),
    authorId: integer("author_id")
      .notNull()
      .references(() => authors.id),
    brandId: smallint("brand_id"), // null = off-topic homonym noise
    parentId: bigint("parent_id", { mode: "number" }),
    contentType: text("content_type").notNull(), // post|comment|repost|article|video|review
    title: text("title"),
    text: text("text").notNull(),
    lang: text("lang").notNull(),
    country: text("country").notNull(),
    region: text("region").notNull(),
    city: text("city").notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true }).notNull(),
    url: text("url").notNull(),
    hasMedia: boolean("has_media").notNull(),
    mediaAlt: text("media_alt"),
    detectedLogos: text("detected_logos").array().notNull(),
    likes: integer("likes").notNull(),
    shares: integer("shares").notNull(),
    comments: integer("comments").notNull(),
    views: bigint("views", { mode: "number" }).notNull(),
    reachEst: bigint("reach_est", { mode: "number" }).notNull(),
    sentimentTrue: text("sentiment_true").notNull(),
    sentimentPred: text("sentiment_pred").notNull(),
    sentimentConf: real("sentiment_conf").notNull(),
    emotionPred: text("emotion_pred").notNull(),
    topics: text("topics").array().notNull(),
    entities: text("entities").array().notNull(),
    isSpam: boolean("is_spam").notNull(),
    isSarcastic: boolean("is_sarcastic").notNull(),
    storyId: bigint("story_id", { mode: "number" }),
    crisisId: bigint("crisis_id", { mode: "number" }),
    // 'simple' config: language-agnostic tokenisation (the corpus is multilingual). Logo queries
    // use detected_logos directly, since array_to_string is not immutable.
    tsv: tsvector("tsv").generatedAlwaysAs(
      sql`to_tsvector('simple', coalesce(title, '') || ' ' || text)`,
    ),
  },
  (t) => [
    index("mentions_published_idx").on(t.publishedAt),
    index("mentions_brand_published_idx").on(t.brandId, t.publishedAt),
    index("mentions_tsv_idx").using("gin", t.tsv),
    index("mentions_story_idx").on(t.storyId),
  ],
);

/**
 * The shared synthetic creator directory for the Influencers product (see datagen/creators.ts).
 * Like the mention corpus it is read-only reference data; workspaces only reference it from lists.
 */
export const creators = pgTable(
  "creators",
  {
    id: integer("id").primaryKey(),
    platform: text("platform").notNull(), // instagram|tiktok|youtube|x
    handle: text("handle").notNull(),
    displayName: text("display_name").notNull(),
    bio: text("bio").notNull(),
    niche: text("niche").notNull(),
    tags: text("tags").array().notNull(),
    country: text("country").notNull(),
    language: text("language").notNull(),
    followers: integer("followers").notNull(),
    engagementRate: real("engagement_rate").notNull(),
    avgViews: integer("avg_views").notNull(),
    postsPerWeek: real("posts_per_week").notNull(),
    growth30d: real("growth_30d").notNull(),
    verified: boolean("verified").notNull(),
    sponsoredPct: real("sponsored_pct").notNull(),
    fakeFollowerPct: real("fake_follower_pct").notNull(),
    authenticityScore: smallint("authenticity_score").notNull(),
    brandSafety: text("brand_safety").notNull(), // safe|caution|risk
    ratePerPostUsd: integer("rate_per_post_usd").notNull(),
    avatarSeed: integer("avatar_seed").notNull(),
    audience: jsonb("audience").notNull(),
    tsv: tsvector("tsv").generatedAlwaysAs(
      sql`to_tsvector('simple', display_name || ' ' || handle || ' ' || bio || ' ' || niche)`,
    ),
  },
  (t) => [
    index("creators_followers_idx").on(t.followers),
    index("creators_niche_idx").on(t.niche, t.followers),
    index("creators_platform_idx").on(t.platform, t.followers),
    index("creators_tsv_idx").using("gin", t.tsv),
  ],
);
