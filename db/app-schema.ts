// Application (tenant) tables. The shared synthetic corpus lives in schema.ts.
import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const ts = (name: string) => timestamp(name, { withTimezone: true });

/** Billing entity (Amplitude group "account"). */
export const accounts = pgTable("accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  planTier: text("plan_tier").notNull().default("trial"), // trial|starter|growth|agency|enterprise
  billingInterval: text("billing_interval").notNull().default("monthly"),
  motion: text("motion").notNull().default("self_serve"), // self_serve|sales_assisted
  accountType: text("account_type").notNull().default("brand"), // brand|agency
  companySizeBand: integer("company_size_band"),
  trialStartAt: ts("trial_start_at"),
  trialEndAt: ts("trial_end_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

/** A brand or client (Amplitude group "workspace"). `slug` is the /w/:slug route segment. */
export const workspaces = pgTable("workspaces", {
  id: uuid("id").primaryKey().defaultRandom(),
  accountId: uuid("account_id")
    .notNull()
    .references(() => accounts.id),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  workspaceType: text("workspace_type").notNull().default("own_brand"),
  createdAt: ts("created_at").notNull().defaultNow(),
  archivedAt: ts("archived_at"),
});

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(), // used as the Amplitude/GA4 user id; never the email
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    name: text("name").notNull(),
    emailVerifiedAt: ts("email_verified_at"),
    roleSelected: text("role_selected"), // analyst|social|comms|agency|exec|admin
    goals: text("goals")
      .array()
      .notNull()
      .default(sql`'{}'`),
    onboardingStep: integer("onboarding_step").notNull().default(0),
    onboardingData: jsonb("onboarding_data").notNull().default({}),
    onboardingCompletedAt: ts("onboarding_completed_at"),
    /** Ground-truth labels for synthetic agents (never shown in product UI). */
    isSynthetic: boolean("is_synthetic").notNull().default(true),
    personaArchetype: text("persona_archetype"),
    agentRunId: text("agent_run_id"),
    agentModel: text("agent_model"),
    /** ga_client_id, ga_session_id, utm_*, gclid, referrer captured at sign-up. */
    attribution: jsonb("attribution").notNull().default({}),
    createdAt: ts("created_at").notNull().defaultNow(),
    lastLoginAt: ts("last_login_at"),
  },
  (t) => [uniqueIndex("users_email_idx").on(sql`lower(${t.email})`)],
);

export const memberships = pgTable(
  "memberships",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id),
    role: text("role").notNull(), // owner|admin|editor|viewer|client_viewer
    /** When the user last opened the mentions feed (drives "unread" and "since last visit"). */
    feedSeenAt: ts("feed_seen_at"),
    /** Start of the current visit: mentions published after this are "unread". Stable within a visit. */
    feedSinceAt: ts("feed_since_at"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.workspaceId] })],
);

/** Single-use, hashed tokens (email verification now; magic links, invites later). */
export const authTokens = pgTable("auth_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  type: text("type").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: ts("expires_at").notNull(),
  usedAt: ts("used_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

/** Every outbound email, readable per user at /inbox (and mirrored to Mailpit in dev). */
export const emails = pgTable(
  "emails",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    toUserId: uuid("to_user_id").references(() => users.id),
    toAddress: text("to_address").notNull(),
    type: text("type").notNull(),
    subject: text("subject").notNull(),
    bodyText: text("body_text").notNull(),
    openedAt: ts("opened_at"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("emails_user_idx").on(t.toUserId, t.createdAt)],
);

export const queries = pgTable(
  "queries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    name: text("name").notNull(),
    booleanText: text("boolean_text").notNull(),
    astJson: jsonb("ast_json"),
    sources: text("sources")
      .array()
      .notNull()
      .default(sql`'{}'`),
    languages: text("languages")
      .array()
      .notNull()
      .default(sql`'{}'`),
    countries: text("countries")
      .array()
      .notNull()
      .default(sql`'{}'`),
    status: text("status").notNull().default("draft"), // draft|live|paused
    isFromTemplate: boolean("is_from_template").notNull().default(false),
    builderMode: text("builder_mode").notNull().default("guided"), // guided|advanced
    /** pending|running|done|quota_exhausted|failed */
    backfillStatus: text("backfill_status").notNull().default("pending"),
    backfillMatched: integer("backfill_matched").notNull().default(0),
    backfilledAt: ts("backfilled_at"),
    /** The release job matches mentions published after this instant (set when backfill finishes). */
    releasedThrough: ts("released_through"),
    updatedAt: ts("updated_at").notNull().defaultNow(),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("queries_workspace_idx").on(t.workspaceId)],
);

/** Server-side tee of every analytics event, for account-level SQL and BigQuery loads. */
export const analyticsEvents = pgTable(
  "analytics_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    ts: ts("ts").notNull().defaultNow(),
    name: text("name").notNull(),
    side: text("side").notNull(), // client|server
    userId: uuid("user_id"),
    accountId: uuid("account_id"),
    workspaceId: uuid("workspace_id"),
    deviceId: text("device_id"),
    props: jsonb("props").notNull().default({}),
  },
  (t) => [
    index("analytics_events_name_ts_idx").on(t.name, t.ts),
    index("analytics_events_user_idx").on(t.userId, t.ts),
  ],
);

