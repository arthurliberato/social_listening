// Creator outreach: the brand sends an invitation, the creator answers from their own page, content comes back for
// review. Everything that changes state lives here so the brand's actions and the creator's portal follow one set of
// rules (outreach-flow.ts) and write the same audit, analytics and email records.
import { and, count, desc, eq, gt, inArray, isNull, lte, sql } from "drizzle-orm";
import {
  campaignContent,
  campaignCreators,
  campaignInvites,
  campaigns,
  creators,
  db,
  usageCounters,
  users,
  workspaces,
} from "@/db/client";
import { trackServer } from "@/lib/analytics/server";
import { audit } from "@/lib/audit";
import { APP_URL, sendEmail } from "@/lib/email/service";
import { PLANS, type PlanTier } from "@/lib/entitlements/plans";
import { simNow } from "@/lib/simclock";
import { periodOf } from "@/lib/usage";
import {
  ANSWERABLE_FROM,
  INVITABLE_FROM,
  SUBMITTABLE_FROM,
  STATUS_AFTER_RESPONSE,
  checkOffer,
  checkResponse,
  checkReview,
  checkSubmission,
  creatorAddress,
  defaultMessage,
  expiryFrom,
  inviteState,
  isToken,
  newToken,
  REMINDER_DAYS_BEFORE,
  reminderDue,
  type Response,
} from "./outreach-flow";
import { contractOutstanding } from "./contract-state";
import { ensureLink, linkFor } from "./tracking";
import { brandNotice, creatorNotice, invitationEmail, reminderEmail } from "./outreach-emails";

export type Fail = { ok: false; error: string; upgradeTo?: PlanTier; upgradeLabel?: string };
export const fail = (error: string): Fail => ({ ok: false, error });
const METRIC = "creator_invites";

export interface Actor {
  id: string;
  name: string;
  email: string;
}
export interface Scope {
  id: string;
  accountId: string;
  name: string;
}

const campaignUrl = (slug: string, id: string) => `${APP_URL}/w/${slug}/creators/campaigns/${id}`;

export async function workspaceOf(campaignId: string) {
  const [row] = await db
    .select({
      campaign: campaigns,
      wsId: workspaces.id,
      wsSlug: workspaces.slug,
      wsName: workspaces.name,
      accountId: workspaces.accountId,
    })
    .from(campaigns)
    .innerJoin(workspaces, eq(workspaces.id, campaigns.workspaceId))
    .where(eq(campaigns.id, campaignId));
  return row ?? null;
}

export const isOpen = (status: string) => status === "draft" || status === "active";

/** Invitations sent this month by the account, for the plan's allowance. */
export async function invitationsUsed(accountId: string) {
  const [r] = await db
    .select({ v: usageCounters.value })
    .from(usageCounters)
    .where(
      and(
        eq(usageCounters.accountId, accountId),
        eq(usageCounters.period, periodOf()),
        eq(usageCounters.metric, METRIC),
      ),
    );
  return r?.v ?? 0;
}

async function countInvitation(accountId: string) {
  await db
    .insert(usageCounters)
    .values({ accountId, period: periodOf(), metric: METRIC, value: 1 })
    .onConflictDoUpdate({
      target: [usageCounters.accountId, usageCounters.period, usageCounters.metric],
      set: { value: sql`${usageCounters.value} + 1` },
    });
}

export function canInvite(tier: PlanTier, used: number) {
  const p = PLANS[tier];
  if (used < p.invitationsPerMonth) return { ok: true as const };
  return {
    ok: false as const,
    reason: `Your ${p.label} plan includes ${p.invitationsPerMonth} creator invitations a month, and you've sent ${used}.`,
    upgradeTo:
      (["starter", "growth", "agency", "enterprise"] as PlanTier[]).find(
        (t) => PLANS[t].invitationsPerMonth > p.invitationsPerMonth,
      ) ?? ("enterprise" as PlanTier),
  };
}

export async function rosterRow(campaignId: string, creatorId: number) {
  const [r] = await db
    .select({
      status: campaignCreators.status,
      feeUsd: campaignCreators.feeUsd,
      displayName: creators.displayName,
      handle: creators.handle,
    })
    .from(campaignCreators)
    .innerJoin(creators, eq(creators.id, campaignCreators.creatorId))
    .where(
      and(eq(campaignCreators.campaignId, campaignId), eq(campaignCreators.creatorId, creatorId)),
    );
  return r ?? null;
}

