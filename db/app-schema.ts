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
  /** trialing | grace | locked | active | past_due | canceled. Locked and canceled accounts are read-only. */
  billingStatus: text("billing_status").notNull().default("trialing"),
  currentPeriodStart: ts("current_period_start"),
  currentPeriodEnd: ts("current_period_end"),
  /** The customer cancelled; access continues until the period ends. */
  cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
  canceledAt: ts("canceled_at"),
  cancelReason: text("cancel_reason"),
  /** A downgrade (or switch to monthly) that takes effect at the next renewal. */
  pendingTier: text("pending_tier"),
  pendingInterval: text("pending_interval"),
  /** Save-offer discount: percent off the next N renewals. */
  discountPct: integer("discount_pct").notNull().default(0),
  discountCyclesLeft: integer("discount_cycles_left").notNull().default(0),
  /** Set when the save offer is first shown, so it is never offered twice. */
  saveOfferShownAt: ts("save_offer_shown_at"),
  dunningAttempts: integer("dunning_attempts").notNull().default(0),
  nextRetryAt: ts("next_retry_at"),
  /** Which lifecycle emails have gone out (reminder3d, reminder1d, ended, locked...). */
  lifecycle: jsonb("lifecycle").notNull().default({}),
  createdAt: ts("created_at").notNull().defaultNow(),
});

/** Cards on file. Only what a receipt shows is kept; the card number itself is never stored. */
export const paymentMethods = pgTable(
  "payment_methods",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    brand: text("brand").notNull(),
    last4: text("last4").notNull(),
    expMonth: integer("exp_month").notNull(),
    expYear: integer("exp_year").notNull(),
    holderName: text("holder_name").notNull().default(""),
    /** How the (simulated) provider treats charges: ok | fail_renewal. */
    behavior: text("behavior").notNull().default("ok"),
    isDefault: boolean("is_default").notNull().default(true),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("payment_methods_account_idx").on(t.accountId)],
);

export const invoices = pgTable(
  "invoices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    seq: bigserial("seq", { mode: "number" }).notNull(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    /** subscription | upgrade | renewal | retry */
    kind: text("kind").notNull(),
    description: text("description").notNull(),
    amountCents: integer("amount_cents").notNull(),
    discountCents: integer("discount_cents").notNull().default(0),
    status: text("status").notNull(), // paid | failed
    failureReason: text("failure_reason"),
    periodStart: ts("period_start"),
    periodEnd: ts("period_end"),
    paymentMethodId: uuid("payment_method_id").references(() => paymentMethods.id, {
      onDelete: "set null",
    }),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("invoices_account_idx").on(t.accountId, t.createdAt)],
);

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
    /** Sessions issued before this moment are signed out (set on password change). */
    passwordChangedAt: ts("password_changed_at"),
    /** Set when the account was created through a simulated identity provider; only that provider may sign it in. */
    oauthProvider: text("oauth_provider"),
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
    /** First click on a tracked link in the body. */
    clickedAt: ts("clicked_at"),
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

/** A workspace's alert rule, evaluated by the release job whenever new mentions land for its query. */
export const alertRules = pgTable(
  "alert_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    queryId: uuid("query_id")
      .notNull()
      .references(() => queries.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** volume_spike | sentiment_drop | influencer */
    type: text("type").notNull(),
    /** Thresholds; shape depends on `type` (validated in lib/alerts/rules.ts). */
    params: jsonb("params").notNull().default({}),
    /** in_app, email */
    channels: text("channels")
      .array()
      .notNull()
      .default(sql`'{in_app}'`),
    /** Minimum minutes between two firings of the same rule. */
    cooldownMin: integer("cooldown_min").notNull().default(60),
    status: text("status").notNull().default("active"), // active|muted
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("alert_rules_workspace_idx").on(t.workspaceId),
    index("alert_rules_query_idx").on(t.queryId),
  ],
);

/** One firing of a rule. Doubles as the in-app notification (status new -> opened -> acknowledged). */
export const alertEvents = pgTable(
  "alert_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ruleId: uuid("rule_id")
      .notNull()
      .references(() => alertRules.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    /** Simulated time of the data window's end (when the condition was observed). */
    firedAt: ts("fired_at").notNull(),
    severity: text("severity").notNull(), // info|warning|critical
    summary: text("summary").notNull(),
    /** Window stats: counts, baseline, negative share, ... (rendered on the alert page). */
    details: jsonb("details").notNull().default({}),
    status: text("status").notNull().default("new"), // new|opened|acknowledged
    openedAt: ts("opened_at"),
    acknowledgedAt: ts("acknowledged_at"),
    acknowledgedBy: uuid("acknowledged_by").references(() => users.id),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("alert_events_workspace_idx").on(t.workspaceId, t.firedAt),
    index("alert_events_rule_idx").on(t.ruleId, t.firedAt),
  ],
);

