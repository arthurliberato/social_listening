// Creator agreements. The brand sends one for a confirmed creator; the creator reads it on their own page and signs
// (a typed name and an explicit yes) or asks for changes; a revision replaces the old one. The text the creator saw
// is stored word for word with a hash, so what was signed can't change afterwards.
import { createHash } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { creatorContracts, db, users, workspaces } from "@/db/client";
import { trackServer } from "@/lib/analytics/server";
import { audit } from "@/lib/audit";
import { APP_URL, sendEmail } from "@/lib/email/service";
import { PLANS, planUnlocking, type PlanTier } from "@/lib/entitlements/plans";
import { simNow } from "@/lib/simclock";
import { latestContract } from "./contract-state";
import { checkSignature, checkTerms, renderContract, type Terms } from "./contract-flow";
import {
  acceptedInvite,
  fail,
  isOpen,
  portalFor,
  rosterRow,
  workspaceOf,
  type Actor,
  type Fail,
  type Portal,
  type Scope,
} from "./outreach";
import { creatorAddress } from "./outreach-flow";
import { portalLink } from "./outreach-emails";

const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const CONTRACTABLE = ["confirmed", "content_submitted", "approved"] as const;

/** Send the agreement for the first time, or a revised one that replaces it. */
export async function sendContract(o: {
  ws: Scope;
  tier: PlanTier;
  actor: Actor;
  campaignId: string;
  creatorId: number;
  terms: Partial<Record<keyof Terms, unknown>>;
}): Promise<{ ok: true } | Fail> {
  if (!PLANS[o.tier].features.creatorContracts) {
    const to = planUnlocking("creatorContracts");
    await trackServer(
      "Paywall Viewed",
      { userId: o.actor.id, workspaceId: o.ws.id },
      { paywall_trigger: "creator_contracts", required_plan: to },
    );
    return {
      ok: false,
      error: `Creator agreements are part of ${PLANS[to].label}.`,
      upgradeTo: to,
      upgradeLabel: PLANS[to].label,
    };
  }
  const w = await workspaceOf(o.campaignId);
  if (!w || w.wsId !== o.ws.id) return fail("That campaign no longer exists.");
  if (!isOpen(w.campaign.status)) return fail("Re-open the campaign before changing its creators.");
  const row = await rosterRow(o.campaignId, o.creatorId);
  if (!row) return fail("That creator isn't on this campaign.");
  if (!(CONTRACTABLE as readonly string[]).includes(row.status))
    return fail("An agreement can be sent once the creator is confirmed, and before they're paid.");
  if (!row.feeUsd || row.feeUsd <= 0)
    return fail("Set the agreed fee before sending an agreement.");
  const invite = await acceptedInvite(o.campaignId, o.creatorId);
  if (!invite)
    return fail("Invite the creator through Ripplewise first, so they have a page to sign on.");
  const check = checkTerms(o.terms);
  if (!check.ok) return fail(check.reason);
  const prev = await latestContract(o.campaignId, o.creatorId);
  if (prev?.status === "signed") return fail("The creator has already signed this agreement.");

  const body = renderContract({
    brand: o.ws.name,
    creator: row.displayName,
    campaign: w.campaign.name,
    feeUsd: row.feeUsd,
    terms: check.terms,
  });
  const version = (prev?.version ?? 0) + 1;
  await db.transaction(async (tx) => {
    await tx
      .update(creatorContracts)
      .set({ status: "superseded" })
      .where(
        and(
          eq(creatorContracts.campaignId, o.campaignId),
          eq(creatorContracts.creatorId, o.creatorId),
          inArray(creatorContracts.status, ["sent", "changes_requested"]),
        ),
      );
    await tx.insert(creatorContracts).values({
      campaignId: o.campaignId,
      creatorId: o.creatorId,
      version,
      terms: check.terms,
      feeUsd: row.feeUsd!,
      bodyText: body,
      bodyHash: hash(body),
      sentBy: o.actor.id,
      sentAt: simNow(),
    });
  });
  await sendEmail({
    to: creatorAddress(row.handle),
    type: "outreach",
    subject: `${o.ws.name} sent you an agreement for "${w.campaign.name}"`,
    text: `${o.ws.name} has put the terms for "${w.campaign.name}" in writing. Read them and sign, or ask for changes, on your page:\n${portalLink(invite.token)}\n\nYou can still submit content once you've signed.\n\nThis message was sent through Ripplewise on behalf of the brand.`,
  });
  await trackServer(
    "Creator Contract Sent",
    { userId: o.actor.id, workspaceId: o.ws.id },
    { campaign_id: o.campaignId, creator_id: o.creatorId, version, fee_usd: row.feeUsd },
  );
  await audit({
    accountId: o.ws.accountId,
    workspaceId: o.ws.id,
    actorUserId: o.actor.id,
    action: "campaign.contract_sent",
    targetType: "campaign",
    targetId: o.campaignId,
    meta: { creator: o.creatorId, version },
  });
  return { ok: true };
}

