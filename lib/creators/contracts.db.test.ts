import { and, eq, like } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import {
  accounts,
  analyticsEvents,
  campaignContent,
  campaignCreators,
  campaignInvites,
  campaigns,
  creatorContracts,
  creatorPayouts,
  db,
  emails,
  pool,
  users,
  workspaces,
} from "@/db/client";
import { latestPayout } from "./contract-state";
import { requestContractChanges, sendContract, signContract, withdrawContract } from "./contracts";
import { newToken } from "./outreach-flow";
import { initiatePayout, savePayoutDetails, settleDuePayouts } from "./payouts";
import { submitContent } from "./outreach";
import type { PlanTier } from "@/lib/entitlements/plans";

afterAll(() => pool.end());

const TERMS = {
  deliverables: "One Reel and three stories",
  usageDays: 90,
  exclusivityDays: 0,
  paymentDays: 14,
};
const DETAILS = { holderName: "Ana Alder", accountNumber: "0001 2345 6789", country: "US" };

/** A confirmed creator with an accepted invitation (so they have a page), on a plan that includes everything. */
async function fixture(tier: PlanTier = "agency", rosterStatus = "confirmed") {
  const [a] = await db
    .insert(accounts)
    .values({ name: "ctr", planTier: tier, billingStatus: "active" })
    .returning();
  const [w] = await db
    .insert(workspaces)
    .values({
      accountId: a!.id,
      name: "Latte Lane",
      slug: `ctr-${Math.random().toString(36).slice(2, 9)}`,
    })
    .returning();
  const [u] = await db
    .insert(users)
    .values({
      email: `ctr-${Math.random().toString(36).slice(2, 8)}@example.test`,
      passwordHash: "x",
      name: "Brand Person",
    })
    .returning();
  const [c] = await db
    .insert(campaigns)
    .values({ workspaceId: w!.id, name: "Spring launch", status: "active" })
    .returning();
  await db
    .insert(campaignCreators)
    .values({ campaignId: c!.id, creatorId: 1, status: rosterStatus, feeUsd: 800 });
  const token = newToken();
  await db.insert(campaignInvites).values({
    campaignId: c!.id,
    creatorId: 1,
    token,
    offeredUsd: 800,
    status: "accepted",
    sentBy: u!.id,
    expiresAt: new Date(Date.now() + 86_400_000),
  });
  return {
    ws: { id: w!.id, accountId: a!.id, name: "Latte Lane" },
    actor: { id: u!.id, name: "Brand Person", email: u!.email },
    campaignId: c!.id,
    token,
    tier,
  };
}
const send = (f: Awaited<ReturnType<typeof fixture>>, terms: Record<string, unknown> = TERMS) =>
  sendContract({
    ws: f.ws,
    tier: f.tier,
    actor: f.actor,
    campaignId: f.campaignId,
    creatorId: 1,
    terms,
  });
const status = async (campaignId: string) =>
  (await db.select().from(campaignCreators).where(eq(campaignCreators.campaignId, campaignId)))[0]!
    .status;
const creatorMail = () =>
  db.select().from(emails).where(like(emails.toAddress, "%@creators.example.test"));

