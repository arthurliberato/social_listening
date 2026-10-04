// The audit log: who did what, when. Call it from the server, after the change has been made.
import { auditLog, db } from "@/db/client";

export interface AuditEntry {
  accountId: string;
  workspaceId?: string | null;
  /** Null for the system (the billing clock, an expired invite). */
  actorUserId?: string | null;
  /** Dotted verb: member.invited, member.role_changed, workspace.archived, plan.upgraded... */
  action: string;
  targetType?: string;
  targetId?: string;
  /** Names, roles and plan names. Never secrets, tokens or card details. */
  meta?: Record<string, string | number | boolean | null>;
}

export async function audit(e: AuditEntry): Promise<void> {
  try {
    await db.insert(auditLog).values({
      accountId: e.accountId,
      workspaceId: e.workspaceId ?? null,
      actorUserId: e.actorUserId ?? null,
      action: e.action,
      targetType: e.targetType ?? null,
      targetId: e.targetId ?? null,
      meta: e.meta ?? {},
    });
  } catch (err) {
    // An audit write must never break the action it describes, but it must not vanish silently either.
    console.error("[audit] failed to record", e.action, err);
  }
}

/** How an entry reads in the log. */
export const AUDIT_LABEL: Record<string, string> = {
  "member.invited": "Invited a teammate",
  "member.invite_resent": "Resent an invitation",
  "member.invite_revoked": "Cancelled an invitation",
  "member.joined": "Joined a workspace",
  "member.role_changed": "Changed someone's role",
  "member.removed": "Removed someone",
  "member.left": "Left a workspace",
  "workspace.created": "Created a workspace",
  "workspace.renamed": "Renamed a workspace",
  "workspace.archived": "Archived a workspace",
  "workspace.restored": "Restored a workspace",
  "branding.updated": "Changed white-label settings",
  "plan.subscribed": "Started a plan",
  "plan.upgraded": "Upgraded the plan",
  "plan.downgrade_scheduled": "Scheduled a downgrade",
  "plan.canceled": "Cancelled the plan",
  "plan.resumed": "Resumed the plan",
  "card.updated": "Updated the payment card",
  "dashboard.shared_publicly": "Turned on a public dashboard link",
  "dashboard.unshared": "Turned off a public dashboard link",
};