/** A crisis room: a shared workspace for coordinating a response to a spike. */
export const crises = pgTable(
  "crises",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    queryId: uuid("query_id")
      .notNull()
      .references(() => queries.id, { onDelete: "cascade" }),
    alertEventId: uuid("alert_event_id").references(() => alertEvents.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    status: text("status").notNull().default("open"), // open|resolved
    /** The window the room analyses: starts a little before the spike, open-ended while the room is open. */
    windowStart: ts("window_start").notNull(),
    openedAt: ts("opened_at").notNull().defaultNow(),
    openedBy: uuid("opened_by").references(() => users.id),
    resolvedAt: ts("resolved_at"),
    resolvedBy: uuid("resolved_by").references(() => users.id),
  },
  (t) => [index("crises_workspace_idx").on(t.workspaceId, t.openedAt)],
);

export const crisisTasks = pgTable(
  "crisis_tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    crisisId: uuid("crisis_id")
      .notNull()
      .references(() => crises.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    assigneeId: uuid("assignee_id").references(() => users.id),
    doneAt: ts("done_at"),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("crisis_tasks_idx").on(t.crisisId)],
);

/** Stakeholder updates sent from a crisis room (the emails themselves live in `emails`). */
export const crisisUpdates = pgTable(
  "crisis_updates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    crisisId: uuid("crisis_id")
      .notNull()
      .references(() => crises.id, { onDelete: "cascade" }),
    subject: text("subject").notNull(),
    body: text("body").notNull(),
    recipientsCount: integer("recipients_count").notNull(),
    sentBy: uuid("sent_by").references(() => users.id),
    sentAt: ts("sent_at").notNull().defaultNow(),
  },
  (t) => [index("crisis_updates_idx").on(t.crisisId, t.sentAt)],
);

/** A report: an ordered list of sections (each a dashboard-style widget) over one date range. */
export const reports = pgTable(
  "reports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    templateId: text("template_id"),
    /** Preset date range: 7d | 30d | 90d ... */
    range: text("range").notNull().default("30d"),
    /** [{ id, type, title, config }] */
    sections: jsonb("sections").notNull().default([]),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [index("reports_workspace_idx").on(t.workspaceId)],
);

/** At most one recurring schedule per report. */
export const reportSchedules = pgTable(
  "report_schedules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    reportId: uuid("report_id")
      .notNull()
      .unique()
      .references(() => reports.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    frequency: text("frequency").notNull(), // daily|weekly|monthly
    weekday: integer("weekday").notNull().default(1), // 0=Sun..6=Sat (weekly)
    dayOfMonth: integer("day_of_month").notNull().default(1), // 1..28 (monthly)
    hourUtc: integer("hour_utc").notNull().default(8),
    recipientIds: uuid("recipient_ids")
      .array()
      .notNull()
      .default(sql`'{}'`),
    externalEmails: text("external_emails")
      .array()
      .notNull()
      .default(sql`'{}'`),
    active: boolean("active").notNull().default(true),
    nextRunAt: ts("next_run_at").notNull(),
    lastRunAt: ts("last_run_at"),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("report_schedules_due_idx").on(t.active, t.nextRunAt)],
);

/** One emailed copy of a report to one person; opens and clicks land here. */
export const reportDeliveries = pgTable(
  "report_deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    reportId: uuid("report_id")
      .notNull()
      .references(() => reports.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    scheduleId: uuid("schedule_id").references(() => reportSchedules.id, { onDelete: "set null" }),
    emailId: uuid("email_id").references(() => emails.id, { onDelete: "set null" }),
    userId: uuid("user_id").references(() => users.id),
    /** schedule | manual (a "send me a copy now") */
    trigger: text("trigger").notNull().default("schedule"),
    deliveredAt: ts("delivered_at").notNull().defaultNow(),
    openedAt: ts("opened_at"),
    clickedAt: ts("clicked_at"),
  },
  (t) => [index("report_deliveries_report_idx").on(t.reportId, t.deliveredAt)],
);

/** Every file a person downloaded from Exports or a report (the Exports page history). */
export const exportsLog = pgTable(
  "exports_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => users.id),
    kind: text("kind").notNull(), // mentions|report
    format: text("format").notNull(), // csv|pdf
    label: text("label").notNull(),
    rowCount: integer("row_count"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("exports_log_workspace_idx").on(t.workspaceId, t.createdAt)],
);

/** Who did what, when. Written for team, workspace, billing, sharing and branding changes. */
export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    seq: bigserial("seq", { mode: "number" }).notNull(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id").references(() => workspaces.id, { onDelete: "set null" }),
    /** Null for system actions (the billing clock, an expired invite). */
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    /** Dotted verb, e.g. member.invited, member.role_changed, plan.upgraded. */
    action: text("action").notNull(),
    targetType: text("target_type"),
    targetId: text("target_id"),
    /** Human-readable context (names and roles, never secrets). */
    meta: jsonb("meta").notNull().default({}),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("audit_log_account_idx").on(t.accountId, t.seq)],
);