export async function withdrawContract(o: {
  ws: Scope;
  actor: Actor;
  campaignId: string;
  creatorId: number;
}): Promise<{ ok: true } | Fail> {
  const w = await workspaceOf(o.campaignId);
  if (!w || w.wsId !== o.ws.id) return fail("That campaign no longer exists.");
  if (!isOpen(w.campaign.status)) return fail("Re-open the campaign before changing its creators.");
  const c = await latestContract(o.campaignId, o.creatorId);
  if (!c || !["sent", "changes_requested"].includes(c.status))
    return fail("There's no unsigned agreement to withdraw.");
  await db
    .update(creatorContracts)
    .set({ status: "withdrawn" })
    .where(eq(creatorContracts.id, c.id));
  await audit({
    accountId: o.ws.accountId,
    workspaceId: o.ws.id,
    actorUserId: o.actor.id,
    action: "campaign.contract_withdrawn",
    targetType: "campaign",
    targetId: o.campaignId,
    meta: { creator: o.creatorId, version: c.version },
  });
  return { ok: true };
}

async function tellBrand(p: Portal, subject: string, text: string) {
  if (!p.invite.sentBy) return;
  const [u] = await db.select().from(users).where(eq(users.id, p.invite.sentBy));
  const [ws] = await db
    .select({ slug: workspaces.slug })
    .from(workspaces)
    .where(eq(workspaces.id, p.workspaceId));
  if (!u) return;
  await sendEmail({
    toUserId: u.id,
    to: u.email,
    type: "outreach",
    subject,
    text: `${text}\n\nOpen the campaign:\n${APP_URL}/w/${ws?.slug ?? ""}/creators/campaigns/${p.campaign.id}`,
  });
}

const ctxOf = (p: Portal) => ({
  workspaceId: p.workspaceId,
  accountId: p.accountId,
  creatorId: p.creator.id,
});

/** The creator signs from their page. Only an agreement still waiting for them can be signed, and only once. */
export async function signContract(
  token: string,
  name: string,
  agree: boolean,
): Promise<{ ok: true } | Fail> {
  const p = await portalFor(token);
  if (!p) return fail("We couldn't find that page.");
  if (!p.campaign.open) return fail("This campaign isn't taking responses any more.");
  const c = await latestContract(p.campaign.id, p.creator.id);
  if (!c || c.status !== "sent") return fail("There's no agreement waiting for your signature.");
  const sig = checkSignature(name, agree);
  if (!sig.ok) return fail(sig.reason);
  // Only a still-waiting agreement can be signed: a double-click or a second tab is a no-op.
  const claimed = await db
    .update(creatorContracts)
    .set({ status: "signed", signedName: sig.name, signedAt: simNow(), respondedAt: simNow() })
    .where(and(eq(creatorContracts.id, c.id), eq(creatorContracts.status, "sent")))
    .returning({ id: creatorContracts.id });
  if (!claimed.length) return fail("This agreement has already been answered.");
  await tellBrand(
    p,
    `${p.creator.name} signed the agreement for "${p.campaign.name}"`,
    `${p.creator.name} signed the agreement (version ${c.version}).`,
  );
  await trackServer("Creator Contract Signed", ctxOf(p), {
    campaign_id: p.campaign.id,
    creator_id: p.creator.id,
    version: c.version,
  });
  return { ok: true };
}

export async function requestContractChanges(
  token: string,
  note: string,
): Promise<{ ok: true } | Fail> {
  const p = await portalFor(token);
  if (!p) return fail("We couldn't find that page.");
  if (!p.campaign.open) return fail("This campaign isn't taking responses any more.");
  const c = await latestContract(p.campaign.id, p.creator.id);
  if (!c || c.status !== "sent") return fail("There's no agreement waiting for your answer.");
  const text = note.trim();
  if (text.length < 5)
    return fail("Say what you'd like changed, so the brand knows what to adjust.");
  if (text.length > 1500) return fail("Keep the note under 1,500 characters.");
  const claimed = await db
    .update(creatorContracts)
    .set({ status: "changes_requested", requestNote: text, respondedAt: simNow() })
    .where(and(eq(creatorContracts.id, c.id), eq(creatorContracts.status, "sent")))
    .returning({ id: creatorContracts.id });
  if (!claimed.length) return fail("This agreement has already been answered.");
  await tellBrand(
    p,
    `${p.creator.name} asked for changes to the agreement for "${p.campaign.name}"`,
    `${p.creator.name} didn't sign yet and asked for changes:\n\n${text}\n\nYou can revise the terms and send it again.`,
  );
  await trackServer("Creator Contract Changes Requested", ctxOf(p), {
    campaign_id: p.campaign.id,
    creator_id: p.creator.id,
    version: c.version,
  });
  return { ok: true };
}
