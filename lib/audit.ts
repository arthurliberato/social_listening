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

/** Record an action by someone working in a workspace. Names are trimmed so a long title can't bloat the log. */
export function auditIn(
  ws: { id: string; accountId: string },
  actorUserId: string | null,
  action: string,
  target?: { type: string; id: string },
  meta?: Record<string, string | number | boolean | null>,
): Promise<void> {
  const clean = meta
    ? Object.fromEntries(
        Object.entries(meta).map(([k, v]) => [k, typeof v === "string" ? v.slice(0, 120) : v]),
      )
    : undefined;
  return audit({
    accountId: ws.accountId,
    workspaceId: ws.id,
    actorUserId,
    action,
    targetType: target?.type,
    targetId: target?.id,
    meta: clean,
  });
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
  "contract.signed": "Signed an Enterprise contract",
  "query.created": "Created a query",
  "query.updated": "Edited a query",
  "query.paused": "Paused a query",
  "query.resumed": "Resumed a query",
  "query.deleted": "Deleted a query",
  "category.created": "Created a category",
  "category.deleted": "Deleted a category",
  "dashboard.created": "Created a dashboard",
  "dashboard.updated": "Saved changes to a dashboard",
  "dashboard.duplicated": "Duplicated a dashboard",
  "dashboard.deleted": "Deleted a dashboard",
  "report.created": "Created a report",
  "report.updated": "Saved changes to a report",
  "report.deleted": "Deleted a report",
  "report.section_added": "Added a section to a report",
  "report.scheduled": "Scheduled a report",
  "report.schedule_stopped": "Stopped a report schedule",
  "alert.created": "Created an alert",
  "alert.muted": "Muted an alert",
  "alert.unmuted": "Unmuted an alert",
  "alert.deleted": "Deleted an alert",
  "crisis.opened": "Opened a crisis room",
  "crisis.update_sent": "Sent a stakeholder update",
  "crisis.resolved": "Resolved a crisis room",
  "crisis.reopened": "Reopened a crisis room",
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
    case "query.paused":
    case "query.resumed":
    case "query.deleted":
    case "query.created":
    case "dashboard.created":
    case "dashboard.duplicated":
    case "dashboard.deleted":
    case "report.created":
    case "report.updated":
    case "report.deleted":
    case "report.schedule_stopped":
    case "alert.muted":
    case "alert.unmuted":
    case "alert.deleted":
    case "crisis.opened":
    case "crisis.resolved":
    case "crisis.reopened":
      return m("name") || m("title");
    case "report.section_added":
      return `${m("name")}: ${m("section")}`;
    case "query.updated":
      return `${m("name")}${meta.search_changed ? " (search terms changed)" : ""}`;
    case "dashboard.updated":
      return `${m("name")}, ${m("widgets")} widgets`;
    case "alert.created":
      return `${m("name")} (${m("type").replace("_", " ")})`;
    case "report.scheduled":
      return `${m("name")}: ${m("frequency")}, ${m("members")} teammates${Number(meta.external) ? ` and ${m("external")} outside addresses` : ""}`;
    case "crisis.update_sent":
      return `${m("title")}: sent to ${m("recipients")} people`;
    case "contract.signed":
      return `${m("seats")} seats, ${m("term_months")} months`;
    default:
      return "";
  }
}

export const AUDIT_CATEGORIES: Record<string, { label: string; prefixes: string[] }> = {
  all: { label: "Everything", prefixes: [] },
  people: { label: "People and invitations", prefixes: ["member."] },
  workspaces: { label: "Workspaces", prefixes: ["workspace."] },
  billing: { label: "Plan and billing", prefixes: ["plan.", "card.", "contract."] },
  content: {
    label: "Queries, dashboards and reports",
    prefixes: [
      "query.",
      "category.",
      "dashboard.created",
      "dashboard.updated",
      "dashboard.duplicated",
      "dashboard.deleted",
      "report.",
    ],
  },
  alerts: { label: "Alerts and crisis rooms", prefixes: ["alert.", "crisis."] },
  sharing: {
    label: "Sharing and branding",
    prefixes: ["dashboard.shared", "dashboard.unshared", "branding."],
  },
};
