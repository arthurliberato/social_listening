// Paying creators from Ripplewise, on a simulated rail. The creator saves where they want to be paid (only the last four
// digits are kept); once the content is approved (and any agreement is signed) the brand starts a payout, which settles
// after a simulated delay and either arrives or fails. Nothing here moves real money.
import { randomBytes } from "node:crypto";
import { and, count, eq, lte } from "drizzle-orm";
import {
  campaignCreators,
  creatorPayoutDetails,
  creatorPayouts,
  db,
  users,
  workspaces,
} from "@/db/client";
import { trackServer } from "@/lib/analytics/server";
import { audit } from "@/lib/audit";
import { APP_URL, sendEmail } from "@/lib/email/service";
import { PLANS, planUnlocking, type PlanTier } from "@/lib/entitlements/plans";
import { simNow } from "@/lib/simclock";
import { contractOutstanding, latestPayout, payoutDetailsOf } from "./contract-state";
import { checkPayoutDetails, outcomeFor, payBlocker, settleAt, SETTLE_DAYS } from "./contract-flow";
import {
  acceptedInvite,
  fail,
  isOpen,
  portalFor,
  rosterRow,
  workspaceOf,
  type Actor,
  type Fail,
  type Scope,
} from "./outreach";
import { creatorAddress } from "./outreach-flow";
import { creatorNotice, portalLink } from "./outreach-emails";

const usd = (n: number) => `$${n.toLocaleString("en-US")}`;
const newReference = () => `PO-${randomBytes(4).toString("hex").toUpperCase()}`;

/** The creator saves where they want to be paid. Only what a receipt shows is kept, never the account number. */
export async function savePayoutDetails(
  token: string,
  input: { holderName: string; accountNumber: string; country: string },
): Promise<{ ok: true } | Fail> {
  const p = await portalFor(token);
  if (!p) return fail("We couldn't find that page.");
  if (!p.campaign.open) return fail("This campaign isn't taking responses any more.");
  if (!["confirmed", "in_review", "approved"].includes(p.state))
    return fail("You can add payout details once you've accepted, and before you've been paid.");
  const check = checkPayoutDetails(input);
  if (!check.ok) return fail(check.reason);
  await db
    .insert(creatorPayoutDetails)
    .values({
      campaignId: p.campaign.id,
      creatorId: p.creator.id,
      holderName: check.holderName,
      last4: check.last4,
      country: check.country,
      behavior: check.behavior,
    })
    .onConflictDoUpdate({
      target: [creatorPayoutDetails.campaignId, creatorPayoutDetails.creatorId],
      set: {
        holderName: check.holderName,
        last4: check.last4,
        country: check.country,
        behavior: check.behavior,
        savedAt: simNow(),
      },
    });
  await trackServer(
    "Creator Payout Details Saved",
    { workspaceId: p.workspaceId, accountId: p.accountId, creatorId: p.creator.id },
    { campaign_id: p.campaign.id, creator_id: p.creator.id },
  );
  return { ok: true };
}

/** Start a payout (or retry after a failed one). The blockers are spelled out so the brand knows what's missing. */
export async function initiatePayout(o: {
  ws: Scope;
  tier: PlanTier;
  actor: Actor;
  campaignId: string;
  creatorId: number;
}): Promise<{ ok: true } | Fail> {
  if (!PLANS[o.tier].features.creatorPayouts) {
    const to = planUnlocking("creatorPayouts");
    await trackServer(
      "Paywall Viewed",
      { userId: o.actor.id, workspaceId: o.ws.id },
      { paywall_trigger: "creator_payouts", required_plan: to },
    );
    return {
      ok: false,
      error: `Paying creators from Ripplewise is part of ${PLANS[to].label}.`,
      upgradeTo: to,
      upgradeLabel: PLANS[to].label,
    };
  }
  const w = await workspaceOf(o.campaignId);
  if (!w || w.wsId !== o.ws.id) return fail("That campaign no longer exists.");
  if (!isOpen(w.campaign.status)) return fail("Re-open the campaign before changing its creators.");
  const row = await rosterRow(o.campaignId, o.creatorId);
  if (!row) return fail("That creator isn't on this campaign.");
  const [details, outstanding, last] = await Promise.all([
    payoutDetailsOf(o.campaignId, o.creatorId),
    contractOutstanding(o.campaignId, o.creatorId),
    latestPayout(o.campaignId, o.creatorId),
  ]);
  const blocked = payBlocker({
    rosterStatus: row.status,
    feeUsd: row.feeUsd,
    hasDetails: !!details,
    contractOutstanding: outstanding,
    activePayout: last?.status === "processing" || last?.status === "paid",
  });
  if (blocked) return fail(blocked);

  const now = simNow();
  const [made] = await db
    .select({ n: count() })
    .from(creatorPayouts)
    .where(
      and(eq(creatorPayouts.campaignId, o.campaignId), eq(creatorPayouts.creatorId, o.creatorId)),
    );
  const attempt = (made?.n ?? 0) + 1;
  const reference = newReference();
  await db.insert(creatorPayouts).values({
    campaignId: o.campaignId,
    creatorId: o.creatorId,
    amountUsd: row.feeUsd!,
    status: "processing",
    initiatedBy: o.actor.id,
    initiatedAt: now,
    settleAt: settleAt(now),
    reference,
  });
  const invite = await acceptedInvite(o.campaignId, o.creatorId);
  await sendEmail({
    to: creatorAddress(row.handle),
    type: "outreach",
    subject: `A payment of ${usd(row.feeUsd!)} is on its way`,
    text: `${o.ws.name} started your payment of ${usd(row.feeUsd!)} for "${w.campaign.name}" (reference ${reference}). It should reach your account ending ${details!.last4} within ${SETTLE_DAYS} days.${invite ? `\n\nYour page:\n${portalLink(invite.token)}` : ""}\n\nThis message was sent through Ripplewise on behalf of the brand.`,
  });
  await trackServer(
    "Creator Payout Initiated",
    { userId: o.actor.id, workspaceId: o.ws.id },
    { campaign_id: o.campaignId, creator_id: o.creatorId, amount_usd: row.feeUsd!, attempt },
  );
  await audit({
    accountId: o.ws.accountId,
    workspaceId: o.ws.id,
    actorUserId: o.actor.id,
    action: "campaign.payout_initiated",
    targetType: "campaign",
    targetId: o.campaignId,
    meta: { creator: o.creatorId, amountUsd: row.feeUsd!, attempt },
  });
  return { ok: true };
}

