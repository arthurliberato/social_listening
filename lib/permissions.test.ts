import { describe, expect, it } from "vitest";
import {
  assignableRoles,
  can,
  canChangeRole,
  CLIENT_SECTIONS,
  clientMaySee,
  ROLES,
  usesSeat,
  type Capability,
  type Role,
} from "./permissions";

// The truth table, written out by hand. If the matrix changes, this test should have to change on purpose.
const EXPECTED: Record<Capability, Record<Role, boolean>> = {
  "content.view": { owner: true, admin: true, editor: true, viewer: true, client_viewer: false },
  "content.edit": { owner: true, admin: true, editor: true, viewer: false, client_viewer: false },
  "dashboards.view": { owner: true, admin: true, editor: true, viewer: true, client_viewer: true },
  "reports.view": { owner: true, admin: true, editor: true, viewer: true, client_viewer: true },
  export: { owner: true, admin: true, editor: true, viewer: true, client_viewer: false },
  "members.view": { owner: true, admin: true, editor: false, viewer: false, client_viewer: false },
  "members.manage": {
    owner: true,
    admin: true,
    editor: false,
    viewer: false,
    client_viewer: false,
  },
  "workspace.manage": {
    owner: true,
    admin: true,
    editor: false,
    viewer: false,
    client_viewer: false,
  },
  "billing.manage": {
    owner: true,
    admin: true,
    editor: false,
    viewer: false,
    client_viewer: false,
  },
  "audit.view": { owner: true, admin: true, editor: false, viewer: false, client_viewer: false },
  "branding.manage": {
    owner: true,
    admin: true,
    editor: false,
    viewer: false,
    client_viewer: false,
  },
};

describe("role matrix", () => {
  for (const cap of Object.keys(EXPECTED) as Capability[])
    for (const role of ROLES)
      it(`${role} ${EXPECTED[cap][role] ? "can" : "cannot"} ${cap}`, () => {
        expect(can(role, cap)).toBe(EXPECTED[cap][role]);
      });

  it("unknown roles can do nothing", () => {
    for (const cap of Object.keys(EXPECTED) as Capability[])
      expect(can("superuser", cap)).toBe(false);
  });

  it("client viewers see dashboards and reports and nothing else", () => {
    expect([...CLIENT_SECTIONS]).toEqual(["dashboards", "reports"]);
    for (const s of ["dashboards", "reports"]) expect(clientMaySee(s)).toBe(true);
    for (const s of [
      "mentions",
      "queries",
      "alerts",
      "crisis",
      "exports",
      "home",
      "authors",
      "ask",
      undefined,
    ])
      expect(clientMaySee(s)).toBe(false);
  });

  it("only client viewers are free", () => {
    expect(ROLES.filter((r) => !usesSeat(r))).toEqual(["client_viewer"]);
  });
});

describe("who can hand out and change roles", () => {
  it("owners can assign anything; admins only the roles below them; others nothing", () => {
    expect(assignableRoles("owner")).toEqual([...ROLES]);
    expect(assignableRoles("admin")).toEqual(["editor", "viewer", "client_viewer"]);
    for (const r of ["editor", "viewer", "client_viewer"]) expect(assignableRoles(r)).toEqual([]);
  });

  it("the full change-role grid", () => {
    const grid: [string, string, string | null, boolean][] = [
      // owner manages anyone, including other owners and removal
      ["owner", "owner", "admin", true],
      ["owner", "admin", "owner", true],
      ["owner", "viewer", null, true],
      // admin manages editor/viewer/client only, and can't promote past editor
      ["admin", "editor", "viewer", true],
      ["admin", "viewer", "editor", true],
      ["admin", "client_viewer", "viewer", true],
      ["admin", "editor", null, true],
      ["admin", "editor", "admin", false],
      ["admin", "viewer", "owner", false],
      ["admin", "admin", "editor", false],
      ["admin", "admin", null, false],
      ["admin", "owner", "editor", false],
      ["admin", "owner", null, false],
      // editors, viewers and client viewers manage no one
      ["editor", "viewer", "editor", false],
      ["editor", "viewer", null, false],
      ["viewer", "viewer", "editor", false],
      ["client_viewer", "viewer", null, false],
      // garbage in, no
      ["owner", "wizard", "admin", false],
    ];
    for (const [actor, from, to, ok] of grid)
      expect(canChangeRole(actor, from, to), `${actor}: ${from} → ${to}`).toBe(ok);
  });
});
