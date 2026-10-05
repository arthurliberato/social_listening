// Who can do what, in one table. Pages, server actions and the UI all ask this module, so the role
// matrix is defined (and tested) once.
export const ROLES = ["owner", "admin", "editor", "viewer", "client_viewer"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABEL: Record<Role, string> = {
  owner: "Owner",
  admin: "Admin",
  editor: "Editor",
  viewer: "Viewer",
  client_viewer: "Client viewer",
};

export const ROLE_BLURB: Record<Role, string> = {
  owner: "Everything, including billing and removing admins. A workspace always has at least one.",
  admin: "Manages people, workspaces and billing, and everything an editor can do.",
  editor: "Creates and edits queries, dashboards, reports and alerts.",
  viewer: "Reads everything and can export, but can't change anything.",
  client_viewer: "Sees dashboards and reports only, with your branding. Doesn't use a seat.",
};

export type Capability =
  | "content.view" // mentions, queries, alerts, crisis rooms, authors, topics
  | "content.edit"
  | "dashboards.view"
  | "reports.view"
  | "export"
  | "members.view"
  | "members.manage"
  | "workspace.manage" // create, rename, archive workspaces
  | "billing.manage"
  | "audit.view"
  | "branding.manage";

const ALL: Role[] = ["owner", "admin", "editor", "viewer", "client_viewer"];
const STAFF: Role[] = ["owner", "admin", "editor", "viewer"];

export const MATRIX: Record<Capability, readonly Role[]> = {
  "content.view": STAFF,
  "content.edit": ["owner", "admin", "editor"],
  "dashboards.view": ALL,
  "reports.view": ALL,
  export: STAFF,
  "members.view": ["owner", "admin"],
  "members.manage": ["owner", "admin"],
  "workspace.manage": ["owner", "admin"],
  "billing.manage": ["owner", "admin"],
  "audit.view": ["owner", "admin"],
  "branding.manage": ["owner", "admin"],
};

export const isRole = (s: string): s is Role => (ROLES as readonly string[]).includes(s);
export const can = (role: string, cap: Capability): boolean =>
  isRole(role) && MATRIX[cap].includes(role);

/** The only parts of a workspace a client viewer may open. */
export const CLIENT_SECTIONS = ["dashboards", "reports"] as const;
export const clientMaySee = (section: string | undefined) =>
  !!section && (CLIENT_SECTIONS as readonly string[]).includes(section);

/** Roles a person may hand out. Admins can't create other admins or owners; only owners can. */
export function assignableRoles(actor: string): Role[] {
  if (actor === "owner") return [...ROLES];
  if (actor === "admin") return ["editor", "viewer", "client_viewer"];
  return [];
}

/**
 * Can `actor` change someone currently in `from` to `to` (or remove them, with `to` = null)?
 * Admins can only manage people below them; owners can manage anyone.
 */
export function canChangeRole(actor: string, from: string, to: string | null): boolean {
  if (!isRole(actor) || !isRole(from)) return false;
  if (actor === "owner") return to === null || isRole(to);
  if (actor === "admin")
    return (
      (from === "editor" || from === "viewer" || from === "client_viewer") &&
      (to === null || assignableRoles("admin").includes(to as Role))
    );
  return false;
}

/** Seats are for people who work in the product; client viewers are free. */
export const usesSeat = (role: string) => role !== "client_viewer";
