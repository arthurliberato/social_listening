import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import {
  accounts,
  campaignCreators,
  campaigns,
  db,
  linkClicks,
  trackingLinks,
  workspaces,
} from "@/db/client";
import {
  campaignResults,
  ensureConversionKey,
  ensureLink,
  recordClick,
  recordConversion,
} from "./tracking";
import { isClickId } from "./tracking-flow";
import { pool } from "@/db/client";

afterAll(() => pool.end());

const BROWSER =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0 Safari/537.36";

async function fixture(opts: { destination?: string | null; status?: string } = {}) {
  const [a] = await db
    .insert(accounts)
    .values({ name: "trk", planTier: "growth", billingStatus: "active" })
    .returning();
  const [w] = await db
    .insert(workspaces)
    .values({
      accountId: a!.id,
      name: "trk",
      slug: `trk-${Math.random().toString(36).slice(2, 9)}`,
    })
    .returning();
  const [c] = await db
    .insert(campaigns)
    .values({
      workspaceId: w!.id,
      name: "Launch",
      destinationUrl:
        opts.destination === undefined ? "https://shop.example.test/launch" : opts.destination,
      status: opts.status ?? "active",
    })
    .returning();
  await db.insert(campaignCreators).values([
    { campaignId: c!.id, creatorId: 1, status: "confirmed", feeUsd: 500 },
    { campaignId: c!.id, creatorId: 2, status: "shortlisted" },
  ]);
  return { c: c! };
}

describe("tracking links", () => {
  it("are made once, only for confirmed creators, and only once there is somewhere to send people", async () => {
    const { c } = await fixture();
    expect(await ensureLink(c.id, 2, "brand")).toBeNull(); // shortlisted
    const a = (await ensureLink(c.id, 1, "confirmed"))!;
    expect(a.created).toBe(true);
    const b = (await ensureLink(c.id, 1, "confirmed"))!;
    expect(b).toEqual({ code: a.code, created: false });
    const none = await fixture({ destination: null });
    expect(await ensureLink(none.c.id, 1, "confirmed")).toBeNull();
  });

  it("record a visit, tag the destination, and count a visitor once a day", async () => {
    const { c } = await fixture();
    const { code } = (await ensureLink(c.id, 1, "confirmed"))!;
    const first = (await recordClick(code, { ip: "10.0.0.1", ua: BROWSER }))!;
    const u = new URL(first.redirectTo);
    expect(u.origin + u.pathname).toBe("https://shop.example.test/launch");
    expect(u.searchParams.get("utm_medium")).toBe("influencer");
    expect(isClickId(u.searchParams.get("rw_cid")!)).toBe(true);
    await recordClick(code, { ip: "10.0.0.1", ua: BROWSER }); // same person again
    await recordClick(code, { ip: "10.0.0.2", ua: BROWSER }); // someone else
    await recordClick(code, { ip: "10.0.0.3", ua: "Googlebot/2.1" }); // a crawler: sent on, never counted
    const r = await campaignResults(c.id);
    expect(r.total).toMatchObject({ clicks: 3, visitors: 2 });
    const stored = await db.select().from(linkClicks);
    expect(stored.some((s) => s.isBot)).toBe(true);
    // Only a salted hash is kept, never the address.
    expect(JSON.stringify(stored)).not.toContain("10.0.0.1");
  });

  it("don't work for unknown codes, links without a destination, or archived campaigns; completed ones still do", async () => {
    expect(await recordClick("zzzzzzzzzz", { ip: "1", ua: BROWSER })).toBeNull();
    expect(await recordClick("not a code", { ip: "1", ua: BROWSER })).toBeNull();
    const done = await fixture({ status: "completed" });
    const l1 = (await ensureLink(done.c.id, 1, "confirmed"))!;
    expect(await recordClick(l1.code, { ip: "1", ua: BROWSER })).not.toBeNull();
    const arch = await fixture({ status: "archived" });
    const l2 = (await ensureLink(arch.c.id, 1, "confirmed"))!;
    expect(await recordClick(l2.code, { ip: "1", ua: BROWSER })).toBeNull();
  });
});

describe("conversions", () => {
  async function clicked() {
    const { c } = await fixture();
    const key = await ensureConversionKey(c.id);
    const { code } = (await ensureLink(c.id, 1, "confirmed"))!;
    const hit = (await recordClick(code, { ip: "10.1.1.1", ua: BROWSER }))!;
    return { c, key, cid: hit.clickId, code };
  }

  it("need the campaign's key and a real click, and say the same thing for both mistakes", async () => {
    const { key, cid } = await clicked();
    expect(await recordConversion({ cid, key: "wrong", value: 10 })).toMatchObject({
      ok: false,
      status: 401,
    });
    expect(await recordConversion({ cid: "0".repeat(24), key, value: 10 })).toMatchObject({
      ok: false,
      status: 401,
    });
    expect(await recordConversion({ cid: "nope", key, value: 10 })).toMatchObject({
      ok: false,
      status: 400,
    });
    expect(await recordConversion({ cid, key, value: -5 })).toMatchObject({
      ok: false,
      status: 400,
    });
    expect(await recordConversion({ cid, key })).toMatchObject({ ok: true }); // value defaults to 0
  });

  it("are counted once per order reference, or once per click when there is none", async () => {
    const { c, key, cid } = await clicked();
    expect(await recordConversion({ cid, key, value: 100, ref: "order-1" })).toEqual({
      ok: true,
      duplicate: false,
    });
    expect(await recordConversion({ cid, key, value: 100, ref: "order-1" })).toEqual({
      ok: true,
      duplicate: true,
    });
    expect(await recordConversion({ cid, key, value: 40, ref: "order-2" })).toEqual({
      ok: true,
      duplicate: false,
    });
    const r = await campaignResults(c.id);
    expect(r.total).toMatchObject({ conversions: 2, revenueUsd: 140, spendUsd: 500 });
    expect(r.total.roas).toBe(0.28);
    expect(r.total.cpa).toBe(250);
  });

  it("are not credited for crawler clicks or clicks older than 30 days", async () => {
    const { c, key, code } = await clicked();
    const bot = (await recordClick(code, { ip: "10.9.9.9", ua: "Googlebot/2.1" }))!;
    expect(await recordConversion({ cid: bot.clickId, key, value: 5 })).toMatchObject({
      ok: false,
      status: 400,
    });
    const hit = (await recordClick(code, { ip: "10.8.8.8", ua: BROWSER }))!;
    const [link] = await db.select().from(trackingLinks).where(eq(trackingLinks.code, code));
    await db
      .update(linkClicks)
      .set({ ts: new Date(Date.now() - 45 * 86_400_000) })
      .where(eq(linkClicks.clickId, hit.clickId));
    expect(link!.campaignId).toBe(c.id);
    expect(await recordConversion({ cid: hit.clickId, key, value: 5 })).toMatchObject({
      ok: false,
      status: 410,
    });
  });
});