/** White-label settings for what clients see (share pages, report PDFs, the client viewer's top bar). */
export const workspaceBranding = pgTable("workspace_branding", {
  workspaceId: uuid("workspace_id")
    .primaryKey()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  displayName: text("display_name").notNull().default(""),
  /** Hex colour, e.g. #1f6feb. Validated for contrast against white text. */
  accent: text("accent").notNull().default(""),
  footerText: text("footer_text").notNull().default(""),
  hidePoweredBy: boolean("hide_powered_by").notNull().default(false),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

/** Everything the AI features produced for a workspace: answers to questions, summaries, peak explanations. */
export const aiAnswers = pgTable(
  "ai_answers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => users.id),
    kind: text("kind").notNull(), // ask|summary|peak
    prompt: text("prompt").notNull(),
    answer: text("answer").notNull(),
    /** [{ n, mentionId, excerpt, author, source, publishedAt }] — the evidence the answer rests on. */
    citations: jsonb("citations").notNull().default([]),
    provider: text("provider").notNull(),
    latencyMs: integer("latency_ms").notNull().default(0),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("ai_answers_ws_idx").on(t.workspaceId, t.kind, t.createdAt)],
);

/** A request to talk to sales: a contact message or a demo booking. Anonymous visitors can send one. */
export const salesRequests = pgTable(
  "sales_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id").references(() => accounts.id, { onDelete: "set null" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    email: text("email").notNull(),
    company: text("company").notNull(),
    kind: text("kind").notNull(), // contact|demo
    seats: integer("seats").notNull(),
    message: text("message").notNull().default(""),
    entryPoint: text("entry_point").notNull(),
    demoAt: ts("demo_at"),
    status: text("status").notNull().default("new"), // new|demo_booked|quoted
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("sales_requests_status_idx").on(t.status, t.createdAt)],
);

/** A priced proposal. The token in the emailed link is the only way in (it is stored hashed). */
export const quotes = pgTable(
  "quotes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    requestId: uuid("request_id")
      .notNull()
      .references(() => salesRequests.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    seats: integer("seats").notNull(),
    termMonths: integer("term_months").notNull(),
    /** Total value over the whole term, in cents. */
    valueCents: bigint("value_cents", { mode: "number" }).notNull(),
    status: text("status").notNull().default("sent"), // sent|viewed|accepted|signed|expired
    expiresAt: ts("expires_at").notNull(),
    viewedAt: ts("viewed_at"),
    acceptedAt: ts("accepted_at"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("quotes_request_idx").on(t.requestId)],
);

export const contracts = pgTable("contracts", {
  id: uuid("id").primaryKey().defaultRandom(),
  quoteId: uuid("quote_id")
    .notNull()
    .unique()
    .references(() => quotes.id),
  accountId: uuid("account_id")
    .notNull()
    .references(() => accounts.id),
  signedBy: uuid("signed_by")
    .notNull()
    .references(() => users.id),
  signatureName: text("signature_name").notNull(),
  seats: integer("seats").notNull(),
  termMonths: integer("term_months").notNull(),
  valueCents: bigint("value_cents", { mode: "number" }).notNull(),
  startsAt: ts("starts_at").notNull(),
  endsAt: ts("ends_at").notNull(),
  signedAt: ts("signed_at").notNull().defaultNow(),
});

/** One row per account per day from the nightly scoring job: the warehouse's account-health time series. */
export const accountScores = pgTable(
  "account_scores",
  {
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    day: text("day").notNull(), // YYYY-MM-DD (sim clock, UTC)
    pqa: integer("pqa").notNull(),
    health: integer("health").notNull(),
    healthBand: text("health_band").notNull(), // healthy|watch|at_risk
    signals: jsonb("signals").notNull().default({}),
    computedAt: ts("computed_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.accountId, t.day] })],
);

/** Authors a workspace has chosen to keep an eye on. */
export const authorWatchlist = pgTable(
  "author_watchlist",
  {
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    authorId: integer("author_id").notNull(),
    addedBy: uuid("added_by").references(() => users.id),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.authorId] })],
);

/** A named shortlist of creators in a workspace (Influencers product). */
export const creatorLists = pgTable(
  "creator_lists",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("creator_lists_ws_idx").on(t.workspaceId)],
);

export const creatorListItems = pgTable(
  "creator_list_items",
  {
    listId: uuid("list_id")
      .notNull()
      .references(() => creatorLists.id, { onDelete: "cascade" }),
    creatorId: integer("creator_id").notNull(),
    note: text("note").notNull().default(""),
    addedBy: uuid("added_by").references(() => users.id),
    addedAt: ts("added_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.listId, t.creatorId] })],
);

/** One row per account, creator and month: opening the same profile again doesn't use more of the monthly allowance. */
export const creatorProfileViews = pgTable(
  "creator_profile_views",
  {
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    creatorId: integer("creator_id").notNull(),
    period: text("period").notNull(), // YYYY-MM
    firstViewedAt: ts("first_viewed_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.accountId, t.creatorId, t.period] })],
);

/** Failed password logins per (hashed) email, for throttling guessing. Unknown emails are tracked too, so locking never reveals who has an account. */
export const loginThrottle = pgTable("login_throttle", {
  keyHash: text("key_hash").primaryKey(),
  failures: integer("failures").notNull().default(0),
  windowStart: ts("window_start").notNull(),
  lockedUntil: ts("locked_until"),
});
