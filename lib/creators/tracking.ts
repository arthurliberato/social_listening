// Tracking links: creating them, recording clicks and conversions, and reading the results back. A click is public
// (anyone with the link), so it records a salted hash of the visitor and nothing else; a conversion is accepted only
// from a caller that knows the campaign's secret key and a real click id.
import { createHash, timingSafeEqual } from "node:crypto";
import { and, asc, eq, gt, inArray, sql } from "drizzle-orm";
import {
  campaignCreators,
  campaigns,
  creators,
  db,
  linkClicks,
  linkConversions,
  trackingLinks,
  workspaces,
} from "@/db/client";
import { trackServer } from "@/lib/analytics/server";
import { APP_URL } from "@/lib/email/service";
import { simNow } from "@/lib/simclock";
import { COMMITTED } from "./campaign-flow";
import {
  checkConversion,
  destinationFor,
  isBotAgent,
  isClickId,
  isLinkCode,
  newClickId,
  newConversionKey,
  newLinkCode,
  resultsOf,
  dailySeries,
  withinWindow,
  type Results,
} from "./tracking-flow";

export const trackingUrl = (code: string) => `${APP_URL}/r/${code}`;
export const postbackBase = () => `${APP_URL}/api/t/conversion`;

const SALT = () => process.env.AUTH_SECRET ?? "dev-salt";
/** Not reversible and not shared across days, so it can count repeat visits without being a way to follow anyone. */
export function visitorHash(ip: string, ua: string, day: string): string {
  return createHash("sha256").update(`${SALT()}|${day}|${ip}|${ua}`).digest("hex").slice(0, 32);
}

const safeEqual = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

async function scopeOfCampaign(campaignId: string) {
  const [r] = await db
    .select({ campaign: campaigns, wsId: workspaces.id, accountId: workspaces.accountId })
    .from(campaigns)
    .innerJoin(workspaces, eq(workspaces.id, campaigns.workspaceId))
    .where(eq(campaigns.id, campaignId));
  return r ?? null;
}

/** Make sure the campaign has a conversion key (set once, when the destination is first chosen). */
export async function ensureConversionKey(campaignId: string): Promise<string> {
  const [c] = await db.select().from(campaigns).where(eq(campaigns.id, campaignId));
  if (c?.conversionKey) return c.conversionKey;
  const key = newConversionKey();
  await db
    .update(campaigns)
    .set({ conversionKey: key })
    .where(and(eq(campaigns.id, campaignId), sql`${campaigns.conversionKey} is null`));
  const [again] = await db.select().from(campaigns).where(eq(campaigns.id, campaignId));
  return again!.conversionKey!;
}

/**
 * A creator's link, if the campaign has somewhere to send people and the creator is confirmed or later. Safe to call
 * repeatedly: there is one link per creator per campaign.
 */
export async function ensureLink(
  campaignId: string,
  creatorId: number,
  source: "destination_set" | "confirmed" | "brand",
): Promise<{ code: string; created: boolean } | null> {
  const sc = await scopeOfCampaign(campaignId);
  if (!sc?.campaign.destinationUrl) return null;
  const [row] = await db
    .select({ status: campaignCreators.status })
    .from(campaignCreators)
    .where(
      and(eq(campaignCreators.campaignId, campaignId), eq(campaignCreators.creatorId, creatorId)),
    );
  if (!row || !(COMMITTED as readonly string[]).includes(row.status)) return null;
  const [have] = await db
    .select({ code: trackingLinks.code })
    .from(trackingLinks)
    .where(and(eq(trackingLinks.campaignId, campaignId), eq(trackingLinks.creatorId, creatorId)));
  if (have) return { code: have.code, created: false };
  const [made] = await db
    .insert(trackingLinks)
    .values({ campaignId, creatorId, code: newLinkCode() })
    .onConflictDoNothing()
    .returning({ code: trackingLinks.code });
  if (!made) {
    // Another request made it first.
    const [r] = await db
      .select({ code: trackingLinks.code })
      .from(trackingLinks)
      .where(and(eq(trackingLinks.campaignId, campaignId), eq(trackingLinks.creatorId, creatorId)));
    return r ? { code: r.code, created: false } : null;
  }
  await trackServer(
    "Tracking Link Created",
    { workspaceId: sc.wsId, accountId: sc.accountId },
    { campaign_id: campaignId, creator_id: creatorId, source },
  );
  return { code: made.code, created: true };
}

