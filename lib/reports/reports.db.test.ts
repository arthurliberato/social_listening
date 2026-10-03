// M7 acceptance: a scheduled report email arrives in the member's inbox with tracked open and click.
import { eq, sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import {
  accounts,
  db,
  emails,
  memberships,
  pool,
  queries,
  reportDeliveries,
  reports,
  reportSchedules,
  users,
  workspaces,
} from "@/db/client";
import { runBackfill } from "@/jobs/backfill";
import { runDueReports } from "@/jobs/reports";
import { recordClick, recordOpen } from "@/lib/email/tracking";
import { renderReportPdf } from "./pdf";
import { csvOf, loadReportSections, pdfSections } from "./service";
import { REPORT_TEMPLATES } from "./templates";

afterAll(() => pool.end());

async function fixture() {
  const [a] = await db.insert(accounts).values({ name: "rep", planTier: "growth" }).returning();
  const [w] = await db
    .insert(workspaces)
    .values({
      accountId: a!.id,
      name: "Acme",
      slug: `rp-${Math.random().toString(36).slice(2, 9)}`,
    })
    .returning();
  const mk = async (role: string, member = true) => {
    const [u] = await db
      .insert(users)
      .values({
        email: `${role}-${Math.random().toString(36).slice(2, 8)}@example.test`,
        passwordHash: "x",
        name: role,
      })
      .returning();
    if (member)
      await db
        .insert(memberships)
        .values({ userId: u!.id, workspaceId: w!.id, accountId: a!.id, role });
    return u!;
  };
  const owner = await mk("owner");
  const viewer = await mk("viewer");
  const outsider = await mk("editor", false);
  const [q] = await db
    .insert(queries)
    .values({
      workspaceId: w!.id,
      name: "Voltara",
      booleanText: "voltara",
      status: "live",
      createdBy: owner.id,
    })
    .returning();
  await runBackfill(q!.id);
  const tpl = REPORT_TEMPLATES.find((t) => t.id === "weekly_brand_summary")!;
  const [r] = await db
    .insert(reports)
    .values({
      workspaceId: w!.id,
      name: "Weekly brand summary",
      templateId: tpl.id,
      range: tpl.range,
      sections: tpl.sections.map((s, i) => ({ ...s, id: `s${i}` })),
      createdBy: owner.id,
    })
    .returning();
  return { a: a!, w: w!, owner, viewer, outsider, r: r! };
}

const eventCount = async (userId: string, name: string) =>
  Number(
    (
      await db.execute(
        sql`SELECT count(*)::int AS n FROM analytics_events WHERE user_id = ${userId}::uuid AND name = ${name}`,
      )
    ).rows[0]!.n,
  );

describe("report content", () => {
  it("loads every section and exports a PDF and a CSV from the same numbers", async () => {
    const f = await fixture();
    const loaded = await loadReportSections(f.w.id, f.r);
    expect(loaded).toHaveLength(6);
    expect(loaded.every((l) => l.result.ok)).toBe(true);
    const pdf = await renderReportPdf({
      title: f.r.name,
      workspace: "Acme",
      period: "Last 7 days",
      generatedAt: new Date(),
      sections: pdfSections(loaded),
    });
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    const csv = csvOf(f.r, loaded);
    expect(csv).toContain('"Section","Mentions over time"');
    expect(csv).toContain('"Section","Top mentions"');
  }, 120_000);

  it("a section that fails shows an error in its place instead of failing the report", async () => {
    const f = await fixture();
    await db
      .update(reports)
      .set({
        sections: [
          {
            id: "x",
            type: "kpi",
            title: "Gone",
            config: { queryId: "00000000-0000-4000-8000-000000000000" },
          },
          ...(f.r.sections as object[]),
        ],
      })
      .where(eq(reports.id, f.r.id));
    const [r] = await db.select().from(reports).where(eq(reports.id, f.r.id));
    const loaded = await loadReportSections(f.w.id, r!);
    expect(loaded[0]!.result.ok).toBe(false);
    expect(loaded.slice(1).every((l) => l.result.ok)).toBe(true);
    const sections = pdfSections(loaded);
    expect(sections[0]!.error).toMatch(/deleted/);
    const pdf = await renderReportPdf({
      title: "t",
      workspace: "w",
      period: "p",
      generatedAt: new Date(),
      sections,
    });
    expect(pdf.length).toBeGreaterThan(1000);
  }, 120_000);
});

describe("scheduled delivery", () => {
  it("sends when due, lands in the inbox, tracks open and click once, and never double-sends", async () => {
    const f = await fixture();
    const now = new Date("2026-10-05T08:03:00Z"); // a Monday
    const [s] = await db
      .insert(reportSchedules)
      .values({
        reportId: f.r.id,
        workspaceId: f.w.id,
        frequency: "weekly",
        weekday: 1,
        hourUtc: 8,
        recipientIds: [f.owner.id, f.viewer.id, f.outsider.id], // the outsider isn't a member
        externalEmails: ["board@example.org"],
        nextRunAt: new Date("2026-10-05T08:00:00Z"),
        createdBy: f.owner.id,
      })
      .returning();

    // Not due yet: nothing.
    expect(await runDueReports(new Date("2026-10-05T07:59:00Z"))).toEqual([]);

    const sent = await runDueReports(now);
    expect(sent).toEqual([{ scheduleId: s!.id, sent: 3 }]); // owner + viewer + the outside address
    // The next run moved a week on; running again at the same time sends nothing.
    const [after] = await db.select().from(reportSchedules).where(eq(reportSchedules.id, s!.id));
    expect(after!.nextRunAt.toISOString()).toBe("2026-10-12T08:00:00.000Z");
    expect(after!.lastRunAt!.toISOString()).toBe(now.toISOString());
    expect(await runDueReports(now)).toEqual([]);

    const mail = await db.select().from(emails).where(eq(emails.toUserId, f.owner.id));
    expect(mail).toHaveLength(1);
    const m = mail[0]!;
    expect(m.type).toBe("report");
    expect(m.subject).toContain("Weekly brand summary");
    expect(m.bodyText).toContain("Mentions per day");
    expect(m.bodyText).toContain(
      `/api/t/c/${m.id}?to=${encodeURIComponent(`/w/${f.w.slug}/reports/${f.r.id}`)}`,
    );
    // Outsider got nothing as a member; the external address got a plain copy.
    expect(await db.select().from(emails).where(eq(emails.toUserId, f.outsider.id))).toHaveLength(
      0,
    );
    const ext = (
      await db.select().from(emails).where(eq(emails.toAddress, "board@example.org"))
    )[0]!;
    expect(ext.toUserId).toBeNull();
    expect(ext.bodyText).not.toContain("/api/t/c/");
    expect(await eventCount(f.owner.id, "Report Delivered")).toBe(1);

    // Open: the first pixel load counts, later ones don't.
    expect(await eventCount(f.owner.id, "Email Opened")).toBe(0);
    await recordOpen(m.id);
    await recordOpen(m.id);
    expect(await eventCount(f.owner.id, "Email Opened")).toBe(1);
    expect(await eventCount(f.owner.id, "Report Opened")).toBe(1);
    const [dlv] = await db
      .select()
      .from(reportDeliveries)
      .where(eq(reportDeliveries.emailId, m.id));
    expect(dlv!.openedAt).not.toBeNull();
    expect(dlv!.clickedAt).toBeNull();

    // Click: every click is an event; the first stamps the message. Only in-app paths are followed.
    const path = `/w/${f.w.slug}/reports/${f.r.id}`;
    expect(await recordClick(m.id, path)).toBe(path);
    expect(await recordClick(m.id, path)).toBe(path);
    expect(await eventCount(f.owner.id, "Email Link Clicked")).toBe(2);
    const [stamped] = await db.select().from(emails).where(eq(emails.id, m.id));
    expect(stamped!.clickedAt).not.toBeNull();
    expect(await recordClick(m.id, "//evil.example/phish")).toBeNull();
    expect(await recordClick(m.id, "https://evil.example")).toBeNull();
    expect(await recordClick("not-a-uuid", path)).toBe(path); // harmless, nothing recorded
  }, 180_000);

  it("does not track transactional mail, and a paused schedule stays quiet", async () => {
    const f = await fixture();
    const [v] = await db
      .insert(emails)
      .values({
        toUserId: f.owner.id,
        toAddress: "x@example.test",
        type: "verify_email",
        subject: "Verify",
        bodyText: "link",
      })
      .returning();
    await recordOpen(v!.id);
    expect(await eventCount(f.owner.id, "Email Opened")).toBe(0);

    await db.insert(reportSchedules).values({
      reportId: f.r.id,
      workspaceId: f.w.id,
      frequency: "daily",
      recipientIds: [f.owner.id],
      active: false,
      nextRunAt: new Date("2026-10-01T08:00:00Z"),
    });
    expect(await runDueReports(new Date("2026-10-05T08:00:00Z"))).toEqual([]);
  }, 120_000);
});
