"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import { isRole, type Role } from "@/lib/permissions";
import {
  acceptInvite,
  inviteMembers,
  resendInvite,
  revokeInvite,
  type InviteResult,
} from "@/lib/team/invites";
import { changeRole, leaveWorkspace, removeMember } from "@/lib/team/members";
import { saveBranding, type Branding, type SaveBranding } from "@/lib/team/branding";
import { actorIn } from "@/lib/team/scope";
import {
  archiveWorkspace,
  createWorkspace,
  renameWorkspace,
  restoreWorkspace,
  WORKSPACE_TYPES,
  type WorkspaceType,
} from "@/lib/team/workspaces";
import type { PlanTier } from "@/lib/entitlements/plans";

type Fail = { ok: false; error: string; upgradeTo?: PlanTier };
const refresh = () => {
  revalidatePath("/settings/members");
  revalidatePath("/settings/workspaces");
};

async function acting(slug: string) {
  const user = await requireUser();
  const a = await actorIn(user.id, user.name, slug);
  return a ? { ...a, user } : null;
}
const NOPE: Fail = { ok: false, error: "You don't belong to that workspace." };

export async function invitePeopleAction(
  slug: string,
  emails: string,
  role: string,
): Promise<{ ok: true; results: InviteResult[]; upgradeTo?: PlanTier } | Fail> {
  const a = await acting(slug);
  if (!a) return NOPE;
  if (!isRole(role)) return { ok: false, error: "Choose a role." };
  const list = emails.split(/[\s,;]+/).filter(Boolean);
  if (!list.length) return { ok: false, error: "Enter at least one email address." };
  if (list.length > 50) return { ok: false, error: "Invite up to 50 people at a time." };
  const r = await inviteMembers({
    workspaceId: a.ws.id,
    actor: a.actor,
    emails: list,
    role,
    source: "settings",
  });
  refresh();
  return { ok: true, ...r };
}

export async function resendInviteAction(
  slug: string,
  inviteId: string,
): Promise<{ ok: true } | Fail> {
  const a = await acting(slug);
  if (!a) return NOPE;
  const r = await resendInvite({ workspaceId: a.ws.id, actor: a.actor, inviteId });
  refresh();
  return r;
}
export async function revokeInviteAction(
  slug: string,
  inviteId: string,
): Promise<{ ok: true } | Fail> {
  const a = await acting(slug);
  if (!a) return NOPE;
  const r = await revokeInvite({ workspaceId: a.ws.id, actor: a.actor, inviteId });
  refresh();
  return r;
}
export async function changeRoleAction(
  slug: string,
  userId: string,
  role: string,
): Promise<{ ok: true } | Fail> {
  const a = await acting(slug);
  if (!a) return NOPE;
  if (!isRole(role)) return { ok: false, error: "Choose a role." };
  const r = await changeRole({ workspaceId: a.ws.id, actor: a.actor, userId, role: role as Role });
  refresh();
  return r;
}
export async function removeMemberAction(
  slug: string,
  userId: string,
): Promise<{ ok: true } | Fail> {
  const a = await acting(slug);
  if (!a) return NOPE;
  const r = await removeMember({ workspaceId: a.ws.id, actor: a.actor, userId });
  refresh();
  return r;
}
export async function leaveWorkspaceAction(slug: string): Promise<{ ok: true } | Fail> {
  const a = await acting(slug);
  if (!a) return NOPE;
  const r = await leaveWorkspace({ workspaceId: a.ws.id, userId: a.user.id });
  refresh();
  return r;
}

const Create = z.object({
  name: z.string().max(200),
  type: z.enum(WORKSPACE_TYPES),
  copyFrom: z.string().uuid().nullable(),
});
export async function createWorkspaceAction(
  fromSlug: string,
  input: unknown,
): Promise<{ ok: true; slug: string } | Fail> {
  const a = await acting(fromSlug);
  if (!a) return NOPE;
  const p = Create.safeParse(input);
  if (!p.success) return { ok: false, error: "Check the name and type." };
  const r = await createWorkspace({
    accountId: a.ws.accountId,
    actor: a.actor,
    name: p.data.name,
    type: p.data.type as WorkspaceType,
    copyFromWorkspaceId: p.data.copyFrom,
  });
  refresh();
  return r.ok ? { ok: true, slug: r.slug } : r;
}
export async function renameWorkspaceAction(
  slug: string,
  name: string,
): Promise<{ ok: true } | Fail> {
  const a = await acting(slug);
  if (!a) return NOPE;
  const r = await renameWorkspace({ workspaceId: a.ws.id, actor: a.actor, name });
  refresh();
  return r;
}
export async function archiveWorkspaceAction(
  slug: string,
): Promise<{ ok: true; pausedQueries: number } | Fail> {
  const user = await requireUser();
  const a = await actorIn(user.id, user.name, slug);
  if (!a) return NOPE;
  const r = await archiveWorkspace({ workspaceId: a.ws.id, actor: a.actor });
  refresh();
  return r;
}
export async function restoreWorkspaceAction(slug: string): Promise<{ ok: true } | Fail> {
  const user = await requireUser();
  const a = await actorIn(user.id, user.name, slug);
  if (!a) return NOPE;
  const r = await restoreWorkspace({ workspaceId: a.ws.id, actor: a.actor });
  refresh();
  return r;
}

const Brand = z.object({
  displayName: z.string().max(200),
  accent: z.string().max(20),
  footerText: z.string().max(400),
  hidePoweredBy: z.boolean(),
});
export async function saveBrandingAction(slug: string, input: unknown): Promise<SaveBranding> {
  const a = await acting(slug);
  if (!a) return { ok: false, error: NOPE.error };
  const p = Brand.safeParse(input);
  if (!p.success) return { ok: false, error: "Check the branding fields." };
  const r = await saveBranding({
    workspaceId: a.ws.id,
    actor: a.actor,
    branding: p.data as Branding,
  });
  revalidatePath("/settings/branding");
  return r;
}

/** Accept an invitation as the signed-in user. */
export async function acceptInviteAction(
  token: string,
): Promise<
  { ok: true; slug: string; role: string } | { ok: false; error: "invalid" | "email_mismatch" }
> {
  const user = await requireUser();
  const r = await acceptInvite({ token, userId: user.id });
  if (!r.ok) return r;
  return { ok: true, slug: r.slug, role: r.role };
}