export async function ensureLinksForCampaign(campaignId: string) {
  const rows = await db
    .select({ creatorId: campaignCreators.creatorId })
    .from(campaignCreators)
    .where(
      and(
        eq(campaignCreators.campaignId, campaignId),
        inArray(campaignCreators.status, [...COMMITTED]),
      ),
    );
  for (const r of rows) await ensureLink(campaignId, r.creatorId, "destination_set");
}

export async function linkFor(campaignId: string, creatorId: number): Promise<string | null> {
  const [l] = await db
    .select({ code: trackingLinks.code })
    .from(trackingLinks)
    .where(and(eq(trackingLinks.campaignId, campaignId), eq(trackingLinks.creatorId, creatorId)));
  return l ? trackingUrl(l.code) : null;
}

/**
 * Someone followed a link. Returns where to send them (with the click id on the end), or null when the link isn't
 * active. Links on completed campaigns keep working so a creator's old posts don't break; archived ones stop.
 */
export async function recordClick(
  code: string,
  who: { ip: string; ua: string },
): Promise<{ redirectTo: string; clickId: string } | null> {
  if (!isLinkCode(code)) return null;
  const [r] = await db
    .select({
      linkId: trackingLinks.id,
      campaignId: trackingLinks.campaignId,
      creatorId: trackingLinks.creatorId,
      handle: creators.handle,
      destination: campaigns.destinationUrl,
      status: campaigns.status,
      wsId: workspaces.id,
      accountId: workspaces.accountId,
    })
    .from(trackingLinks)
    .innerJoin(campaigns, eq(campaigns.id, trackingLinks.campaignId))
    .innerJoin(workspaces, eq(workspaces.id, campaigns.workspaceId))
    .innerJoin(creators, eq(creators.id, trackingLinks.creatorId))
    .where(eq(trackingLinks.code, code));
  if (!r || !r.destination || r.status === "archived") return null;

  const now = simNow();
  const bot = isBotAgent(who.ua);
  const hash = visitorHash(who.ip, who.ua, now.toISOString().slice(0, 10));
  let unique = false;
  if (!bot) {
    const [seen] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(linkClicks)
      .where(
        and(
          eq(linkClicks.linkId, r.linkId),
          eq(linkClicks.visitorHash, hash),
          eq(linkClicks.isBot, false),
          gt(linkClicks.ts, new Date(now.getTime() - 86_400_000)),
        ),
      );
    unique = (seen?.n ?? 0) === 0;
  }
  const clickId = newClickId();
  await db.insert(linkClicks).values({
    linkId: r.linkId,
    clickId,
    ts: now,
    visitorHash: hash,
    isBot: bot,
    isUnique: unique,
  });
  await trackServer(
    "Tracking Link Clicked",
    { workspaceId: r.wsId, accountId: r.accountId },
    { campaign_id: r.campaignId, creator_id: r.creatorId, is_unique: unique, is_bot: bot },
  );
  return {
    clickId,
    redirectTo: destinationFor(r.destination, {
      creatorHandle: r.handle,
      campaignId: r.campaignId,
      clickId,
    }),
  };
}

export type ConversionResult =
  { ok: true; duplicate: boolean } | { ok: false; status: 400 | 401 | 404 | 410; reason: string };

/** The brand's site reports that a click turned into something. Idempotent per order reference (or per click). */
export async function recordConversion(input: {
  cid: unknown;
  key: unknown;
  value?: unknown;
  ref?: unknown;
}): Promise<ConversionResult> {
  const cid = typeof input.cid === "string" ? input.cid : "";
  const key = typeof input.key === "string" ? input.key : "";
  if (!isClickId(cid)) return { ok: false, status: 400, reason: "cid is missing or malformed" };
  const check = checkConversion({ value: input.value, ref: input.ref });
  if (!check.ok) return { ok: false, status: 400, reason: check.reason };
  const [r] = await db
    .select({
      linkId: trackingLinks.id,
      campaignId: trackingLinks.campaignId,
      creatorId: trackingLinks.creatorId,
      clickAt: linkClicks.ts,
      isBot: linkClicks.isBot,
      secret: campaigns.conversionKey,
      wsId: workspaces.id,
      accountId: workspaces.accountId,
    })
    .from(linkClicks)
    .innerJoin(trackingLinks, eq(trackingLinks.id, linkClicks.linkId))
    .innerJoin(campaigns, eq(campaigns.id, trackingLinks.campaignId))
    .innerJoin(workspaces, eq(workspaces.id, campaigns.workspaceId))
    .where(eq(linkClicks.clickId, cid));
  // The key is checked before anything about the click is revealed, and an unknown click looks like a wrong key.
  if (!r || !r.secret || !key || !safeEqual(key, r.secret))
    return { ok: false, status: 401, reason: "unknown click or wrong key" };
  if (r.isBot) return { ok: false, status: 400, reason: "that click wasn't counted as a visit" };
  const now = simNow();
  if (!withinWindow(r.clickAt, now))
    return { ok: false, status: 410, reason: "the click is outside the 30-day attribution window" };
  const inserted = await db
    .insert(linkConversions)
    .values({
      linkId: r.linkId,
      clickId: cid,
      ts: now,
      valueUsd: check.valueUsd,
      dedupeKey: check.ref ?? `click:${cid}`,
    })
    .onConflictDoNothing()
    .returning({ id: linkConversions.id });
  if (!inserted.length) return { ok: true, duplicate: true };
  await trackServer(
    "Campaign Conversion Recorded",
    { workspaceId: r.wsId, accountId: r.accountId },
    { campaign_id: r.campaignId, creator_id: r.creatorId, value_usd: check.valueUsd },
  );
  return { ok: true, duplicate: false };
}