async function latestInvite(campaignId: string, creatorId: number) {
  const [i] = await db
    .select()
    .from(campaignInvites)
    .where(
      and(eq(campaignInvites.campaignId, campaignId), eq(campaignInvites.creatorId, creatorId)),
    )
    .orderBy(desc(campaignInvites.sentAt))
    .limit(1);
  return i ?? null;
}

/** Send, resend or revise an invitation. A new one supersedes any that is still waiting. */
export async function sendInvitation(o: {
  ws: Scope;
  slug: string;
  tier: PlanTier;
  actor: Actor;
  campaignId: string;
  creatorId: number;
  offeredUsd: unknown;
  message: string;
}): Promise<{ ok: true; link: string } | Fail> {
  const w = await workspaceOf(o.campaignId);
  if (!w || w.wsId !== o.ws.id) return fail("That campaign no longer exists.");
  if (!isOpen(w.campaign.status)) return fail("Re-open the campaign before inviting creators.");
  const row = await rosterRow(o.campaignId, o.creatorId);
  if (!row) return fail("That creator isn't on this campaign.");
  if (!(INVITABLE_FROM as readonly string[]).includes(row.status))
    return fail("This creator has already answered or is past the invitation stage.");
  const offer = checkOffer(o.offeredUsd);
  if (!offer.ok) return fail(offer.reason);
  const message = o.message.trim().slice(0, 2000);

  const gate = canInvite(o.tier, await invitationsUsed(o.ws.accountId));
  if (!gate.ok) {
    await trackServer(
      "Paywall Viewed",
      { userId: o.actor.id, workspaceId: o.ws.id },
      { paywall_trigger: "outreach_quota", required_plan: gate.upgradeTo },
    );
    return {
      ok: false,
      error: gate.reason,
      upgradeTo: gate.upgradeTo,
      upgradeLabel: PLANS[gate.upgradeTo].label,
    };
  }

  const now = simNow();
  const token = newToken();
  const expiresAt = expiryFrom(now);
  const previous = await db
    .select({ n: count() })
    .from(campaignInvites)
    .where(
      and(eq(campaignInvites.campaignId, o.campaignId), eq(campaignInvites.creatorId, o.creatorId)),
    );
  const round = (previous[0]?.n ?? 0) + 1;
  await db.transaction(async (tx) => {
    await tx
      .update(campaignInvites)
      .set({ status: "superseded" })
      .where(
        and(
          eq(campaignInvites.campaignId, o.campaignId),
          eq(campaignInvites.creatorId, o.creatorId),
          inArray(campaignInvites.status, ["sent", "countered"]),
        ),
      );
    await tx.insert(campaignInvites).values({
      campaignId: o.campaignId,
      creatorId: o.creatorId,
      token,
      offeredUsd: offer.usd,
      message:
        message ||
        defaultMessage({ brand: o.ws.name, campaign: w.campaign.name, creator: row.displayName }),
      sentBy: o.actor.id,
      sentAt: now,
      expiresAt,
    });
    if (row.status === "shortlisted")
      await tx
        .update(campaignCreators)
        .set({ status: "invited", statusChangedAt: now })
        .where(
          and(
            eq(campaignCreators.campaignId, o.campaignId),
            eq(campaignCreators.creatorId, o.creatorId),
          ),
        );
  });
  await countInvitation(o.ws.accountId);

  const body = invitationEmail({
    brand: o.ws.name,
    campaign: w.campaign.name,
    message:
      message ||
      defaultMessage({ brand: o.ws.name, campaign: w.campaign.name, creator: row.displayName }),
    offeredUsd: offer.usd,
    token,
    expiresOn: expiresAt.toISOString().slice(0, 10),
    revised: round > 1,
  });
  await sendEmail({ to: creatorAddress(row.handle), type: "outreach", ...body });
  await trackServer(
    "Creator Invitation Sent",
    { userId: o.actor.id, workspaceId: o.ws.id },
    { campaign_id: o.campaignId, creator_id: o.creatorId, offered_usd: offer.usd, round },
  );
  await audit({
    accountId: o.ws.accountId,
    workspaceId: o.ws.id,
    actorUserId: o.actor.id,
    action: "campaign.invitation_sent",
    targetType: "campaign",
    targetId: o.campaignId,
    meta: { creator: o.creatorId, offeredUsd: offer.usd, round },
  });
  return { ok: true, link: `${APP_URL}/creator/${token}` };
}

