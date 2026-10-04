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

/** One line of detail for an entry, built only from what was recorded. */
export function auditDetail(
  action: string,
  meta: Record<string, unknown>,
  target: string | null,
): string {
  const m = (k: string) => (meta[k] === undefined || meta[k] === null ? "" : String(meta[k]));
  switch (action) {
    case "member.invited":
    case "member.invite_resent":
    case "member.invite_revoked":
      return `${target ?? ""}${m("role") ? ` as ${m("role").replace("_", " ")}` : ""}`;
    case "member.role_changed":
      return `${m("name")}: ${m("from").replace("_", " ")} → ${m("to").replace("_", " ")}`;
    case "member.removed":
    case "member.left":
      return `${m("name")} (${m("role").replace("_", " ")})`;
    case "member.joined":
      return m("role") ? `as ${m("role").replace("_", " ")}` : "";
    case "workspace.created":
      return `${m("name")}${meta.copied ? " (copied layouts)" : ""}`;
    case "workspace.renamed":
      return `${m("from")} → ${m("to")}`;
    case "workspace.archived":
      return `${m("name")}${meta.paused_queries ? `, ${m("paused_queries")} queries paused` : ""}`;
    case "workspace.restored":
      return m("name");
    case "branding.updated":
      return m("display_name") ? `Brand name: ${m("display_name")}` : "";
    case "plan.subscribed":
    case "plan.upgraded":
    case "plan.downgrade_scheduled":
      return `${m("plan")} (${m("interval")})`;
    case "plan.canceled":
      return m("reason").replace("_", " ");
    case "dashboard.shared_publicly":
    case "dashboard.unshared":
      return m("name");
    default:
      return "";
  }
}

export const AUDIT_CATEGORIES: Record<string, { label: string; prefixes: string[] }> = {
  all: { label: "Everything", prefixes: [] },
  people: { label: "People and invitations", prefixes: ["member."] },
  workspaces: { label: "Workspaces", prefixes: ["workspace."] },
  billing: { label: "Plan and billing", prefixes: ["plan.", "card."] },
  sharing: { label: "Sharing and branding", prefixes: ["dashboard.", "branding."] },
};
