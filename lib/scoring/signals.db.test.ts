import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { runNightlyScoring } from "@/jobs/pqa";
import {
  accountScores,
  accounts,
  campaigns,
  creatorLists,
  db,
  pool,
  queries,
  usageCounters,
  workspaces,
} from "@/db/client";
import { periodOf } from "@/lib/usage";
import { gatherSignals } from "./signals";

afterAll(() => pool.end());

async function account() {
  const [a] = await db
    .insert(accounts)
    .values({ name: "sig", planTier: "growth", billingStatus: "active" })
    .returning();
  const [w] = await db
    .insert(workspaces)
    .values({
      accountId: a!.id,
      name: "sig",
      slug: `sig-${Math.random().toString(36).slice(2, 9)}`,
    })
    .returning();
  return { a: a!, w: w! };
}

describe("account signals across products", () => {
  it("sees which products an account actually uses, and how deep the Influencers use goes", async () => {
    const { a, w } = await account();
    const now = new Date();
    expect((await gatherSignals(a.id, now))!.productsUsed).toEqual([]);

    await db.insert(creatorLists).values({ workspaceId: w.id, name: "Shortlist" });
    let s = (await gatherSignals(a.id, now))!;
    expect(s.productsUsed).toEqual(["influencers"]);
    expect(s.creatorLists).toBe(1);

    await db
      .insert(queries)
      .values({ workspaceId: w.id, name: "q", booleanText: "x", status: "live" });
    s = (await gatherSignals(a.id, now))!;
    expect(s.productsUsed).toEqual(["listening", "influencers"]);

    // Draft and running campaigns count; completed ones don't.
    await db.insert(campaigns).values([
      { workspaceId: w.id, name: "c1", status: "active" },
      { workspaceId: w.id, name: "c2", status: "draft" },
      { workspaceId: w.id, name: "c3", status: "completed" },
    ]);
    // 160 of Growth's 200 monthly invitations.
    await db
      .insert(usageCounters)
      .values({ accountId: a.id, period: periodOf(), metric: "creator_invites", value: 160 });
    s = (await gatherSignals(a.id, now))!;
    expect(s.activeCampaigns).toBe(2);
    expect(s.invitationsPct).toBe(80);
  });

  it("the nightly score keeps the product mix and says why in plain words", async () => {
    const { a, w } = await account();
    await db.insert(creatorLists).values({ workspaceId: w.id, name: "Shortlist" });
    await db
      .insert(queries)
      .values({ workspaceId: w.id, name: "q", booleanText: "x", status: "live" });
    const [r] = await runNightlyScoring(new Date(), [a.id]);
    expect(r!.accountId).toBe(a.id);
    const [row] = await db.select().from(accountScores).where(eq(accountScores.accountId, a.id));
    const sig = row!.signals as {
      productsUsed: string[];
      pqaReasons: string[];
      healthReasons: string[];
    };
    expect(sig.productsUsed).toEqual(["listening", "influencers"]);
    expect(sig.pqaReasons.join(" ")).toMatch(/uses both products/);
    expect(sig.healthReasons.join(" ")).toMatch(/2 of 5 core features/);
  });
});