/** Pending teammate invitations (accepted at sign-up via /signup?invite=<token>). */
export const invitations = pgTable(
  "invitations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id),
    email: text("email").notNull(),
    role: text("role").notNull().default("editor"),
    tokenHash: text("token_hash").notNull().unique(),
    invitedBy: uuid("invited_by")
      .notNull()
      .references(() => users.id),
    source: text("source").notNull().default("settings"), // onboarding|settings
    expiresAt: ts("expires_at").notNull(),
    acceptedAt: ts("accepted_at"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("invitations_workspace_idx").on(t.workspaceId)],
);

/** Mentions matched by a query (materialised on save/backfill and by the release job). */
export const queryMatches = pgTable(
  "query_matches",
  {
    queryId: uuid("query_id")
      .notNull()
      .references(() => queries.id, { onDelete: "cascade" }),
    mentionId: bigint("mention_id", { mode: "number" }).notNull(),
    /** Denormalised so feeds can sort and page without joining the 4M-row corpus first. */
    publishedAt: ts("published_at").notNull(),
    matchedAt: ts("matched_at").notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.queryId, t.mentionId] }),
    index("query_matches_feed_idx").on(t.queryId, t.publishedAt),
  ],
);

/** Per-query daily rollups that dashboards read instead of scanning mentions. */
export const queryDailyStats = pgTable(
  "query_daily_stats",
  {
    queryId: uuid("query_id")
      .notNull()
      .references(() => queries.id, { onDelete: "cascade" }),
    day: date("day").notNull(),
    mentions: integer("mentions").notNull(),
    positive: integer("positive").notNull(),
    negative: integer("negative").notNull(),
    neutral: integer("neutral").notNull(),
    mixed: integer("mixed").notNull(),
    reach: bigint("reach", { mode: "number" }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.queryId, t.day] })],
);

/** Metered usage per account and calendar month (mentions collected, AI questions...). */
export const usageCounters = pgTable(
  "usage_counters",
  {
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id),
    period: text("period").notNull(), // YYYY-MM
    metric: text("metric").notNull(), // mentions|ai_questions
    value: bigint("value", { mode: "number" }).notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.accountId, t.period, t.metric] })],
);

/**
 * A workspace's edits to a mention. User edits never mutate the shared corpus: the effective
 * sentiment is coalesce(override.sentiment, mentions.sentiment_pred).
 */
export const mentionOverrides = pgTable(
  "mention_overrides",
  {
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    mentionId: bigint("mention_id", { mode: "number" }).notNull(),
    sentiment: text("sentiment"), // null = keep the classifier's value
    tags: text("tags")
      .array()
      .notNull()
      .default(sql`'{}'`),
    flagged: boolean("flagged").notNull().default(false),
    updatedBy: uuid("updated_by").references(() => users.id),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.workspaceId, t.mentionId] }),
    index("mention_overrides_flag_idx").on(t.workspaceId, t.flagged),
  ],
);

/** Saved feed filters (shareable "views"). `params` is the URL query string of the feed. */
export const savedViews = pgTable(
  "saved_views",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    params: text("params").notNull(),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("saved_views_workspace_idx").on(t.workspaceId)],
);

/** A workspace dashboard: a 12-column grid of widgets. */
export const dashboards = pgTable(
  "dashboards",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    templateId: text("template_id"),
    createdBy: uuid("created_by").references(() => users.id),
    /** Non-null = a public read-only link is enabled (/share/<token>). */
    publicToken: text("public_token").unique(),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [index("dashboards_workspace_idx").on(t.workspaceId)],
);

export const widgets = pgTable(
  "widgets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    dashboardId: uuid("dashboard_id")
      .notNull()
      .references(() => dashboards.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    title: text("title").notNull(),
    /** Per-type options: scope (query ids), metric, breakdown, topN, chart style... */
    config: jsonb("config").notNull().default({}),
    x: integer("x").notNull(),
    y: integer("y").notNull(),
    w: integer("w").notNull(),
    h: integer("h").notNull(),
  },
  (t) => [index("widgets_dashboard_idx").on(t.dashboardId)],
);

/** Who opened which dashboard (drives "last viewed" and the viewer count). user_id is null for public-link views. */
export const dashboardViews = pgTable(
  "dashboard_views",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    dashboardId: uuid("dashboard_id")
      .notNull()
      .references(() => dashboards.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => users.id),
    viewedAt: ts("viewed_at").notNull().defaultNow(),
  },
  (t) => [index("dashboard_views_idx").on(t.dashboardId, t.viewedAt)],
);
