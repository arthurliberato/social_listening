import { and, eq } from "drizzle-orm";
import { accounts, db, memberships, users } from "@/db/client";
import { simNow } from "@/lib/simclock";

export interface AnalyticsContext {
  userId?: string | null;
  /** Set when the actor is a creator acting from their invitation page (they have no account). */
  creatorId?: number | null;
  /** Set when no person acted: a settlement, a scheduled job. Such events belong to the system, not to whoever triggered the page. */
  system?: boolean;
  workspaceId?: string | null;
  accountId?: string | null;
}

export interface GlobalProps {
  account_id: string | null;
  workspace_id: string | null;
  plan_tier: string | null;
  trial_day: number | null;
  user_role: string | null;
  persona_archetype: string | null;
  is_synthetic: boolean;
  agent_run_id: string | null;
  app_version: string;
  /** member: a signed-in person; creator: someone on an invitation page; anonymous: neither. */
  actor_type: "member" | "creator" | "anonymous" | "system";
}

const APP_VERSION = process.env.APP_VERSION ?? "0.1.0";

/** Resolve the global event properties (everything except route / ui_theme, which the client knows). */
export async function globalProps(ctx: AnalyticsContext): Promise<{
  props: GlobalProps;
  accountId: string | null;
  workspaceId: string | null;
  agentModel: string | null;
}> {
  let accountId = ctx.accountId ?? null;
  let workspaceId = ctx.workspaceId ?? null;
  let role: string | null = null;
  let user: typeof users.$inferSelect | undefined;
  if (ctx.userId) {
    user = (await db.select().from(users).where(eq(users.id, ctx.userId)).limit(1))[0];
    const where = workspaceId
      ? and(eq(memberships.userId, ctx.userId), eq(memberships.workspaceId, workspaceId))
      : eq(memberships.userId, ctx.userId);
    const m = (await db.select().from(memberships).where(where).limit(1))[0];
    if (m) {
      role = m.role;
      accountId ??= m.accountId;
      workspaceId ??= m.workspaceId;
    }
  }
  let plan: string | null = null;
  let trialDay: number | null = null;
  if (accountId) {
    const a = (await db.select().from(accounts).where(eq(accounts.id, accountId)).limit(1))[0];
    if (a) {
      plan = a.planTier;
      if (a.planTier === "trial" && a.trialStartAt)
        trialDay = Math.max(
          0,
          Math.floor((simNow().getTime() - a.trialStartAt.getTime()) / 86_400_000),
        );
    }
  }
  return {
    props: {
      account_id: accountId,
      workspace_id: workspaceId,
      plan_tier: plan,
      trial_day: trialDay,
      user_role: role,
      persona_archetype: user?.personaArchetype ?? null,
      is_synthetic: user?.isSynthetic ?? true,
      agent_run_id: user?.agentRunId ?? null,
      app_version: APP_VERSION,
      actor_type: ctx.system
        ? "system"
        : ctx.userId
          ? "member"
          : ctx.creatorId
            ? "creator"
            : "anonymous",
    },
    accountId,
    workspaceId,
    agentModel: user?.agentModel ?? null,
  };
}