export async function revokeInvitation(o: {
  ws: Scope;
  actor: Actor;
  campaignId: string;
  creatorId: number;
}): Promise<{ ok: true } | Fail> {
  const w = await workspaceOf(o.campaignId);
  if (!w || w.wsId !== o.ws.id) return fail("That campaign no longer exists.");
  if (!isOpen(w.campaign.status)) return fail("Re-open the campaign before changing its creators.");
  const row = await rosterRow(o.campaignId, o.creatorId);
  const invite = row ? await latestInvite(o.campaignId, o.creatorId) : null;
  if (!row || !invite || !["sent", "countered"].includes(invite.status))
    return fail("There's no open invitation to withdraw.");
  await db
    .update(campaignInvites)
    .set({ status: "revoked" })
    .where(eq(campaignInvites.id, invite.id));
  if (row.status === "invited")
    await db
      .update(campaignCreators)
      .set({ status: "shortlisted", statusChangedAt: simNow() })
      .where(
        and(
          eq(campaignCreators.campaignId, o.campaignId),
          eq(campaignCreators.creatorId, o.creatorId),
        ),
      );
  await audit({
    accountId: o.ws.accountId,
    workspaceId: o.ws.id,
    actorUserId: o.actor.id,
    action: "campaign.invitation_withdrawn",
    targetType: "campaign",
    targetId: o.campaignId,
    meta: { creator: o.creatorId },
  });
  return { ok: true };
}

/** The brand's answer to a creator's counter-offer. */
export async function resolveCounter(o: {
  ws: Scope;
  slug: string;
  tier: PlanTier;
  actor: Actor;
  campaignId: string;
  creatorId: number;
  decision: "accept" | "revise" | "decline";
  revisedUsd?: unknown;
  message?: string;
}): Promise<{ ok: true } | Fail> {
  const w = await workspaceOf(o.campaignId);
  if (!w || w.wsId !== o.ws.id) return fail("That campaign no longer exists.");
  if (!isOpen(w.campaign.status)) return fail("Re-open the campaign before changing its creators.");
  const row = await rosterRow(o.campaignId, o.creatorId);
  const invite = row ? await latestInvite(o.campaignId, o.creatorId) : null;
  if (!row || !invite || invite.status !== "countered" || !invite.counterUsd)
    return fail("There's no counter-offer waiting for an answer.");
  const ctx = { actor: o.actor.id, ws: o.ws.id };
  const common = { campaign_id: o.campaignId, creator_id: o.creatorId };

  if (o.decision === "revise") {
    const sent = await sendInvitation({
      ws: o.ws,
      slug: o.slug,
      tier: o.tier,
      actor: o.actor,
      campaignId: o.campaignId,
      creatorId: o.creatorId,
      offeredUsd: o.revisedUsd,
      message: o.message ?? "",
    });
    if (!sent.ok) return sent;
    await trackServer(
      "Creator Counter Resolved",
      { userId: ctx.actor, workspaceId: ctx.ws },
      { ...common, decision: "revised" },
    );
    return { ok: true };
  }

  const now = simNow();
  if (o.decision === "accept") {
    await db.transaction(async (tx) => {
      await tx
        .update(campaignInvites)
        .set({ status: "accepted", respondedAt: now })
        .where(eq(campaignInvites.id, invite.id));
      await tx
        .update(campaignCreators)
        .set({ status: "confirmed", feeUsd: invite.counterUsd, statusChangedAt: now })
        .where(
          and(
            eq(campaignCreators.campaignId, o.campaignId),
            eq(campaignCreators.creatorId, o.creatorId),
          ),
        );
    });
    await ensureLink(o.campaignId, o.creatorId, "confirmed");
    await sendEmail({
      to: creatorAddress(row.handle),
      type: "outreach",
      ...creatorNotice("counter_accepted", {
        brand: o.ws.name,
        campaign: w.campaign.name,
        token: invite.token,
        usd: invite.counterUsd,
      }),
    });
  } else {
    await db.transaction(async (tx) => {
      await tx
        .update(campaignInvites)
        .set({ status: "declined", respondedAt: now })
        .where(eq(campaignInvites.id, invite.id));
      await tx
        .update(campaignCreators)
        .set({ status: "declined", statusChangedAt: now })
        .where(
          and(
            eq(campaignCreators.campaignId, o.campaignId),
            eq(campaignCreators.creatorId, o.creatorId),
          ),
        );
    });
    await sendEmail({
      to: creatorAddress(row.handle),
      type: "outreach",
      ...creatorNotice("counter_declined", {
        brand: o.ws.name,
        campaign: w.campaign.name,
        token: invite.token,
      }),
    });
  }
  await trackServer(
    "Creator Counter Resolved",
    { userId: ctx.actor, workspaceId: ctx.ws },
    { ...common, decision: o.decision === "accept" ? "accepted" : "declined" },
  );
  await audit({
    accountId: o.ws.accountId,
    workspaceId: o.ws.id,
    actorUserId: o.actor.id,
    action: `campaign.counter_${o.decision === "accept" ? "accepted" : "declined"}`,
    targetType: "campaign",
    targetId: o.campaignId,
    meta: { creator: o.creatorId, counterUsd: invite.counterUsd },
  });
  return { ok: true };
}

