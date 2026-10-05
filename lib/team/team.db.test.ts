import { and, eq, sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import {
  accounts,
  auditLog,
  db,
  emails,
  invitations,
  memberships,
  pool,
  users,
  workspaces,
} from "@/db/client";
import { hashToken } from "@/lib/auth/tokens";
import { acceptInvite, inviteMembers, resendInvite, revokeInvite } from "./invites";
import { changeRole, leaveWorkspace, listInvites, removeMember } from "./members";
import { seatUsage } from "./seats";

afterAll(() => pool.end());

const rnd = () => Math.random().toString(36).slice(2, 9);
type U = typeof users.$inferSelect;

async function fixture(plan: "growth" | "agency" | "starter" = "growth") {
  const [a] = await db
    .insert(accounts)
    .values({ name: "team", planTier: plan, billingStatus: "active" })
    .returning();
  const mkWs = async (name: string) =>
    (
      await db
        .insert(workspaces)
        .values({ accountId: a!.id, name, slug: `tm-${rnd()}` })
        .returning()
    )[0]!;
  const w1 = await mkWs("Main");
  const mkUser = async (role: string, ws = w1) => {
    const [u] = await db
      .insert(users)
      .values({
        email: `${role}-${rnd()}@example.test`,
        passwordHash: "x",
        name: role[0]!.toUpperCase() + role.slice(1),
      })
      .returning();
    await db
      .insert(memberships)
      .values({ userId: u!.id, workspaceId: ws.id, accountId: a!.id, role });
    return u!;
  };
  const owner = await mkUser("owner");
  return { a: a!, w1, mkWs, mkUser, owner };
}
const actor = (u: U, role: string) => ({ id: u.id, name: u.name, role });
const tokenFromMail = async (to: string) => {
  const m = (
    await db
      .select()
      .from(emails)
      .where(eq(emails.toAddress, to))
      .orderBy(sql`created_at DESC`)
  )[0]!;
  return {
    token: /\/invite\/([A-Za-z0-9_-]+)/.exec(m.bodyText)![1]!,
    body: m.bodyText,
    subject: m.subject,
  };
};
const log = async (accountId: string) =>
  (
    await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.accountId, accountId))
      .orderBy(sql`seq`)
  ).map((r) => r.action);
const events = async (userId: string, name: string) =>
  Number(
    (
      await db.execute(
        sql`SELECT count(*)::int AS n FROM analytics_events WHERE user_id = ${userId}::uuid AND name = ${name}`,
      )
    ).rows[0]!.n,
  );

describe("seats", () => {
  it("counts a person once across workspaces, includes pending invites, and client viewers are free", async () => {
    const f = await fixture();
    const w2 = await f.mkWs("Second");
    const editor = await f.mkUser("editor");
    await db
      .insert(memberships)
      .values({ userId: editor.id, workspaceId: w2.id, accountId: f.a.id, role: "viewer" }); // same person, second workspace
    const client = await f.mkUser("client_viewer");
    await db
      .insert(memberships)
      .values({ userId: client.id, workspaceId: w2.id, accountId: f.a.id, role: "client_viewer" });
    expect(await seatUsage(f.a.id)).toEqual({ members: 2, pending: 0, clientViewers: 1, used: 2 });

    await inviteMembers({
      workspaceId: f.w1.id,
      actor: actor(f.owner, "owner"),
      emails: ["new@example.test"],
      role: "editor",
      source: "settings",
    });
    await inviteMembers({
      workspaceId: f.w1.id,
      actor: actor(f.owner, "owner"),
      emails: ["client2@example.test"],
      role: "client_viewer",
      source: "settings",
    });
    expect(await seatUsage(f.a.id)).toMatchObject({ members: 2, pending: 1, used: 3 }); // the client invite costs nothing
    // Inviting someone who already holds a seat to another workspace takes no second seat.
    await inviteMembers({
      workspaceId: w2.id,
      actor: actor(f.owner, "owner"),
      emails: [editor.email],
      role: "editor",
      source: "settings",
    });
    expect((await seatUsage(f.a.id)).used).toBe(3);
  });
});

