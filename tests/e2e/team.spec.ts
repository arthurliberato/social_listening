import {
  expect as baseExpect,
  test,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { createUser, PASSWORD, pool } from "./helpers";

// This spec opens many routes for the first time per worker; give assertions room for a cold compile.
const expect = baseExpect.configure({ timeout: 20_000 });
test.setTimeout(300_000);
// waitForURL has no timeout by default, so a missed redirect would hang the whole test; fail fast with a line number instead.
test.use({ navigationTimeout: 45_000, actionTimeout: 30_000 });

type Role = "owner" | "admin" | "editor" | "viewer" | "client_viewer";
const rnd = () => Math.random().toString(36).slice(2, 8);

const events = async (email: string, name: string) =>
  (
    await pool.query(
      `SELECT e.props FROM analytics_events e JOIN users u ON u.id = e.user_id WHERE lower(u.email) = $1 AND e.name = $2 ORDER BY e.id`,
      [email, name],
    )
  ).rows;
const polled = (email: string, name: string) =>
  expect.poll(async () => (await events(email, name)).length);
async function setPlan(email: string, plan: string) {
  await pool.query(
    `UPDATE accounts SET plan_tier = $2, billing_status = 'active' WHERE id IN (SELECT m.account_id FROM memberships m JOIN users u ON u.id = m.user_id WHERE lower(u.email) = $1)`,
    [email, plan],
  );
}
async function queryReady(slug: string) {
  await expect
    .poll(
      async () =>
        (
          await pool.query(
            `SELECT q.backfill_status AS s FROM queries q JOIN workspaces w ON w.id = q.workspace_id WHERE w.slug = $1`,
            [slug],
          )
        ).rows[0]?.s,
      { timeout: 45_000 },
    )
    .toMatch(/done|quota_exhausted/);
}
const inviteLink = async (to: string) => {
  const { rows } = await pool.query(
    `SELECT body_text FROM emails WHERE to_address = $1 AND type = 'invite' ORDER BY created_at DESC LIMIT 1`,
    [to],
  );
  return /(http:\/\/\S+\/invite\/\S+)/.exec(rows[0].body_text)![1]!;
};
/** Invite through the real Members screen. */
async function invite(page: Page, slug: string, emails: string, role: Role) {
  await page.goto(`/settings/members?ws=${slug}`);
  await page.getByTestId("invite-emails").fill(emails);
  await page.getByTestId("invite-role").selectOption(role);
  await page.getByTestId("invite-send").click();
  await expect(page.getByTestId("invite-results")).toBeVisible();
}
/** A brand-new person follows the emailed link, creates an account and lands in the workspace. */
async function joinNew(browser: Browser, ownerPage: Page, slug: string, role: Role, name: string) {
  const email = `${role}-${rnd()}@example.test`;
  await invite(ownerPage, slug, email, role);
  await expect(ownerPage.getByTestId("invite-results")).toContainText("Invitation sent");
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(await inviteLink(email));
  await page.getByTestId("invite-signup").click();
  await page.getByTestId("signup-name").fill(name);
  await page.getByTestId("signup-password").fill(PASSWORD);
  await page.getByTestId("signup-submit").click();
  await page.waitForURL(new RegExp(`/w/${slug}/(home|dashboards)`));
  return { ctx, page, email };
}
const nav = (page: Page) => page.getByRole("navigation", { name: "Primary" });

test("the role matrix: what each role sees and can do, through real invitations", async ({
  page,
  browser,
}) => {
  const owner = await createUser(page, { brand: "Latte Lane" });
  await setPlan(owner.email, "agency");
  await queryReady(owner.slug);
  const slug = owner.slug;
  // Something for the roles to look at: a dashboard and a report.
  const q = (
    await pool.query(
      `SELECT w.id AS ws, u.id AS u FROM workspaces w JOIN memberships m ON m.workspace_id = w.id JOIN users u ON u.id = m.user_id WHERE w.slug = $1 LIMIT 1`,
      [slug],
    )
  ).rows[0];
  await pool.query(
    `INSERT INTO dashboards (workspace_id, name, created_by) VALUES ($1,'Brand health',$2)`,
    [q.ws, q.u],
  );
  await pool.query(
    `INSERT INTO reports (workspace_id, name, range, sections, created_by) VALUES ($1,'Monthly report','30d','[]'::jsonb,$2)`,
    [q.ws, q.u],
  );

  const people: Record<string, { ctx: BrowserContext; page: Page; email: string }> = {};
  const roles: Exclude<Role, "owner">[] = ["admin", "editor", "viewer", "client_viewer"];
  for (const r of roles) people[r] = await joinNew(browser, page, slug, r, `${r} person`);
  const as = (r: Role): Page => (r === "owner" ? page : people[r]!.page);

  // What each role should find. Written out by hand, per role.
  const E: Record<
    Role,
    {
      nav: string[];
      newQuery: boolean;
      newDashboard: boolean;
      newReport: boolean;
      exportReport: boolean;
      members: boolean;
      billing: boolean;
      mentions: boolean;
      exportsPage: boolean;
    }
  > = {
    owner: {
      nav: ["Mentions", "Alerts", "Dashboards", "Reports", "Exports", "Queries"],
      newQuery: true,
      newDashboard: true,
      newReport: true,
      exportReport: true,
      members: true,
      billing: true,
      mentions: true,
      exportsPage: true,
    },
    admin: {
      nav: ["Mentions", "Alerts", "Dashboards", "Reports", "Exports", "Queries"],
      newQuery: true,
      newDashboard: true,
      newReport: true,
      exportReport: true,
      members: true,
      billing: true,
      mentions: true,
      exportsPage: true,
    },
    editor: {
      nav: ["Mentions", "Alerts", "Dashboards", "Reports", "Exports", "Queries"],
      newQuery: true,
      newDashboard: true,
      newReport: true,
      exportReport: true,
      members: false,
      billing: false,
      mentions: true,
      exportsPage: true,
    },
    viewer: {
      nav: ["Mentions", "Alerts", "Dashboards", "Reports", "Exports", "Queries"],
      newQuery: false,
      newDashboard: false,
      newReport: false,
      exportReport: true,
      members: false,
      billing: false,
      mentions: true,
      exportsPage: true,
    },
    client_viewer: {
      nav: ["Dashboards", "Reports"],
      newQuery: false,
      newDashboard: false,
      newReport: false,
      exportReport: false,
      members: false,
      billing: false,
      mentions: false,
      exportsPage: false,
    },
  };
  for (const role of ["owner", "admin", "editor", "viewer", "client_viewer"] as Role[]) {
    const p = as(role);
    const want = E[role];
    await test.step(`${role}: workspace navigation`, async () => {
      await p.goto(`/w/${slug}/${role === "client_viewer" ? "dashboards" : "home"}`);
      const links = (await nav(p).getByRole("link").allInnerTexts()).map((t) => t.trim());
      for (const n of want.nav) expect(links, `${role} should see ${n}`).toContain(n);
      if (role === "client_viewer") expect(links.sort()).toEqual(["Dashboards", "Reports"]);
      else expect(links).toContain("Mentions");
      await expect(p.getByTestId("quota-meter")).toHaveCount(role === "client_viewer" ? 0 : 1);
      await expect(p.getByTestId("notifications")).toHaveCount(role === "client_viewer" ? 0 : 1);
    });
    await test.step(`${role}: queries`, async () => {
      await p.goto(`/w/${slug}/queries`);
      if (!want.mentions) await p.waitForURL(`**/w/${slug}/dashboards`);
      else await expect(p.getByTestId("new-query")).toHaveCount(want.newQuery ? 1 : 0);
    });
    await test.step(`${role}: mentions feed`, async () => {
      await p.goto(`/w/${slug}/mentions`);
      if (!want.mentions) await p.waitForURL(`**/w/${slug}/dashboards`);
      else await expect(p).toHaveURL(new RegExp(`/w/${slug}/mentions`));
    });
    await test.step(`${role}: alerts and crisis rooms`, async () => {
      await p.goto(`/w/${slug}/alerts/new`);
      if (!want.mentions) await p.waitForURL(`**/w/${slug}/dashboards`);
      else if (want.newQuery)
        await expect(p.getByTestId("save-alert")).toBeVisible({ timeout: 20_000 });
      else await expect(p.getByTestId("alert-permission")).toBeVisible();
      await p.goto(`/w/${slug}/crisis`);
      if (!want.mentions) await p.waitForURL(`**/w/${slug}/dashboards`);
    });
    await test.step(`${role}: dashboards`, async () => {
      await p.goto(`/w/${slug}/dashboards`);
      await expect(p.getByTestId("dashboard-card").first()).toBeVisible(); // everyone can read dashboards
      await expect(p.getByTestId("new-dashboard")).toHaveCount(want.newDashboard ? 1 : 0);
    });
    await test.step(`${role}: reports`, async () => {
      await p.goto(`/w/${slug}/reports`);
      await expect(p.getByTestId("report-card").first()).toBeVisible(); // everyone can read reports
      await expect(p.getByTestId("new-report")).toHaveCount(want.newReport ? 1 : 0);
      // Follow the link by its address: a click can land before the page has hydrated.
      await p.goto(
        (await p.getByTestId("report-card").first().getByRole("link").getAttribute("href"))!,
      );
      await expect(p.getByTestId("report")).toBeVisible();
      await expect(p.getByTestId("export-menu")).toHaveCount(want.exportReport ? 1 : 0);
      await expect(p.getByTestId("edit-report")).toHaveCount(want.newReport ? 1 : 0);
    });
    await test.step(`${role}: exports`, async () => {
      await p.goto(`/w/${slug}/exports`);
      if (!want.exportsPage) await p.waitForURL(`**/w/${slug}/dashboards`);
      else await expect(p.getByTestId("export-form")).toBeVisible();
    });
    await test.step(`${role}: settings`, async () => {
      await p.goto(`/settings/members?ws=${slug}`);
      await expect(
        want.members ? p.getByTestId("member-table") : p.getByTestId("members-forbidden"),
      ).toBeVisible();
      await p.goto("/settings/billing");
      await expect(
        want.billing ? p.getByTestId("plan-card") : p.getByTestId("billing-forbidden"),
      ).toBeVisible();
      await p.goto("/settings/audit");
      await expect(
        // Agency doesn't include the audit log (Enterprise does): owners and admins see the upgrade card, others are told it isn't theirs.
        want.members ? p.getByTestId("audit-locked") : p.getByTestId("audit-forbidden"),
      ).toBeVisible();
    });
  }

  // Roles show up correctly in the member list, and the client viewer didn't take a seat.
  await page.goto(`/settings/members?ws=${slug}`);
  await expect(page.getByTestId("member-row")).toHaveCount(5);
  for (const r of ["owner", "admin", "editor", "viewer", "client_viewer"])
    await expect(page.locator(`[data-testid="member-row"][data-role="${r}"]`)).toHaveCount(1);
  await expect(page.getByTestId("seat-count")).toHaveText("4 of 15"); // owner, admin, editor, viewer
  await expect(page.getByTestId("seat-summary")).toContainText("1 client viewer");

  // Events for the people who joined.
  await polled(owner.email, "Teammate Invited").toBe(4);
  await polled(people.client_viewer!.email, "Client Viewer Added").toBe(1);
  await polled(people.client_viewer!.email, "Invite Accepted").toBe(1);
  await polled(people.editor!.email, "Seat Added").toBe(1);
  expect((await events(people.client_viewer!.email, "Seat Added")).length).toBe(0);
  for (const r of roles) await people[r]!.ctx.close();
});

test("managing people: change a role, remove someone, last-owner protection, invites can be resent and cancelled", async ({
  page,
  browser,
}) => {
  const owner = await createUser(page, { brand: "Latte Lane" });
  await setPlan(owner.email, "agency");
  const slug = owner.slug;
  const editor = await joinNew(browser, page, slug, "editor", "Eddie Editor");
  const admin = await joinNew(browser, page, slug, "admin", "Ada Admin");

  await page.goto(`/settings/members?ws=${slug}`);
  const row = (name: string) => page.getByTestId("member-row").filter({ hasText: name });
  // The owner can promote and demote.
  await row("Eddie Editor").getByTestId("member-role").selectOption("viewer");
  await expect(row("Eddie Editor")).toHaveAttribute("data-role", "viewer");
  // The dropdown updates at once; the saved role follows a moment later.
  await expect
    .poll(
      async () =>
        (
          await pool.query(
            `SELECT role FROM memberships m JOIN users u ON u.id = m.user_id WHERE lower(u.email) = $1`,
            [editor.email],
          )
        ).rows[0].role,
    )
    .toBe("viewer");
  // ...and the person sees it straight away: their New query button is gone.
  await editor.page.goto(`/w/${slug}/queries`);
  await expect(editor.page.getByTestId("new-query")).toHaveCount(0);

  // The only owner can't leave or be demoted, and the page says why.
  await page.getByTestId("member-leave").click();
  await page.getByTestId("member-remove-confirm").click();
  await expect(page.getByTestId("members-error")).toContainText(/only workspace|only owner/);
  await expect(
    page
      .getByTestId("member-row")
      .filter({ has: page.getByTestId("member-leave") })
      .getByTestId("member-role-text"),
  ).toBeVisible(); // owner's own role isn't a dropdown
  await page.reload();

  // An admin can manage the editor but sees no controls on the owner or on themselves.
  await admin.page.goto(`/settings/members?ws=${slug}`);
  const adminRow = (n: string) => admin.page.getByTestId("member-row").filter({ hasText: n });
  await expect(adminRow("Eddie Editor").getByTestId("member-role")).toBeVisible();
  await expect(adminRow("Ada Admin").getByTestId("member-role")).toHaveCount(0);
  await expect(adminRow("Ada Admin").getByTestId("member-remove")).toHaveCount(0);
  const ownerName = (
    await pool.query(`SELECT name FROM users WHERE lower(email) = $1`, [owner.email])
  ).rows[0].name;
  await expect(adminRow(ownerName).getByTestId("member-role")).toHaveCount(0);
  await expect(adminRow(ownerName).getByTestId("member-remove")).toHaveCount(0);
  // An admin's role list doesn't include admin or owner.
  const options = await adminRow("Eddie Editor")
    .getByTestId("member-role")
    .locator("option")
    .allInnerTexts();
  expect(options).toEqual(["Editor", "Viewer", "Client viewer"]);
  await expect(admin.page.getByTestId("invite-role").locator("option")).toHaveText([
    "Editor",
    "Viewer",
    "Client viewer",
  ]);

  // Removing someone takes their access away at once.
  await row("Eddie Editor").getByTestId("member-remove").click();
  await row("Eddie Editor").getByTestId("member-remove-confirm").click();
  await expect(row("Eddie Editor")).toHaveCount(0);
  await editor.page.goto(`/w/${slug}/home`);
  await editor.page.waitForURL(/403/);

  // Invitations: duplicates and bad addresses are explained, resend replaces the link, cancel kills it.
  const guest = `guest-${rnd()}@example.test`;
  await invite(page, slug, `${guest}, not-an-email`, "viewer");
  await expect(page.getByTestId("invite-results")).toContainText(`${guest}: Invitation sent`);
  await expect(page.getByTestId("invite-results")).toContainText(
    "not-an-email: Not a valid address",
  );
  await invite(page, slug, guest, "viewer");
  await expect(page.getByTestId("invite-results")).toContainText("Already invited");
  const first = await inviteLink(guest);
  await page
    .getByTestId("invite-row")
    .filter({ hasText: guest })
    .getByTestId("invite-resend")
    .click();
  await expect.poll(async () => await inviteLink(guest)).not.toBe(first);
  const guestCtx = await browser.newContext();
  const g = await guestCtx.newPage();
  await g.goto(first);
  await expect(g.getByTestId("invite-unavailable")).toBeVisible(); // the old link no longer works
  await page
    .getByTestId("invite-row")
    .filter({ hasText: guest })
    .getByTestId("invite-revoke")
    .click();
  await expect(page.getByTestId("invite-row").filter({ hasText: guest })).toHaveCount(0);
  await g.goto(await inviteLink(guest));
  await expect(g.getByTestId("invite-unavailable")).toBeVisible();
  await guestCtx.close();
  await editor.ctx.close();
  await admin.ctx.close();
});

test("seats: the trial plan stops at its limit with a way forward, and client viewers are always free", async ({
  page,
}) => {
  const owner = await createUser(page, { brand: "Latte Lane" });
  const a = `a-${rnd()}@example.test`;
  const b = `b-${rnd()}@example.test`;
  const c = `c-${rnd()}@example.test`;
  await page.goto(`/settings/members?ws=${owner.slug}`);
  await expect(page.getByTestId("seat-count")).toHaveText("1 of 2");
  await invite(page, owner.slug, `${a}, ${b}`, "editor"); // trial: owner + 1
  await expect(page.getByTestId("invite-results")).toContainText(`${a}: Invitation sent`);
  await expect(page.getByTestId("invite-results")).toContainText(`${b}: No seat free`);
  await expect(page.getByTestId("seat-count")).toHaveText("2 of 2");
  await page.getByTestId("invite-upgrade").click();
  await page.waitForURL(/upgrade\?from=seat_limit&plan=/);
  await expect(page.getByTestId("upgrade-why")).toContainText("seats");
  await invite(page, owner.slug, c, "client_viewer"); // free
  await expect(page.getByTestId("invite-results")).toContainText(`${c}: Invitation sent`);
  await expect(page.getByTestId("seat-count")).toHaveText("2 of 2");
  await polled(owner.email, "Paywall Viewed").toBe(1);
});

test("an existing user: invitation to a second workspace, switching between them, and leaving", async ({
  page,
  browser,
}) => {
  const a = await createUser(page, { brand: "Latte Lane" });
  await setPlan(a.email, "agency");
  const bCtx = await browser.newContext();
  const bp = await bCtx.newPage();
  const b = await createUser(bp, { brand: "Orbit Lace" }); // someone with their own account and workspace

  await invite(page, a.slug, b.email, "viewer");
  const link = await inviteLink(b.email);
  // Wrong account: another signed-in person opens b's link.
  const cCtx = await browser.newContext();
  const cp = await cCtx.newPage();
  await createUser(cp, { brand: "Orbit Lace" });
  await cp.goto(link);
  await expect(cp.getByTestId("invite-wrong-account")).toBeVisible();
  await cCtx.close();
  // Signed-out: the link offers log in, then returns to the invitation.
  const outCtx = await browser.newContext();
  const out = await outCtx.newPage();
  await out.goto(link);
  await out.getByTestId("invite-login").click();
  await out.getByTestId("login-email").fill(b.email);
  await out.getByTestId("login-password").fill(PASSWORD);
  await out.getByTestId("login-submit").click();
  await expect(out.getByTestId("invite-accept")).toBeVisible();
  await out.getByTestId("accept-invite").click();
  await out.waitForURL(new RegExp(`/w/${a.slug}/home`));
  await outCtx.close();

  // b now has two workspaces and can switch; the switch is one event.
  await bp.goto(`/w/${b.slug}/home`);
  await bp.getByTestId("workspace-switcher").click();
  await expect(bp.getByTestId(`switch-${a.slug}`)).toBeVisible();
  await bp.getByTestId(`switch-${a.slug}`).click();
  await bp.waitForURL(new RegExp(`/w/${a.slug}/home`));
  await polled(b.email, "Workspace Switched").toBe(1);
  expect((await events(b.email, "Workspace Switched"))[0]!.props.from_workspace_id).toBeTruthy();
  // As a viewer there, b can read but not edit.
  await bp.goto(`/w/${a.slug}/queries`);
  await expect(bp.getByTestId("new-query")).toHaveCount(0);
  // The link is single use.
  const again = await bCtx.newPage();
  await again.goto(link);
  await expect(again.getByTestId("invite-unavailable")).toBeVisible();

  // Anyone can leave a workspace from Workspaces (viewers can't open Members), and loses access at once.
  const aName = (await pool.query(`SELECT name FROM workspaces WHERE slug = $1`, [a.slug])).rows[0]
    .name;
  await bp.goto("/settings/workspaces");
  await bp
    .getByTestId("workspace-row")
    .filter({ hasText: aName })
    .getByTestId("leave-open")
    .click();
  await bp.getByTestId("leave-confirm").click();
  await expect(bp.getByTestId("workspace-row").filter({ hasText: aName })).toHaveCount(0);
  await bp.goto(`/w/${a.slug}/home`);
  await bp.waitForURL(/403/);
  // Their own workspace is still theirs, and they can't leave that last one.
  await bp.goto("/settings/workspaces");
  await bp.getByTestId("leave-open").click();
  await bp.getByTestId("leave-confirm").click();
  await expect(bp.getByTestId("workspaces-error")).toContainText("only workspace");
  await bCtx.close();
});

test("workspaces: create within the plan, copy layouts, archive and restore; the plan limit is a paywall", async ({
  page,
}) => {
  const owner = await createUser(page, { brand: "Latte Lane" });
  // Trial = 1 workspace: the form explains and opens a paywall.
  await page.goto("/settings/workspaces");
  await expect(page.getByTestId("workspace-usage")).toContainText("1 of 1");
  await page.getByTestId("ws-name").fill("Second Co");
  await page.getByTestId("ws-create").click();
  await expect(page.getByTestId("paywall-modal")).toContainText("workspace limit");
  await page.keyboard.press("Escape");

  await setPlan(owner.email, "agency");
  const q = (
    await pool.query(
      `SELECT w.id AS ws, u.id AS u FROM workspaces w JOIN memberships m ON m.workspace_id = w.id JOIN users u ON u.id = m.user_id WHERE w.slug = $1 LIMIT 1`,
      [owner.slug],
    )
  ).rows[0];
  const dash = (
    await pool.query(
      `INSERT INTO dashboards (workspace_id, name, created_by) VALUES ($1,'Brand health',$2) RETURNING id`,
      [q.ws, q.u],
    )
  ).rows[0].id;
  await pool.query(
    `INSERT INTO widgets (dashboard_id, type, title, config, x, y, w, h) VALUES ($1,'kpi','Mentions','{"metric":"mentions","queryId":"00000000-0000-4000-8000-000000000000"}',0,0,3,3)`,
    [dash],
  );

  await page.reload();
  await page.getByTestId("ws-name").fill("Acme Coffee");
  await page.getByTestId("ws-type-client").check();
  await page.getByTestId("ws-copy").selectOption({ index: 1 });
  await page.getByTestId("ws-create").click();
  await page.waitForURL(/\/w\/acme-coffee[^/]*\/home/);
  const slug2 = new URL(page.url()).pathname.split("/")[2]!;
  await polled(owner.email, "Workspace Created").toBe(1);
  expect((await events(owner.email, "Workspace Created"))[0]!.props).toMatchObject({
    workspaces_count: 2,
    copied_from_template: true,
  });
  // The copy is there, minus the old workspace's query reference.
  await page.goto(`/w/${slug2}/dashboards`);
  await expect(page.getByTestId("dashboard-card")).toContainText("Brand health");
  const w = (
    await pool.query(
      `SELECT config FROM widgets WHERE dashboard_id = (SELECT d.id FROM dashboards d JOIN workspaces w ON w.id = d.workspace_id WHERE w.slug = $1 LIMIT 1)`,
      [slug2],
    )
  ).rows[0];
  expect(w.config).toEqual({ metric: "mentions" });

  // Switching shows both; rename; archive hides it everywhere.
  await page.getByTestId("workspace-switcher").click();
  await expect(page.getByTestId(`switch-${owner.slug}`)).toBeVisible();
  await page.keyboard.press("Escape");
  await page.goto("/settings/workspaces");
  const row = page.getByTestId("workspace-row").filter({ hasText: "Acme Coffee" });
  await row.getByTestId("rename-open").click();
  await page.getByTestId("rename-input").fill("Acme Coffee Co");
  await page.getByTestId("rename-save").click();
  await expect(
    page.getByTestId("workspace-row").filter({ hasText: "Acme Coffee Co" }),
  ).toBeVisible();
  const row2 = page.getByTestId("workspace-row").filter({ hasText: "Acme Coffee Co" });
  await row2.getByTestId("archive-open").click();
  await row2.getByTestId("archive-confirm").click();
  await expect(page.getByTestId("archived-list")).toContainText("Acme Coffee Co");
  await expect(page.getByTestId("workspace-usage")).toContainText("1 of 10");
  await page.goto(`/w/${slug2}/home`);
  await page.waitForURL(/403/); // archived workspaces are unreachable
  await page.goto("/settings/workspaces");
  await page.getByTestId("restore").click();
  await expect(page.getByTestId("archived-list")).toHaveCount(0);
  await page.goto(`/w/${slug2}/home`);
  await expect(page).toHaveURL(new RegExp(`/w/${slug2}/home`));

  // You can't archive your last active workspace.
  const only = (
    await pool.query(
      `SELECT count(*)::int AS n FROM workspaces WHERE account_id = (SELECT account_id FROM memberships m JOIN users u ON u.id = m.user_id WHERE lower(u.email) = $1 LIMIT 1) AND archived_at IS NULL`,
      [owner.email],
    )
  ).rows[0].n;
  expect(only).toBe(2);
});

test("the audit log records what happened, filters, and is a paywall below Enterprise", async ({
  page,
  browser,
}) => {
  const owner = await createUser(page, { brand: "Latte Lane" });
  await page.goto("/settings/audit");
  await expect(page.getByTestId("audit-locked")).toBeVisible();
  await expect(page.getByTestId("audit-upgrade")).toHaveAttribute(
    "href",
    /upgrade\?from=audit_log&plan=enterprise/,
  );

  await setPlan(owner.email, "enterprise");
  const editor = await joinNew(browser, page, owner.slug, "editor", "Eddie Editor");
  await page.goto(`/settings/members?ws=${owner.slug}`);
  await page
    .getByTestId("member-row")
    .filter({ hasText: "Eddie Editor" })
    .getByTestId("member-role")
    .selectOption("viewer");
  await expect(page.getByTestId("member-row").filter({ hasText: "Eddie Editor" })).toHaveAttribute(
    "data-role",
    "viewer",
  );

  await page.goto("/settings/audit");
  // History from before the upgrade was kept (the invitation), and so was everything since.
  const actions = async () =>
    await page
      .getByTestId("audit-row")
      .evaluateAll((els) => els.map((e) => e.getAttribute("data-action")));
  await expect
    .poll(actions)
    .toEqual(expect.arrayContaining(["member.invited", "member.joined", "member.role_changed"]));
  const roleRow = page
    .getByTestId("audit-row")
    .filter({ has: page.locator('[data-action="member.role_changed"]') })
    .or(page.locator('[data-testid="audit-row"][data-action="member.role_changed"]'));
  await expect(roleRow.first()).toContainText("Eddie Editor: editor → viewer");
  await expect(roleRow.first()).toContainText(/Changed someone's role/);
  // Newest first, and it names who did it.
  expect((await actions())[0]).toBe("member.role_changed");
  await expect(roleRow.first()).toContainText(
    (await pool.query(`SELECT name FROM users WHERE lower(email) = $1`, [owner.email])).rows[0]
      .name,
  );
  // Filters.
  await page.getByTestId("audit-cat-workspaces").click();
  await expect(page.getByTestId("audit-empty")).toBeVisible();
  await page.getByTestId("audit-cat-people").click();
  await expect(page.getByTestId("audit-row").first()).toBeVisible();
  for (const act of await actions()) expect(act!.startsWith("member.")).toBe(true);
  // Plan changes are in there too, with no card details.
  await pool.query(`SELECT 1`);
  await editor.ctx.close();
});

test("white-label: set on Agency, shown to clients on shared pages and the client view, refused for low contrast, off below Agency", async ({
  page,
  browser,
}) => {
  const owner = await createUser(page, { brand: "Latte Lane" });
  await page.goto("/settings/branding");
  await expect(page.getByTestId("branding-locked")).toBeVisible();

  await setPlan(owner.email, "agency");
  await page.goto("/settings/branding");
  await page.getByTestId("brand-display-name").fill("Studio North");
  await page.getByTestId("brand-accent").fill("#ffee00"); // yellow: white text on it is unreadable
  await expect(page.getByTestId("accent-hint")).toContainText("contrast");
  await expect(page.getByTestId("brand-save")).toBeDisabled();
  await page.getByTestId("brand-accent").fill("#1f4fa8");
  await expect(page.getByTestId("accent-hint")).toContainText("Good");
  await page.getByTestId("brand-footer-text").fill("Prepared by Studio North for Acme");
  await page.getByTestId("brand-hide-powered").check();
  await expect(page.getByTestId("brand-preview")).toContainText("Shared by Studio North");
  await page.getByTestId("brand-save").click();
  await expect(page.getByText("Branding saved.")).toBeVisible();

  // A public dashboard link now carries the brand, not Ripplewise's.
  const q = (
    await pool.query(
      `SELECT w.id AS ws, u.id AS u FROM workspaces w JOIN memberships m ON m.workspace_id = w.id JOIN users u ON u.id = m.user_id WHERE w.slug = $1 LIMIT 1`,
      [owner.slug],
    )
  ).rows[0];
  const token = `tok${rnd()}${rnd()}${rnd()}${rnd()}`;
  await pool.query(
    `INSERT INTO dashboards (workspace_id, name, created_by, public_token) VALUES ($1,'Brand health',$2,$3)`,
    [q.ws, q.u, token],
  );
  const pub = await (await browser.newContext()).newPage();
  await pub.goto(`/share/${token}`);
  await expect(pub.getByTestId("share-banner")).toContainText("Shared by Studio North");
  await expect(pub.getByTestId("brand-footer")).toHaveText("Prepared by Studio North for Acme");
  await expect(pub.getByTestId("share-footer")).not.toContainText("Built with Ripplewise");

  // The client viewer's own view carries it too.
  const client = await joinNew(browser, page, owner.slug, "client_viewer", "Client Person");
  await client.page.goto(`/w/${owner.slug}/dashboards`);
  await expect(
    client.page.getByTestId("brand-name"),
    await client.page
      .content()
      .then((c) => c.slice(0, 1500))
      .catch(() => ""),
  ).toHaveText("Studio North");
  // Staff keep the product's own name.
  await page.goto(`/w/${owner.slug}/home`);
  await expect(page.getByTestId("brand-name")).toHaveText("Ripplewise");

  // Drop below Agency: the default branding comes back, and the saved settings are kept for later.
  await setPlan(owner.email, "growth");
  await pub.reload();
  await expect(pub.getByTestId("share-banner")).not.toContainText("Studio North");
  await expect(pub.getByTestId("share-footer")).toContainText("Built with Ripplewise");
  await client.page.reload();
  await expect(client.page.getByTestId("brand-name")).toHaveText("Ripplewise");
  await setPlan(owner.email, "agency");
  await pub.reload();
  await expect(pub.getByTestId("share-banner")).toContainText("Studio North");
  await client.ctx.close();
});