describe("agreements", () => {
  it("are sent, read and signed once, and the text that was signed is kept word for word", async () => {
    const f = await fixture();
    expect(await send(f)).toEqual({ ok: true });
    const [sent] = await db
      .select()
      .from(creatorContracts)
      .where(eq(creatorContracts.campaignId, f.campaignId));
    expect(sent).toMatchObject({ version: 1, status: "sent", feeUsd: 800 });
    expect(sent!.bodyText).toContain("$800");
    expect(sent!.bodyHash).toMatch(/^[0-9a-f]{64}$/);
    // The creator is emailed a link to their own page, where the agreement is.
    const mail = (await creatorMail()).filter((m) => m.bodyText.includes(f.token));
    expect(mail).toHaveLength(1);
    expect(mail[0]!.subject).toContain("agreement");

    expect(await signContract(f.token, "A", true)).toMatchObject({ ok: false });
    expect(await signContract(f.token, "Ana Alder", false)).toMatchObject({ ok: false });
    expect(await signContract(f.token, "Ana Alder", true)).toEqual({ ok: true });
    // Signing twice (a double-click, a second tab) is refused, not repeated.
    expect(await signContract(f.token, "Ana Alder", true)).toMatchObject({ ok: false });
    const [signed] = await db
      .select()
      .from(creatorContracts)
      .where(eq(creatorContracts.id, sent!.id));
    expect(signed).toMatchObject({ status: "signed", signedName: "Ana Alder" });
    expect(signed!.bodyText).toBe(sent!.bodyText); // what was signed is what was sent
    // A signed agreement can't be replaced.
    expect(await send(f)).toMatchObject({ ok: false });
  });

  it("can be revised after the creator asks for changes, and a revision replaces the old one", async () => {
    const f = await fixture();
    await send(f);
    expect(await requestContractChanges(f.token, "no")).toMatchObject({ ok: false });
    expect(await requestContractChanges(f.token, "Please shorten the usage period")).toEqual({
      ok: true,
    });
    expect(await signContract(f.token, "Ana Alder", true)).toMatchObject({ ok: false }); // nothing waiting
    expect(await send(f, { ...TERMS, usageDays: 30 })).toEqual({ ok: true });
    const all = await db
      .select()
      .from(creatorContracts)
      .where(eq(creatorContracts.campaignId, f.campaignId));
    expect(all.map((c) => [c.version, c.status]).sort()).toEqual([
      [1, "superseded"],
      [2, "sent"],
    ]);
    expect(all.find((c) => c.version === 2)!.bodyText).toContain("30 days");
    expect(await signContract(f.token, "Ana Alder", true)).toEqual({ ok: true });
  });

  it("are refused on a plan without them, for an unconfirmed creator, without a fee or an invitation, and with bad terms", async () => {
    const trial = await fixture("trial");
    expect(await send(trial)).toMatchObject({ ok: false, upgradeTo: "growth" });
    const early = await fixture("growth", "invited");
    expect(await send(early)).toMatchObject({ ok: false });
    const f = await fixture("growth");
    expect(await send(f, { ...TERMS, deliverables: "" })).toMatchObject({ ok: false });
    expect(await send(f, { ...TERMS, usageDays: 45 })).toMatchObject({ ok: false });
    await db
      .update(campaignCreators)
      .set({ feeUsd: null })
      .where(eq(campaignCreators.campaignId, f.campaignId));
    expect(await send(f)).toMatchObject({ ok: false });
    await db.delete(campaignInvites).where(eq(campaignInvites.campaignId, f.campaignId));
    await db
      .update(campaignCreators)
      .set({ feeUsd: 800 })
      .where(eq(campaignCreators.campaignId, f.campaignId));
    expect(await send(f)).toMatchObject({ ok: false }); // no page for the creator to sign on
  });

  it("hold content back until they're dealt with, and can be withdrawn", async () => {
    const f = await fixture();
    await send(f);
    expect(await submitContent(f.token, "https://social.example.test/p/1", "")).toMatchObject({
      ok: false,
    });
    expect(
      await withdrawContract({ ws: f.ws, actor: f.actor, campaignId: f.campaignId, creatorId: 1 }),
    ).toEqual({ ok: true });
    expect(await submitContent(f.token, "https://social.example.test/p/1", "")).toMatchObject({
      ok: true,
    });
    const g = await fixture();
    await send(g);
    await signContract(g.token, "Ana Alder", true);
    expect(await submitContent(g.token, "https://social.example.test/p/2", "")).toMatchObject({
      ok: true,
    });
    expect(
      (await db.select().from(campaignContent).where(eq(campaignContent.campaignId, g.campaignId)))
        .length,
    ).toBe(1);
  });
});