describe("inviting", () => {
  it("sends a link to /invite/<token> naming the role, audits it, and refuses duplicates and nonsense", async () => {
    const f = await fixture();
    const r = await inviteMembers({
      workspaceId: f.w1.id,
      actor: actor(f.owner, "owner"),
      emails: ["Pat@Example.test", "pat@example.test", "nope", f.owner.email],
      role: "editor",
      source: "settings",
    });
    expect(r.results.map((x) => [x.email, x.status])).toEqual([
      ["pat@example.test", "sent"],
      ["nope", "invalid"],
      [f.owner.email, "already_member"],
    ]);
    const mail = await tokenFromMail("pat@example.test");
    expect(mail.subject).toContain("invited you to Main");
    expect(mail.body).toContain("as an editor");
    const again = await inviteMembers({
      workspaceId: f.w1.id,
      actor: actor(f.owner, "owner"),
      emails: ["pat@example.test"],
      role: "editor",
      source: "settings",
    });
    expect(again.results[0]!.status).toBe("already_invited");
    expect(await log(f.a.id)).toEqual(["member.invited"]);
    expect(await events(f.owner.id, "Teammate Invited")).toBe(1);
    const pending = await listInvites(f.w1.id);
    expect(pending.map((p) => [p.email, p.role])).toEqual([["pat@example.test", "editor"]]);
  });

  it("who may invite whom: admins can't create admins, editors can't invite at all", async () => {
    const f = await fixture();
    const admin = await f.mkUser("admin");
    const editor = await f.mkUser("editor");
    const go = (
      u: U,
      role: string,
      as: "admin" | "editor" | "viewer" | "client_viewer" | "owner",
    ) =>
      inviteMembers({
        workspaceId: f.w1.id,
        actor: actor(u, role),
        emails: [`x-${rnd()}@example.test`],
        role: as,
        source: "settings",
      });
    expect((await go(admin, "admin", "editor")).results[0]!.status).toBe("sent");
    expect((await go(admin, "admin", "client_viewer")).results[0]!.status).toBe("sent");
    expect((await go(admin, "admin", "admin")).results[0]!.status).toBe("role_not_allowed");
    expect((await go(admin, "admin", "owner")).results[0]!.status).toBe("role_not_allowed");
    expect((await go(editor, "editor", "viewer")).results[0]!.status).toBe("role_not_allowed");
    expect((await go(f.owner, "owner", "admin")).results[0]!.status).toBe("sent");
  });

  it("stops at the plan's seats and says which plan fixes it; client viewers still go through", async () => {
    const f = await fixture("starter"); // 1 seat, the owner has it
    const full = await inviteMembers({
      workspaceId: f.w1.id,
      actor: actor(f.owner, "owner"),
      emails: ["a@example.test"],
      role: "editor",
      source: "settings",
    });
    expect(full.results[0]).toMatchObject({ status: "seat_limit" });
    expect(full.results[0]!.reason).toContain("Upgrade to");
    expect(full.upgradeTo).toBeDefined();
    const client = await inviteMembers({
      workspaceId: f.w1.id,
      actor: actor(f.owner, "owner"),
      emails: ["c@example.test"],
      role: "client_viewer",
      source: "settings",
    });
    expect(client.results[0]!.status).toBe("sent");
    expect(await events(f.owner.id, "Paywall Viewed")).toBe(1);
  });
});