/**
 * Settle every payout that has come due: it either arrives (the creator becomes "paid") or fails (the brand can
 * retry). Safe to call from anywhere and as often as you like: a payout is claimed with a conditional update, so two
 * callers can't settle it twice.
 */
export async function settleDuePayouts(now: Date = simNow(), campaignId?: string): Promise<number> {
  const due = await db
    .select()
    .from(creatorPayouts)
    .where(
      and(
        eq(creatorPayouts.status, "processing"),
        lte(creatorPayouts.settleAt, now),
        campaignId ? eq(creatorPayouts.campaignId, campaignId) : undefined,
      ),
    );
  let settled = 0;
  for (const p of due) {
    const details = await payoutDetailsOf(p.campaignId, p.creatorId);
    const outcome = outcomeFor(details?.behavior ?? "ok");
    const claimed = await db
      .update(creatorPayouts)
      .set({
        status: outcome.status,
        settledAt: now,
        failureReason: outcome.status === "failed" ? outcome.reason : "",
      })
      .where(and(eq(creatorPayouts.id, p.id), eq(creatorPayouts.status, "processing")))
      .returning({ id: creatorPayouts.id });
    if (!claimed.length) continue;
    settled++;
    const w = await workspaceOf(p.campaignId);
    const row = await rosterRow(p.campaignId, p.creatorId);
    if (!w || !row) continue;
    const invite = await acceptedInvite(p.campaignId, p.creatorId);
    if (outcome.status === "paid") {
      await db
        .update(campaignCreators)
        .set({ status: "paid", statusChangedAt: now })
        .where(
          and(
            eq(campaignCreators.campaignId, p.campaignId),
            eq(campaignCreators.creatorId, p.creatorId),
            eq(campaignCreators.status, "approved"),
          ),
        );
      if (invite)
        await sendEmail({
          to: creatorAddress(row.handle),
          type: "outreach",
          ...creatorNotice("paid", {
            brand: w.wsName,
            campaign: w.campaign.name,
            token: invite.token,
            usd: p.amountUsd,
          }),
        });
    } else {
      if (invite)
        await sendEmail({
          to: creatorAddress(row.handle),
          type: "outreach",
          subject: `Your payment of ${usd(p.amountUsd)} didn't go through`,
          text: `The transfer for "${w.campaign.name}" (reference ${p.reference}) was rejected: ${outcome.reason}\n\nCheck your payout details on your page and the brand will try again:\n${portalLink(invite.token)}\n\nThis message was sent through Ripplewise on behalf of the brand.`,
        });
      if (p.initiatedBy) {
        const [u] = await db.select().from(users).where(eq(users.id, p.initiatedBy));
        const [ws] = await db
          .select({ slug: workspaces.slug })
          .from(workspaces)
          .where(eq(workspaces.id, w.wsId));
        if (u)
          await sendEmail({
            toUserId: u.id,
            to: u.email,
            type: "outreach",
            subject: `The payout to ${row.displayName} failed`,
            text: `The payout of ${usd(p.amountUsd)} (reference ${p.reference}) for "${w.campaign.name}" failed: ${outcome.reason}\n\nAsk the creator to check their details, then retry:\n${APP_URL}/w/${ws?.slug ?? ""}/creators/campaigns/${p.campaignId}`,
          });
      }
    }
    // Nobody did this: the clock did. It is the system's event, not whoever happened to load the page.
    await trackServer(
      "Creator Payout Settled",
      { workspaceId: w.wsId, accountId: w.accountId, system: true },
      {
        campaign_id: p.campaignId,
        creator_id: p.creatorId,
        amount_usd: p.amountUsd,
        outcome: outcome.status,
      },
    );
  }
  return settled;
}
