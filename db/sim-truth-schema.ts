// The sealed ground truth of the simulation: what the synthetic people "really" think and intend, and which effects were
// planted in experiments. Analysis never sees it; it exists so that methods can be checked afterwards (did the survey
// recover the real satisfaction, did the experiment estimate match the planted effect).
//
// It is a separate Postgres schema, and deliberately NOT exported from db/client.ts. Only the simulation (agents/,
// lib/sim/) and the evaluation scripts may import it; lib/sim/sim-truth.guard.test.ts fails if the app, the analytics
// code or the export to BigQuery ever mention it. Nothing here is a draft of product behavior: the constructs are
// the owner's to confirm (see docs/analytics-owner-guide.md).
import { bigint, date, jsonb, pgSchema, primaryKey, real, text, uuid } from "drizzle-orm/pg-core";

export const simTruth = pgSchema("sim_truth");

/** Latent traits of each synthetic user at the start of a run, on 0 to 1 scales unless noted. */
export const agentLatents = simTruth.table("agent_latents", {
  userId: uuid("user_id").primaryKey(),
  run: text("run").notNull(),
  /** Perceived usefulness. */
  pu: real("pu").notNull(),
  /** Perceived ease of use. */
  peou: real("peou").notNull(),
  trust: real("trust").notNull(),
  satisfaction: real("satisfaction").notNull(),
  /** How much friction they put up with before leaving. */
  patience: real("patience").notNull(),
  /** How they use rating scales: acquiescence (agree with everything), extreme and midpoint tendencies. */
  responseStyle: jsonb("response_style").notNull().default({}),
});

/** The same traits as they change over simulated days (after a bad experience, a fix, a price change). */
export const latentHistory = simTruth.table(
  "latent_history",
  {
    userId: uuid("user_id").notNull(),
    simDay: date("sim_day").notNull(),
    construct: text("construct").notNull(),
    value: real("value").notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.simDay, t.construct] })],
);

/** An effect that was built into an experiment on purpose, so the estimate can be compared with the truth. */
export const plantedEffects = simTruth.table("planted_effects", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  flagKey: text("flag_key").notNull(),
  variant: text("variant").notNull(),
  /** What it moves: a latent construct or a behavior rate. */
  outcome: text("outcome").notNull(),
  /** In the outcome's own units (for a latent, points on its 0 to 1 scale). */
  effect: real("effect").notNull(),
  /** account or user: what was randomised. */
  unit: text("unit").notNull(),
  notes: text("notes").notNull().default(""),
});