export async function reviewContent(o: {
  ws: Scope;
  actor: Actor;
  campaignId: string;
  creatorId: number;
  decision: "approve" | "changes";
  feedback: string;
}): Promise<{ ok: true } | Fail> {
  const w = await workspaceOf(o.campaignId);
  if (!w || w.wsId !== o.ws.id) return fail("That campaign no longer exists.");
  if (!isOpen(w.campaign.status)) return fail("Re-open the campaign before changing its creators.");
  const row = await rosterRow(o.campaignId, o.creatorId);
  if (!row || row.status !== "content_submitted")
    return fail("There's no content waiting for review.");
  const check = checkReview(o.decision, o.feedback);
  if (!check.ok) return fail(check.reason);
  const [content] = await db
    .select()
    .from(campaignContent)
    .where(
      and(eq(campaignContent.campaignId, o.campaignId), eq(campaignContent.creatorId, o.creatorId)),
    )
    .orderBy(desc(campaignContent.version))
    .limit(1);
  if (!content || content.status !== "submitted")
    return fail("There's no content waiting for review.");
  const now = simNow();
  const approved = o.decision === "approve";
  await db.transaction(async (tx) => {
    await tx
      .update(campaignContent)
      .set({
        status: approved ? "approved" : "changes_requested",
        feedback: check.feedback,
        reviewedAt: now,
        reviewedBy: o.actor.id,
      })
      .where(eq(campaignContent.id, content.id));
    await tx
      .update(campaignCreators)
      .set({ status: approved ? "approved" : "confirmed", statusChangedAt: now })
      .where(
        and(
          eq(campaignCreators.campaignId, o.campaignId),
          eq(campaignCreators.creatorId, o.creatorId),
        ),
      );
  });
  const invite = await acceptedInvite(o.campaignId, o.creatorId);
  if (invite)
    await sendEmail({
      to: creatorAddress(row.handle),
      type: "outreach",
      ...creatorNotice(approved ? "approved" : "changes", {
        brand: o.ws.name,
        campaign: w.campaign.name,
        token: invite.token,
        usd: row.feeUsd ?? undefined,
        feedback: check.feedback,
      }),
    });
  await trackServer(
    "Creator Content Reviewed",
    { userId: o.actor.id, workspaceId: o.ws.id },
    {
      campaign_id: o.campaignId,
      creator_id: o.creatorId,
      decision: approved ? "approved" : "changes_requested",
      version: content.version,
    },
  );
  await audit({
    accountId: o.ws.accountId,
    workspaceId: o.ws.id,
    actorUserId: o.actor.id,
    action: approved ? "campaign.content_approved" : "campaign.content_changes_requested",
    targetType: "campaign",
    targetId: o.campaignId,
    meta: { creator: o.creatorId, version: content.version },
  });
  return { ok: true };
}

export async function acceptedInvite(campaignId: string, creatorId: number) {
  const [i] = await db
    .select()
    .from(campaignInvites)
    .where(
      and(
        eq(campaignInvites.campaignId, campaignId),
        eq(campaignInvites.creatorId, creatorId),
        eq(campaignInvites.status, "accepted"),
      ),
    )
    .orderBy(desc(campaignInvites.sentAt))
    .limit(1);
  return i ?? null;
}