export interface CreatorResult extends Results {
  creatorId: number;
  name: string;
  handle: string;
  link: string | null;
  feeUsd: number | null;
}
export interface CampaignResults {
  total: Results;
  perCreator: CreatorResult[];
  daily: ReturnType<typeof dailySeries>;
  hasTraffic: boolean;
}

/** Clicks and conversions for a campaign (bots excluded), with cost measured against agreed fees. */
export async function campaignResults(
  campaignId: string,
  now: Date = simNow(),
  days = 30,
): Promise<CampaignResults> {
  const roster = await db
    .select({
      creatorId: campaignCreators.creatorId,
      status: campaignCreators.status,
      feeUsd: campaignCreators.feeUsd,
      name: creators.displayName,
      handle: creators.handle,
    })
    .from(campaignCreators)
    .innerJoin(creators, eq(creators.id, campaignCreators.creatorId))
    .where(eq(campaignCreators.campaignId, campaignId))
    .orderBy(asc(campaignCreators.addedAt), asc(creators.id));
  const links = await db
    .select()
    .from(trackingLinks)
    .where(eq(trackingLinks.campaignId, campaignId));
  const linkIds = links.map((l) => l.id);
  const clicks = linkIds.length
    ? await db
        .select({ linkId: linkClicks.linkId, ts: linkClicks.ts, isUnique: linkClicks.isUnique })
        .from(linkClicks)
        .where(and(inArray(linkClicks.linkId, linkIds), eq(linkClicks.isBot, false)))
    : [];
  const convs = linkIds.length
    ? await db
        .select({
          linkId: linkConversions.linkId,
          ts: linkConversions.ts,
          valueUsd: linkConversions.valueUsd,
        })
        .from(linkConversions)
        .where(inArray(linkConversions.linkId, linkIds))
    : [];
  const byLink = new Map(links.map((l) => [l.creatorId, l]));
  const perCreator: CreatorResult[] = roster
    .filter((r) => (COMMITTED as readonly string[]).includes(r.status) || byLink.has(r.creatorId))
    .map((r) => {
      const l = byLink.get(r.creatorId);
      const mine = (x: { linkId: string }) => !!l && x.linkId === l.id;
      const c = clicks.filter(mine);
      const v = convs.filter(mine);
      return {
        creatorId: r.creatorId,
        name: r.name,
        handle: r.handle,
        link: l ? trackingUrl(l.code) : null,
        feeUsd: r.feeUsd,
        ...resultsOf({
          clicks: c.length,
          visitors: c.filter((x) => x.isUnique).length,
          conversions: v.length,
          revenueUsd: v.reduce((a, x) => a + x.valueUsd, 0),
          spendUsd: r.feeUsd ?? 0,
        }),
      };
    });
  const sum = (f: (r: CreatorResult) => number) => perCreator.reduce((a, r) => a + f(r), 0);
  return {
    total: resultsOf({
      clicks: sum((r) => r.clicks),
      visitors: sum((r) => r.visitors),
      conversions: sum((r) => r.conversions),
      revenueUsd: sum((r) => r.revenueUsd),
      spendUsd: sum((r) => r.spendUsd),
    }),
    perCreator,
    daily: dailySeries(
      clicks.map((c) => c.ts),
      convs.map((c) => c.ts),
      now,
      days,
    ),
    hasTraffic: clicks.length > 0,
  };
}
