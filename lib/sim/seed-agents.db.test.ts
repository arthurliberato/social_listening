import { eq, sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { accounts, db, memberships, pool, users } from "@/db/client";
import { verifyPassword } from "@/lib/auth/password";
import { PLANS } from "@/lib/entitlements/plans";
import { seedAgents } from "./seed-agents";

afterAll(() => pool.end());

describe("seedAgents", () => {
  it("builds paid agent teams through the real sign-up, invite and billing paths", async () => {
    const run = `t${Date.now().toString(36)}`;
    const agents = await seedAgents({ accounts: 2, seed: 7, run, model: "m-test" });

    const byAccount = Map.groupBy(agents, (a) => a.account_id);
    expect(byAccount.size).toBe(2);
    for (const [accountId, team] of byAccount) {
      expect(team.length).toBeGreaterThanOrEqual(8);
      expect(team.length).toBeLessThanOrEqual(9);
      expect(team[0]!.role).toBe("division_leader");
      expect(team[0]!.platform_role).toBe("owner");
      expect(team.filter((a) => a.role === "analyst").length).toBeGreaterThanOrEqual(5);
      const [acct] = await db.select().from(accounts).where(eq(accounts.id, accountId));
      expect(acct!.planTier).toBe("agency");
      expect(acct!.billingStatus).toBe("active");
      const members = await db
        .select({ role: memberships.role })
        .from(memberships)
        .where(eq(memberships.accountId, accountId));
      expect(members).toHaveLength(team.length);
      expect(team.length).toBeLessThanOrEqual(PLANS.agency.seats);
    }

    // Labels land on the user, so every event carries them; credentials in the manifest work.
    const a = agents[3]!;
    const [u] = await db.select().from(users).where(eq(users.email, a.email));
    expect(u!.isSynthetic).toBe(true);
    expect(u!.agentRunId).toBe(run);
    expect(u!.agentModel).toBe("m-test");
    expect(u!.personaArchetype).toBe(a.persona);
    expect(u!.emailVerifiedAt).not.toBeNull();
    expect(await verifyPassword(u!.passwordHash, a.password)).toBe(true);
    const ev = (
      await db.execute(
        sql`SELECT count(*)::int AS n FROM analytics_events WHERE user_id = ${u!.id}::uuid AND props->>'agent_run_id' = ${run}`,
      )
    ).rows[0] as { n: number };
    expect(ev.n).toBeGreaterThan(0);
  }, 120_000);

  it("is repeatable: the same seed gives the same teams and names", async () => {
    const mk = async (run: string) =>
      (await seedAgents({ accounts: 1, seed: 11, run })).map((x) => [x.persona, x.name, x.region]);
    expect(await mk(`a${Date.now().toString(36)}`)).toEqual(
      await mk(`b${Date.now().toString(36)}`),
    );
  }, 120_000);
});