/** Tell the creator they've been paid (called when the brand marks the payment). */
export async function notifyPaid(o: { ws: Scope; campaignId: string; creatorId: number }) {
  const w = await workspaceOf(o.campaignId);
  const row = await rosterRow(o.campaignId, o.creatorId);
  const invite = await acceptedInvite(o.campaignId, o.creatorId);
  if (!w || !row || !invite) return;
  await sendEmail({
    to: creatorAddress(row.handle),
    type: "outreach",
    ...creatorNotice("paid", {
      brand: o.ws.name,
      campaign: w.campaign.name,
      token: invite.token,
      usd: row.feeUsd ?? undefined,
    }),
  });
}

// ---- The creator's side: everything below is reached with the link alone ----

export type PortalState =
  | "open"
  | "expired"
  | "countered"
  | "declined"
  | "superseded"
  | "revoked"
  | "confirmed" // accepted; content due
  | "in_review"
  | "approved"
  | "paid";

/** The creator's page. Deliberately leaves out the budget, the other creators and the brand's internal notes. */
export async function portalFor(token: string) {
  if (!isToken(token)) return null;
  const [i] = await db.select().from(campaignInvites).where(eq(campaignInvites.token, token));
  if (!i) return null;
  const w = await workspaceOf(i.campaignId);
  const row = await rosterRow(i.campaignId, i.creatorId);
  if (!w || !row) return null;
  const content = await db
    .select()
    .from(campaignContent)
    .where(
      and(eq(campaignContent.campaignId, i.campaignId), eq(campaignContent.creatorId, i.creatorId)),
    )
    .orderBy(desc(campaignContent.version));
  const invState = inviteState(i, simNow());
  let state: PortalState;
  if (invState === "accepted") {
    state =
      row.status === "paid"
        ? "paid"
        : row.status === "approved"
          ? "approved"
          : row.status === "content_submitted"
            ? "in_review"
            : row.status === "declined"
              ? "declined"
              : "confirmed";
  } else state = invState as PortalState;
  return {
    invite: i,
    state,
    brand: w.wsName,
    campaign: {
      id: w.campaign.id,
      name: w.campaign.name,
      objective: w.campaign.objective,
      brief: w.campaign.brief,
      startsOn: w.campaign.startsOn,
      endsOn: w.campaign.endsOn,
      open: isOpen(w.campaign.status),
    },
    creator: { id: i.creatorId, name: row.displayName, handle: row.handle },
    agreedUsd: row.feeUsd,
    content,
    workspaceId: w.wsId,
    accountId: w.accountId,
  };
}
export type Portal = NonNullable<Awaited<ReturnType<typeof portalFor>>>;

export async function markPortalViewed(p: Portal) {
  if (p.invite.viewedAt) return;
  const first = await db
    .update(campaignInvites)
    .set({ viewedAt: simNow() })
    .where(and(eq(campaignInvites.id, p.invite.id), sql`${campaignInvites.viewedAt} is null`))
    .returning({ id: campaignInvites.id });
  if (first.length)
    await trackServer(
      "Creator Portal Viewed",
      { workspaceId: p.workspaceId, accountId: p.accountId, creatorId: p.creator.id },
      { campaign_id: p.campaign.id, creator_id: p.creator.id, invite_state: p.state },
    );
}

async function notifyBrand(
  p: Portal,
  kind: "accepted" | "declined" | "countered" | "content",
  extra: { usd?: number; note?: string },
) {
  if (!p.invite.sentBy) return;
  const [u] = await db.select().from(users).where(eq(users.id, p.invite.sentBy));
  if (!u) return;
  const [ws] = await db
    .select({ slug: workspaces.slug })
    .from(workspaces)
    .where(eq(workspaces.id, p.workspaceId));
  await sendEmail({
    toUserId: u.id,
    to: u.email,
    type: "outreach",
    ...brandNotice(kind, {
      creator: p.creator.name,
      campaign: p.campaign.name,
      campaignUrl: campaignUrl(ws?.slug ?? "", p.campaign.id),
      ...extra,
    }),
  });
}

