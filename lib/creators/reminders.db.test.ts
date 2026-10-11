import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import {
  accounts,
  analyticsEvents,
  campaignCreators,
  campaignInvites,
  campaigns,
  db,
  emails,
  pool,
  workspaces,
} from "@/db/client";
import { newToken } from "./outreach-flow";
import { sendInvitationReminders } from "./outreach";

afterAll(() => pool.end());

const DAY = 86_400_000;

async function fixture(daysLeft: number, campaignStatus = "active") {
  const [a] = await db
    .insert(accounts)
    .values({ name: "rem", planTier: "growth", billingStatus: "active" })
    .returning();
  const [w] = await db
    .insert(workspaces)
    .values({
      accountId: a!.id,
      name: "Latte Lane",
      slug: `rem-${Math.random().toString(36).slice(2, 9)}`,
    })
    .returning();
  const [c] = await db
    .insert(campaigns)
    .values({ workspaceId: w!.id, name: "Spring launch", status: campaignStatus })
    .returning();
  await db
    .insert(campaignCreators)
    .values({ campaignId: c!.id, creatorId: 1, status: "invited", feeUsd: 600 });
  const now = new Date();
  const [inv] = await db
    .insert(campaignInvites)
    .values({
      campaignId: c!.id,
      creatorId: 1,
      token: newToken(),
      offeredUsd: 600,
      expiresAt: new Date(now.getTime() + daysLeft * DAY),
    })
    .returning();
  return { c: c!, inv: inv!, w: w!, now };
}

const remindedBy = async (campaignId: string) =>
  (
    await db
      .select({ at: campaignInvites.remindedAt })
      .from(campaignInvites)
      .where(eq(campaignInvites.campaignId, campaignId))
  )[0]!.at;

describe("invitation reminders", () => {
  it("send one email shortly before expiry, as the system, and never a second", async () => {
    const f = await fixture(2);
    await sendInvitationReminders(f.now);
    expect(await remindedBy(f.c.id)).not.toBeNull();
    const mails = await db.select().from(emails).where(eq(emails.type, "outreach"));
    const mine = mails.filter((m) => m.bodyText.includes(f.inv.token));
    expect(mine).toHaveLength(1);
    expect(mine[0]!.subject).toContain("closes in 2 days");
    const ev = (
      await db.select().from(analyticsEvents).where(eq(analyticsEvents.workspaceId, f.w.id))
    ).filter((e) => e.name === "Creator Invitation Reminded");
    expect(ev).toHaveLength(1);
    expect(ev[0]!.props).toMatchObject({ actor_type: "system", product: "influencers" });
    expect(ev[0]!.userId).toBeNull();
    await sendInvitationReminders(f.now);
    expect(
      (await db.select().from(emails).where(eq(emails.type, "outreach"))).filter((m) =>
        m.bodyText.includes(f.inv.token),
      ),
    ).toHaveLength(1);
  });

  it("wait while there is plenty of time, and skip answered, expired or paused campaigns", async () => {
    const early = await fixture(10);
    const late = await fixture(-1);
    const paused = await fixture(2, "archived");
    const answered = await fixture(2);
    await db
      .update(campaignInvites)
      .set({ status: "declined" })
      .where(eq(campaignInvites.id, answered.inv.id));
    await sendInvitationReminders(new Date());
    for (const f of [early, late, paused, answered]) expect(await remindedBy(f.c.id)).toBeNull();
  });
});