describe("payouts", () => {
  async function approved(opts: { contract?: boolean } = {}) {
    const f = await fixture("agency", "approved");
    if (opts.contract) await send(f);
    return f;
  }
  const pay = (f: Awaited<ReturnType<typeof fixture>>) =>
    initiatePayout({
      ws: f.ws,
      tier: f.tier,
      actor: f.actor,
      campaignId: f.campaignId,
      creatorId: 1,
    });

  it("say what is missing, in order, and then go", async () => {
    const f = await approved({ contract: true });
    expect(await pay(f)).toMatchObject({ ok: false, error: expect.stringContaining("signed") });
    await signContract(f.token, "Ana Alder", true);
    expect(await pay(f)).toMatchObject({
      ok: false,
      error: expect.stringContaining("payout details"),
    });
    expect(await savePayoutDetails(f.token, { ...DETAILS, accountNumber: "123" })).toMatchObject({
      ok: false,
    });
    expect(await savePayoutDetails(f.token, DETAILS)).toEqual({ ok: true });
    expect(await pay(f)).toEqual({ ok: true });
    expect(await pay(f)).toMatchObject({
      ok: false,
      error: expect.stringContaining("already on its way"),
    });
    const p = (await latestPayout(f.campaignId, 1))!;
    expect(p).toMatchObject({ status: "processing", amountUsd: 800 });
    expect(p.reference).toMatch(/^PO-[0-9A-F]{8}$/);
  });

  it("need content approved and a plan that includes them", async () => {
    const early = await fixture("agency", "content_submitted");
    expect(await pay(early)).toMatchObject({
      ok: false,
      error: expect.stringContaining("Approve"),
    });
    const growth = await fixture("growth", "approved");
    expect(await pay(growth)).toMatchObject({ ok: false, upgradeTo: "agency" });
  });

  it("only keep the last four digits of the account", async () => {
    const f = await approved();
    await savePayoutDetails(f.token, DETAILS);
    const rows = await db.execute(
      `select * from creator_payout_details where campaign_id = '${f.campaignId}'` as never,
    );
    expect(JSON.stringify(rows.rows)).toContain("6789");
    expect(JSON.stringify(rows.rows)).not.toContain("012345");
  });

  it("settle when due: the creator becomes paid, once, and the system (not a person) is the actor", async () => {
    const f = await approved();
    await savePayoutDetails(f.token, DETAILS);
    await pay(f);
    // Not due yet: nothing happens.
    expect(await settleDuePayouts(new Date(), f.campaignId)).toBe(0);
    expect(await status(f.campaignId)).toBe("approved");
    const later = new Date(Date.now() + 3 * 86_400_000);
    expect(await settleDuePayouts(later, f.campaignId)).toBe(1);
    expect(await settleDuePayouts(later, f.campaignId)).toBe(0); // settled once
    expect(await status(f.campaignId)).toBe("paid");
    expect((await latestPayout(f.campaignId, 1))!.status).toBe("paid");
    const ev = (
      await db
        .select()
        .from(analyticsEvents)
        .where(eq(analyticsEvents.name, "Creator Payout Settled"))
    ).filter((e) => (e.props as { campaign_id?: string }).campaign_id === f.campaignId);
    expect(ev).toHaveLength(1);
    expect(ev[0]!.userId).toBeNull();
    expect(ev[0]!.props).toMatchObject({
      actor_type: "system",
      outcome: "paid",
      product: "influencers",
    });
    expect(await pay(f)).toMatchObject({
      ok: false,
      error: expect.stringContaining("already been paid"),
    });
  });

  it("fail on a test account that rejects transfers, and can be retried after the details change", async () => {
    const f = await approved();
    await savePayoutDetails(f.token, { ...DETAILS, accountNumber: "000999999991" });
    await pay(f);
    await settleDuePayouts(new Date(Date.now() + 3 * 86_400_000), f.campaignId);
    const failed = (await latestPayout(f.campaignId, 1))!;
    expect(failed).toMatchObject({ status: "failed" });
    expect(failed.failureReason).toMatch(/rejected/);
    expect(await status(f.campaignId)).toBe("approved"); // not paid
    await savePayoutDetails(f.token, DETAILS);
    expect(await pay(f)).toEqual({ ok: true });
    await settleDuePayouts(new Date(Date.now() + 6 * 86_400_000), f.campaignId);
    expect(await status(f.campaignId)).toBe("paid");
    const all = await db
      .select()
      .from(creatorPayouts)
      .where(and(eq(creatorPayouts.campaignId, f.campaignId)));
    expect(all.map((p) => p.status).sort()).toEqual(["failed", "paid"]);
    const ev = await db
      .select()
      .from(analyticsEvents)
      .where(eq(analyticsEvents.name, "Creator Payout Initiated"));
    expect(
      ev
        .filter((e) => (e.props as { campaign_id?: string }).campaign_id === f.campaignId)
        .map((e) => (e.props as { attempt: number }).attempt)
        .sort(),
    ).toEqual([1, 2]);
  });

  it("can't verify the test account that is rejected when saved", async () => {
    const f = await approved();
    expect(
      await savePayoutDetails(f.token, { ...DETAILS, accountNumber: "000999999992" }),
    ).toMatchObject({ ok: false });
  });
});