export async function respondToInvitation(
  token: string,
  kind: Response,
  input: { counterUsd?: unknown; note?: string },
): Promise<{ ok: true } | Fail> {
  const p = await portalFor(token);
  if (!p) return fail("We couldn't find that invitation.");
  if (!p.campaign.open) return fail("This campaign isn't taking responses any more.");
  const row = await rosterRow(p.campaign.id, p.creator.id);
  if (!row || !(ANSWERABLE_FROM as readonly string[]).includes(row.status))
    return fail("This invitation has already been answered.");
  const now = simNow();
  const check = checkResponse(p.invite, now, kind, input.counterUsd);
  if (!check.ok) return fail(check.reason);
  const note = (input.note ?? "").trim().slice(0, 1000);
  const next = kind === "accept" ? "accepted" : kind === "decline" ? "declined" : "countered";

  // The status condition makes a double-click or a second tab a no-op rather than a second answer.
  const claimed = await db
    .update(campaignInvites)
    .set({
      status: next,
      respondedAt: now,
      creatorNote: note,
      ...(kind === "counter" ? { counterUsd: check.counter } : {}),
    })
    .where(and(eq(campaignInvites.id, p.invite.id), eq(campaignInvites.status, "sent")))
    .returning({ id: campaignInvites.id });
  if (!claimed.length) return fail("You've already answered this invitation.");
  await db
    .update(campaignCreators)
    .set({
      status: STATUS_AFTER_RESPONSE[kind],
      statusChangedAt: now,
      ...(kind === "accept" ? { feeUsd: p.invite.offeredUsd } : {}),
    })
    .where(
      and(
        eq(campaignCreators.campaignId, p.campaign.id),
        eq(campaignCreators.creatorId, p.creator.id),
      ),
    );

  if (kind === "accept") await ensureLink(p.campaign.id, p.creator.id, "confirmed");
  await notifyBrand(
    p,
    kind === "accept" ? "accepted" : kind === "decline" ? "declined" : "countered",
    { usd: kind === "counter" ? check.counter : p.invite.offeredUsd, note },
  );
  await trackServer(
    "Creator Invitation Answered",
    { workspaceId: p.workspaceId, accountId: p.accountId, creatorId: p.creator.id },
    {
      campaign_id: p.campaign.id,
      creator_id: p.creator.id,
      response: next,
      counter_usd: kind === "counter" ? check.counter : undefined,
    },
  );
  return { ok: true };
}

export async function submitContent(
  token: string,
  url: string,
  caption: string,
): Promise<{ ok: true; version: number } | Fail> {
  const p = await portalFor(token);
  if (!p) return fail("We couldn't find that page.");
  if (!p.campaign.open) return fail("This campaign isn't taking submissions any more.");
  const row = await rosterRow(p.campaign.id, p.creator.id);
  if (
    !row ||
    !(SUBMITTABLE_FROM as readonly string[]).includes(row.status) ||
    p.invite.status !== "accepted"
  )
    return fail("You can submit content once you've accepted, and not while it's being reviewed.");
  // An agreement the brand sent has to be dealt with first: signed, or revised after the creator asked for changes.
  if (await contractOutstanding(p.campaign.id, p.creator.id))
    return fail("Sign your agreement before submitting content. It's on this page.");
  const check = checkSubmission(url, caption);
  if (!check.ok) return fail(check.reason);
  const version = (p.content[0]?.version ?? 0) + 1;
  const now = simNow();
  // Only the move out of "confirmed" counts, so two quick submissions can't both go through.
  const moved = await db
    .update(campaignCreators)
    .set({ status: "content_submitted", statusChangedAt: now })
    .where(
      and(
        eq(campaignCreators.campaignId, p.campaign.id),
        eq(campaignCreators.creatorId, p.creator.id),
        eq(campaignCreators.status, "confirmed"),
      ),
    )
    .returning({ id: campaignCreators.creatorId });
  if (!moved.length) return fail("Your content is already with the brand for review.");
  await db.insert(campaignContent).values({
    campaignId: p.campaign.id,
    creatorId: p.creator.id,
    version,
    url: check.url,
    caption: check.caption,
    submittedAt: now,
  });
  await notifyBrand(p, "content", {});
  await trackServer(
    "Creator Content Submitted",
    { workspaceId: p.workspaceId, accountId: p.accountId, creatorId: p.creator.id },
    { campaign_id: p.campaign.id, creator_id: p.creator.id, version },
  );
  return { ok: true, version };
}

