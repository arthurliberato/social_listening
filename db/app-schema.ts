// Application (tenant) tables. The shared synthetic corpus lives in schema.ts.
import { sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
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