describe("accepting", () => {
  it("an existing user joins with the invited role; tokens are single-use; the wrong address is refused", async () => {
    const f = await fixture();
    const w2 = await f.mkWs("Second");
    const [pat] = await db
      .insert(users)
      .values({ email: `pat-${rnd()}@example.test`, passwordHash: "x", name: "Pat" })
      .returning();
    await db
      .insert(memberships)
      .values({ userId: pat!.id, workspaceId: w2.id, accountId: f.a.id, role: "editor" });
    await inviteMembers({
      workspaceId: f.w1.id,
      actor: actor(f.owner, "owner"),
      emails: [pat!.email],
      role: "viewer",
      source: "settings",
    });
    const { token } = await tokenFromMail(pat!.email);

    const [stranger] = await db
      .insert(users)
      .values({ email: `s-${rnd()}@example.test`, passwordHash: "x", name: "S" })
      .returning();
    expect(await acceptInvite({ token, userId: stranger!.id })).toEqual({
      ok: false,
      error: "email_mismatch",
    });
    expect(await acceptInvite({ token: "nonsense", userId: pat!.id })).toEqual({
      ok: false,
      error: "invalid",
    });

    const r = await acceptInvite({ token, userId: pat!.id });
    expect(r).toMatchObject({ ok: true, role: "viewer", slug: f.w1.slug, already: false });
    const [m] = await db
      .select()
      .from(memberships)
      .where(and(eq(memberships.userId, pat!.id), eq(memberships.workspaceId, f.w1.id)));
    expect(m!.role).toBe("viewer");
    expect(await acceptInvite({ token, userId: pat!.id })).toEqual({ ok: false, error: "invalid" }); // used
    expect(await listInvites(f.w1.id)).toEqual([]);
    expect(await events(pat!.id, "Invite Accepted")).toBe(1);
    expect(await events(pat!.id, "Seat Added")).toBe(1);
    expect(await log(f.a.id)).toEqual(["member.invited", "member.joined"]);
  });

  it("an expired invitation can't be accepted, and a client viewer acceptance fires its own event", async () => {
    const f = await fixture();
    const [pat] = await db
      .insert(users)
      .values({ email: `pat-${rnd()}@example.test`, passwordHash: "x", name: "Pat" })
      .returning();
    await inviteMembers({
      workspaceId: f.w1.id,
      actor: actor(f.owner, "owner"),
      emails: [pat!.email],
      role: "client_viewer",
      source: "settings",
    });
    const { token } = await tokenFromMail(pat!.email);
    await db
      .update(invitations)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(invitations.tokenHash, hashToken(token)));
    expect(await acceptInvite({ token, userId: pat!.id })).toEqual({ ok: false, error: "invalid" });

    await resendInvite({
      workspaceId: f.w1.id,
      actor: actor(f.owner, "owner"),
      inviteId: (await db.select().from(invitations).where(eq(invitations.email, pat!.email)))[0]!
        .id,
    });
    const fresh = await tokenFromMail(pat!.email);
    expect(fresh.token).not.toBe(token); // a resend replaces the link
    expect(await acceptInvite({ token, userId: pat!.id })).toEqual({ ok: false, error: "invalid" });
    expect(await acceptInvite({ token: fresh.token, userId: pat!.id })).toMatchObject({
      ok: true,
      role: "client_viewer",
    });
    expect(await events(pat!.id, "Client Viewer Added")).toBe(1);
    expect(await events(pat!.id, "Seat Added")).toBe(0); // free
  });

  it("revoking kills the link", async () => {
    const f = await fixture();
    const gone = `gone-${rnd()}@example.test`;
    await inviteMembers({
      workspaceId: f.w1.id,
      actor: actor(f.owner, "owner"),
      emails: [gone],
      role: "editor",
      source: "settings",
    });
    const { token } = await tokenFromMail(gone);
    const [inv] = await listInvites(f.w1.id);
    expect(
      await revokeInvite({
        workspaceId: f.w1.id,
        actor: actor(f.owner, "owner"),
        inviteId: inv!.id,
      }),
    ).toEqual({ ok: true });
    expect(
      await revokeInvite({
        workspaceId: f.w1.id,
        actor: actor(f.owner, "owner"),
        inviteId: inv!.id,
      }),
    ).toMatchObject({ ok: false });
    const [stranger] = await db
      .insert(users)
      .values({ email: gone, passwordHash: "x", name: "G" })
      .returning();
    expect(await acceptInvite({ token, userId: stranger!.id })).toEqual({
      ok: false,
      error: "invalid",
    });
    expect(await log(f.a.id)).toEqual(["member.invited", "member.invite_revoked"]);
  });
});