/** What the creator's page shows, as plain data the page can hold and every action can hand back fresh. */
export interface PortalView {
  state: PortalState;
  brand: string;
  campaign: {
    name: string;
    objective: string;
    brief: string;
    startsOn: string | null;
    endsOn: string | null;
  };
  creator: { name: string; handle: string };
  offeredUsd: number;
  counterUsd: number | null;
  message: string;
  creatorNote: string;
  expiresAt: string;
  agreedUsd: number | null;
  /** The creator's own tracking link, once they're confirmed and the brand has set a landing page. */
  trackingLink: string | null;
  /** The agreement waiting for, or signed by, this creator. Filled in by portal-extras. */
  contract: {
    version: number;
    status: string;
    text: string;
    signedName: string | null;
    signedAt: string | null;
    requestNote: string;
  } | null;
  /** Payout details and the latest payout. `enabled` is false when the brand's plan can't pay from Ripplewise. */
  payout: {
    enabled: boolean;
    details: { holderName: string; last4: string; country: string } | null;
    latest: {
      status: string;
      amountUsd: number;
      reference: string;
      settleAt: string;
      failureReason: string;
    } | null;
  };
  content: {
    version: number;
    url: string;
    caption: string;
    status: string;
    feedback: string;
    submittedAt: string;
  }[];
}

export function portalView(p: Portal, trackingLink: string | null = null): PortalView {
  return {
    state: p.state,
    brand: p.brand,
    campaign: {
      name: p.campaign.name,
      objective: p.campaign.objective,
      brief: p.campaign.brief,
      startsOn: p.campaign.startsOn,
      endsOn: p.campaign.endsOn,
    },
    creator: { name: p.creator.name, handle: p.creator.handle },
    offeredUsd: p.invite.offeredUsd,
    counterUsd: p.invite.counterUsd,
    message: p.invite.message,
    creatorNote: p.invite.creatorNote,
    expiresAt: p.invite.expiresAt.toISOString(),
    agreedUsd: p.agreedUsd,
    trackingLink,
    contract: null,
    payout: { enabled: false, details: null, latest: null },
    content: p.content.map((c) => ({
      version: c.version,
      url: c.url,
      caption: c.caption,
      status: c.status,
      feedback: c.feedback,
      submittedAt: c.submittedAt.toISOString(),
    })),
  };
}

/** Only creators who've said yes get a link; it appears the moment the brand has set somewhere to send people. */
export async function trackingLinkOf(p: Portal): Promise<string | null> {
  if (!["confirmed", "in_review", "approved", "paid"].includes(p.state)) return null;
  const made = await ensureLink(p.campaign.id, p.creator.id, "confirmed");
  return made ? await linkFor(p.campaign.id, p.creator.id) : null;
}

export async function portalViewFor(token: string): Promise<PortalView | null> {
  const p = await portalFor(token);
  return p ? portalView(p, await trackingLinkOf(p)) : null;
}

/**
 * Reminds creators who haven't answered, once, shortly before their invitation lapses. Claiming the reminder is a
 * conditional update, so overlapping runs send it once. Only campaigns that are still open send reminders.
 */
export async function sendInvitationReminders(now: Date = simNow()): Promise<number> {
  const horizon = new Date(now.getTime() + REMINDER_DAYS_BEFORE * 86_400_000);
  const candidates = await db
    .select()
    .from(campaignInvites)
    .where(
      and(
        eq(campaignInvites.status, "sent"),
        isNull(campaignInvites.remindedAt),
        gt(campaignInvites.expiresAt, now),
        lte(campaignInvites.expiresAt, horizon),
      ),
    );
  let sent = 0;
  for (const i of candidates) {
    if (!reminderDue(i, now)) continue;
    const w = await workspaceOf(i.campaignId);
    const row = await rosterRow(i.campaignId, i.creatorId);
    if (!w || !row || !isOpen(w.campaign.status)) continue;
    const claimed = await db
      .update(campaignInvites)
      .set({ remindedAt: now })
      .where(
        and(
          eq(campaignInvites.id, i.id),
          eq(campaignInvites.status, "sent"),
          isNull(campaignInvites.remindedAt),
        ),
      )
      .returning({ id: campaignInvites.id });
    if (!claimed.length) continue;
    const daysLeft = Math.max(1, Math.ceil((i.expiresAt.getTime() - now.getTime()) / 86_400_000));
    await sendEmail({
      to: creatorAddress(row.handle),
      type: "outreach",
      ...reminderEmail({
        brand: w.wsName,
        campaign: w.campaign.name,
        offeredUsd: i.offeredUsd,
        token: i.token,
        expiresOn: i.expiresAt.toISOString().slice(0, 10),
        daysLeft,
      }),
    });
    await trackServer(
      "Creator Invitation Reminded",
      { workspaceId: w.wsId, accountId: w.accountId, system: true },
      { campaign_id: i.campaignId, creator_id: i.creatorId, days_left: daysLeft },
    );
    sent++;
  }
  return sent;
}
