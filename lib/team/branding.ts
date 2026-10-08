// White-label: what clients see instead of "Ripplewise". Only applies on plans that include it, so a
// downgrade quietly puts the default branding back without losing the saved settings.
import { eq } from "drizzle-orm";
import { accounts, db, workspaceBranding, workspaces } from "@/db/client";
import { audit } from "@/lib/audit";
import { limits, type PlanTier } from "@/lib/entitlements/plans";
import { can } from "@/lib/permissions";
import { contrastOnWhite, isHex, MIN_CONTRAST, NO_BRANDING, type Branding } from "./contrast";
import type { Actor } from "./invites";
import { simNow } from "@/lib/simclock";

export type { Branding };
export { NO_BRANDING };

/** The branding to show right now: saved settings, if the plan includes white-label. */
export async function effectiveBranding(workspaceId: string): Promise<Branding> {
  const [row] = await db
    .select({ b: workspaceBranding, tier: accounts.planTier })
    .from(workspaces)
    .innerJoin(accounts, eq(accounts.id, workspaces.accountId))
    .leftJoin(workspaceBranding, eq(workspaceBranding.workspaceId, workspaces.id))
    .where(eq(workspaces.id, workspaceId));
  if (!row?.b || !limits(row.tier as PlanTier).features.whiteLabel) return NO_BRANDING;
  return {
    displayName: row.b.displayName,
    accent: row.b.accent,
    footerText: row.b.footerText,
    hidePoweredBy: row.b.hidePoweredBy,
  };
}

export async function savedBranding(workspaceId: string): Promise<Branding> {
  const [b] = await db
    .select()
    .from(workspaceBranding)
    .where(eq(workspaceBranding.workspaceId, workspaceId));
  return b
    ? {
        displayName: b.displayName,
        accent: b.accent,
        footerText: b.footerText,
        hidePoweredBy: b.hidePoweredBy,
      }
    : NO_BRANDING;
}

export type SaveBranding =
  { ok: true } | { ok: false; error: string; field?: keyof Branding; upgrade?: boolean };

export async function saveBranding(o: {
  workspaceId: string;
  actor: Actor;
  branding: Branding;
}): Promise<SaveBranding> {
  if (!can(o.actor.role, "branding.manage"))
    return { ok: false, error: "Your role can't change branding." };
  const [ws] = await db
    .select({ accountId: workspaces.accountId, tier: accounts.planTier })
    .from(workspaces)
    .innerJoin(accounts, eq(accounts.id, workspaces.accountId))
    .where(eq(workspaces.id, o.workspaceId));
  if (!ws) return { ok: false, error: "That workspace no longer exists." };
  if (!limits(ws.tier as PlanTier).features.whiteLabel)
    return { ok: false, error: "White-label is included from the Agency plan.", upgrade: true };
  const b = {
    displayName: o.branding.displayName.trim(),
    accent: o.branding.accent.trim(),
    footerText: o.branding.footerText.trim(),
    hidePoweredBy: o.branding.hidePoweredBy,
  };
  if (b.displayName.length > 60)
    return { ok: false, error: "Keep the brand name under 60 characters.", field: "displayName" };
  if (b.footerText.length > 160)
    return { ok: false, error: "Keep the footer under 160 characters.", field: "footerText" };
  if (b.accent) {
    if (!isHex(b.accent))
      return { ok: false, error: "Use a colour like #1f6feb.", field: "accent" };
    const c = contrastOnWhite(b.accent);
    if (c < MIN_CONTRAST)
      return {
        ok: false,
        error: `White text on that colour has a contrast of ${c.toFixed(1)}:1; it needs at least ${MIN_CONTRAST}:1 to be readable. Choose a darker shade.`,
        field: "accent",
      };
  }
  await db
    .insert(workspaceBranding)
    .values({ workspaceId: o.workspaceId, ...b, updatedAt: simNow() })
    .onConflictDoUpdate({
      target: workspaceBranding.workspaceId,
      set: { ...b, updatedAt: simNow() },
    });
  await audit({
    accountId: ws.accountId,
    workspaceId: o.workspaceId,
    actorUserId: o.actor.id,
    action: "branding.updated",
    targetType: "workspace",
    targetId: o.workspaceId,
    meta: { display_name: b.displayName, hide_powered_by: b.hidePoweredBy },
  });
  return { ok: true };
}