describe("changing and removing people", () => {
  it("follows the role matrix, never leaves a workspace without an owner, and audits each change", async () => {
    const f = await fixture();
    const admin = await f.mkUser("admin");
    const editor = await f.mkUser("editor");
    const viewer = await f.mkUser("viewer");
    const A = actor(admin, "admin");
    const O = actor(f.owner, "owner");
    const E = actor(editor, "editor");
    const role = async (u: U) =>
      (
        await db
          .select()
          .from(memberships)
          .where(and(eq(memberships.userId, u.id), eq(memberships.workspaceId, f.w1.id)))
      )[0]?.role;

    expect(
      await changeRole({ workspaceId: f.w1.id, actor: E, userId: viewer.id, role: "editor" }),
    ).toMatchObject({ ok: false });
    expect(
      await changeRole({ workspaceId: f.w1.id, actor: A, userId: viewer.id, role: "editor" }),
    ).toEqual({ ok: true });
    expect(await role(viewer)).toBe("editor");
    expect(
      await changeRole({ workspaceId: f.w1.id, actor: A, userId: editor.id, role: "admin" }),
    ).toMatchObject({ ok: false }); // can't promote to admin
    expect(
      await changeRole({ workspaceId: f.w1.id, actor: A, userId: f.owner.id, role: "viewer" }),
    ).toMatchObject({ ok: false }); // can't touch the owner
    expect(
      await changeRole({ workspaceId: f.w1.id, actor: A, userId: admin.id, role: "viewer" }),
    ).toMatchObject({ ok: false }); // or other admins, or yourself
    expect(
      await changeRole({ workspaceId: f.w1.id, actor: O, userId: editor.id, role: "admin" }),
    ).toEqual({ ok: true });

    // The only owner can't be demoted or removed or leave...
    expect(
      await changeRole({ workspaceId: f.w1.id, actor: O, userId: f.owner.id, role: "admin" }),
    ).toMatchObject({ ok: false, error: expect.stringContaining("needs an owner") });
    expect(
      await removeMember({ workspaceId: f.w1.id, actor: A, userId: f.owner.id }),
    ).toMatchObject({ ok: false });
    expect(await leaveWorkspace({ workspaceId: f.w1.id, userId: f.owner.id })).toMatchObject({
      ok: false,
    }); // (also their only workspace)
    // ...until there is a second one.
    expect(
      await changeRole({ workspaceId: f.w1.id, actor: O, userId: admin.id, role: "owner" }),
    ).toEqual({ ok: true });
    expect(
      await changeRole({ workspaceId: f.w1.id, actor: O, userId: f.owner.id, role: "admin" }),
    ).toEqual({ ok: true });

    // Removal: admins remove editors and below, not admins; nobody removes themselves this way.
    const O2 = actor(admin, "owner");
    expect(await removeMember({ workspaceId: f.w1.id, actor: O2, userId: admin.id })).toMatchObject(
      { ok: false },
    );
    expect(
      await removeMember({
        workspaceId: f.w1.id,
        actor: actor(f.owner, "admin"),
        userId: viewer.id,
      }),
    ).toEqual({ ok: true });
    expect(await role(viewer)).toBeUndefined();
    expect(
      await removeMember({
        workspaceId: f.w1.id,
        actor: actor(f.owner, "admin"),
        userId: viewer.id,
      }),
    ).toMatchObject({ ok: false }); // already gone

    expect(await log(f.a.id)).toEqual([
      "member.role_changed",
      "member.role_changed",
      "member.role_changed",
      "member.role_changed",
      "member.removed",
    ]);
    const meta = (
      await db
        .select()
        .from(auditLog)
        .where(and(eq(auditLog.accountId, f.a.id), eq(auditLog.action, "member.removed")))
    )[0]!;
    expect(meta.meta).toMatchObject({ role: "editor" }); // promoted earlier in this test
    expect(meta.actorUserId).toBe(f.owner.id);
  });

  it("promoting a client viewer to a working role needs a free seat", async () => {
    const f = await fixture("starter"); // 1 seat, taken
    const client = await f.mkUser("client_viewer");
    const r = await changeRole({
      workspaceId: f.w1.id,
      actor: actor(f.owner, "owner"),
      userId: client.id,
      role: "editor",
    });
    expect(r).toMatchObject({ ok: false, upgradeTo: expect.any(String) });
    expect(
      (await db.select().from(memberships).where(eq(memberships.userId, client.id)))[0]!.role,
    ).toBe("client_viewer");
  });

  it("leaving a workspace works when you have another one", async () => {
    const f = await fixture();
    const w2 = await f.mkWs("Second");
    const editor = await f.mkUser("editor");
    await db
      .insert(memberships)
      .values({ userId: editor.id, workspaceId: w2.id, accountId: f.a.id, role: "editor" });
    expect(await leaveWorkspace({ workspaceId: f.w1.id, userId: editor.id })).toEqual({ ok: true });
    expect(await leaveWorkspace({ workspaceId: w2.id, userId: editor.id })).toMatchObject({
      ok: false,
      error: expect.stringContaining("only workspace"),
    });
  });
});
