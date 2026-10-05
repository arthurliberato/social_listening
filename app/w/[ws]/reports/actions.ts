"use server";

import { and, desc, eq } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db, memberships, queries, reports, reportSchedules, users } from "@/db/client";
import { auditIn } from "@/lib/audit";
import { requireWorkspace } from "@/lib/auth/session";
import { WIDGETS, widgetAllowed } from "@/lib/dashboards/catalog";
import { workspaceAccount } from "@/lib/dashboards/service";
import { PLANS, planUnlocking, type PlanTier } from "@/lib/entitlements/plans";
import { deliverReport } from "@/lib/reports/deliver";
import { FREQUENCIES, nextRun, type Frequency } from "@/lib/reports/schedule";
import { appendSection, getReport } from "@/lib/reports/service";
import { getReportTemplate } from "@/lib/reports/templates";
import { MAX_SECTIONS, RANGES, SectionSchema, SectionsSchema } from "@/lib/reports/types";
import { canEdit } from "@/lib/queries";
import { simNow } from "@/lib/simclock";

type Fail = { ok: false; error: string; upgradeTo?: PlanTier };
const NO_EDIT = "Your role can view reports but not change them. Ask an admin for editor access.";

export async function createReport(
  slug: string,
  templateId: string | null,
): Promise<{ ok: true; id: string; skipped: number } | Fail> {
  const { user, ws } = await requireWorkspace(slug);
  if (!canEdit(ws.role)) return { ok: false, error: NO_EDIT };
  const tpl = templateId ? getReportTemplate(templateId) : undefined;
  if (templateId && !tpl) return { ok: false, error: "Unknown template." };
  const { plan } = await workspaceAccount(ws.id);
  const wanted = tpl?.sections ?? [];
  const sections = wanted
    .filter((s) => widgetAllowed(s.type, plan.features))
    .map((s) => ({ ...s, id: randomBytes(6).toString("hex") }));
  const [row] = await db
    .insert(reports)
    .values({
      workspaceId: ws.id,
      name: tpl?.label ?? "Untitled report",
      description: tpl?.description ?? "",
      templateId: tpl?.id ?? null,
      range: tpl?.range ?? "30d",
      sections,
      createdBy: user.id,
    })
    .returning({ id: reports.id });
  await auditIn(
    ws,
    user.id,
    "report.created",
    { type: "report", id: row!.id },
    { name: tpl?.label ?? "Untitled report" },
  );
  revalidatePath(`/w/${slug}/reports`);
  return { ok: true, id: row!.id, skipped: wanted.length - sections.length };
}

const SaveInput = z.object({
  name: z.string().trim().min(1, "Give the report a name").max(100),
  description: z.string().trim().max(300).default(""),
  range: z.enum(RANGES),
  sections: SectionsSchema,
});

export async function saveReport(
  slug: string,
  id: string,
  input: unknown,
): Promise<{ ok: true } | Fail> {
  const { user, ws } = await requireWorkspace(slug);
  if (!canEdit(ws.role)) return { ok: false, error: NO_EDIT };
  const r = await getReport(ws.id, id);
  if (!r) return { ok: false, error: "That report no longer exists." };
  const p = SaveInput.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]!.message };
  // Plan check on the way in: locked section types can't be smuggled in by editing the request.
  const { plan } = await workspaceAccount(ws.id);
  const locked = p.data.sections.find((s) => !widgetAllowed(s.type, plan.features));
  if (locked)
    return {
      ok: false,
      error: `The "${locked.title}" section isn't included in your ${plan.label} plan.`,
    };
  await db
    .update(reports)
    .set({ ...p.data, updatedAt: new Date() })
    .where(eq(reports.id, id));
  await auditIn(ws, user.id, "report.updated", { type: "report", id }, { name: p.data.name });
  revalidatePath(`/w/${slug}/reports`);
  revalidatePath(`/w/${slug}/reports/${id}`);
  return { ok: true };
}

export async function deleteReport(slug: string, id: string): Promise<{ ok: true } | Fail> {
  const { user, ws } = await requireWorkspace(slug);
  if (!canEdit(ws.role)) return { ok: false, error: NO_EDIT };
  const r = await getReport(ws.id, id);
  if (!r) return { ok: false, error: "That report no longer exists." };
  await db.delete(reports).where(eq(reports.id, id));
  await auditIn(ws, user.id, "report.deleted", { type: "report", id }, { name: r.name });
  revalidatePath(`/w/${slug}/reports`);
  return { ok: true };
}

const EMAIL = z.string().trim().toLowerCase().email().max(200);
const ScheduleInput = z.object({
  frequency: z.enum(FREQUENCIES),
  weekday: z.number().int().min(0).max(6),
  dayOfMonth: z.number().int().min(1).max(28),
  hourUtc: z.number().int().min(0).max(23),
  recipientIds: z.array(z.string().uuid()).max(50),
  externalEmails: z.array(EMAIL).max(10, "Up to 10 outside addresses"),
});

export type ScheduleResult =
  | { ok: true; nextRunAt: string; recipients: number; external: number }
  | (Fail & { paywall?: true });

export async function saveSchedule(
  slug: string,
  id: string,
  input: unknown,
): Promise<ScheduleResult> {
  const { user, ws } = await requireWorkspace(slug);
  if (!canEdit(ws.role)) return { ok: false, error: NO_EDIT };
  const r = await getReport(ws.id, id);
  if (!r) return { ok: false, error: "That report no longer exists." };
  const { plan } = await workspaceAccount(ws.id);
  if (!plan.features.scheduledReports)
    return {
      ok: false,
      paywall: true,
      error: `Scheduled reports are on the ${PLANS[planUnlocking("scheduledReports")].label} plan and above.`,
      upgradeTo: planUnlocking("scheduledReports"),
    };
  const p = ScheduleInput.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]!.message };
  const v = p.data;
  if (!v.recipientIds.length && !v.externalEmails.length)
    return { ok: false, error: "Choose at least one recipient." };
  // Only current workspace members count as members; everyone else must be an outside address.
  const valid = v.recipientIds.length
    ? await db
        .select({ id: users.id })
        .from(memberships)
        .innerJoin(users, eq(users.id, memberships.userId))
        .where(eq(memberships.workspaceId, ws.id))
    : [];
  const ok = new Set(valid.map((x) => x.id));
  const recipientIds = v.recipientIds.filter((x) => ok.has(x));
  if (recipientIds.length !== v.recipientIds.length)
    return { ok: false, error: "Someone you picked isn't in this workspace." };
  const when = {
    frequency: v.frequency as Frequency,
    weekday: v.weekday,
    dayOfMonth: v.dayOfMonth,
    hourUtc: v.hourUtc,
  };
  const next = nextRun(simNow(), when);
  const values = {
    ...when,
    recipientIds,
    externalEmails: [...new Set(v.externalEmails)],
    active: true,
    nextRunAt: next,
  };
  await db
    .insert(reportSchedules)
    .values({ reportId: id, workspaceId: ws.id, createdBy: user.id, ...values })
    .onConflictDoUpdate({ target: reportSchedules.reportId, set: values });
  // Counts only: outside email addresses are personal data and don't belong in the log.
  await auditIn(
    ws,
    user.id,
    "report.scheduled",
    { type: "report", id },
    {
      name: r.name,
      frequency: v.frequency,
      members: recipientIds.length,
      external: values.externalEmails.length,
    },
  );
  revalidatePath(`/w/${slug}/reports`);
  revalidatePath(`/w/${slug}/reports/${id}`);
  return {
    ok: true,
    nextRunAt: next.toISOString(),
    recipients: recipientIds.length,
    external: values.externalEmails.length,
  };
}

export async function stopSchedule(slug: string, id: string): Promise<{ ok: true } | Fail> {
  const { user, ws } = await requireWorkspace(slug);
  if (!canEdit(ws.role)) return { ok: false, error: NO_EDIT };
  const r = await getReport(ws.id, id);
  if (!r) return { ok: false, error: "That report no longer exists." };
  await db
    .delete(reportSchedules)
    .where(and(eq(reportSchedules.reportId, id), eq(reportSchedules.workspaceId, ws.id)));
  await auditIn(ws, user.id, "report.schedule_stopped", { type: "report", id }, { name: r.name });
  revalidatePath(`/w/${slug}/reports`);
  revalidatePath(`/w/${slug}/reports/${id}`);
  return { ok: true };
}

/** "Email me a copy now": one tracked message to the signed-in user, outside any schedule. */
export async function sendCopyNow(slug: string, id: string): Promise<{ ok: true } | Fail> {
  const { user, ws } = await requireWorkspace(slug);
  const r = await getReport(ws.id, id);
  if (!r) return { ok: false, error: "That report no longer exists." };
  const sent = await deliverReport({ report: r, recipientIds: [user.id], trigger: "manual" });
  return sent
    ? { ok: true }
    : { ok: false, error: "We couldn't send that. Try again in a moment." };
}

export interface ReportTarget {
  id: string;
  name: string;
  sections: number;
  full: boolean;
}

/** The reports a section can be added to (newest edited first), for the "Add to report" dialog. */
export async function listReportTargets(
  slug: string,
): Promise<{ ok: true; reports: ReportTarget[] } | Fail> {
  const { ws } = await requireWorkspace(slug);
  if (!canEdit(ws.role)) return { ok: false, error: NO_EDIT };
  const rows = await db
    .select({ id: reports.id, name: reports.name, sections: reports.sections })
    .from(reports)
    .where(eq(reports.workspaceId, ws.id))
    .orderBy(desc(reports.updatedAt))
    .limit(50);
  return {
    ok: true,
    reports: rows.map((r) => {
      const n = Array.isArray(r.sections) ? r.sections.length : 0;
      return { id: r.id, name: r.name, sections: n, full: n >= MAX_SECTIONS };
    }),
  };
}

const AddInput = z.object({
  /** Null starts a new report. */
  reportId: z.string().uuid().nullable(),
  type: z.string(),
  title: z.string(),
  config: z.record(z.string(), z.unknown()).default({}),
  source: z.enum(["dashboard", "topics", "authors"]),
});

/** Append a widget, as a report section, to an existing report or a new one. Same plan gate and limit as the editor. */
export async function addSectionToReport(
  slug: string,
  input: unknown,
): Promise<
  | { ok: true; id: string; name: string; created: boolean; sections: number }
  | (Fail & { paywall?: true })
> {
  const { user, ws } = await requireWorkspace(slug);
  if (!canEdit(ws.role)) return { ok: false, error: NO_EDIT };
  const p = AddInput.safeParse(input);
  if (!p.success) return { ok: false, error: "That widget can't be added to a report." };
  const section = SectionSchema.safeParse({
    id: randomBytes(6).toString("hex"),
    type: p.data.type,
    title: p.data.title,
    config: p.data.config,
  });
  if (!section.success)
    return { ok: false, error: section.error.issues[0]?.message ?? "That widget can't be added." };
  const { plan } = await workspaceAccount(ws.id);
  // Plan check on the way in, as in saveReport: a locked widget type can't be added by posting to this action.
  if (!widgetAllowed(section.data.type, plan.features))
    return {
      ok: false,
      paywall: true,
      error: `The "${section.data.title}" section isn't included in your ${plan.label} plan.`,
      upgradeTo: planUnlocking(WIDGETS[section.data.type].requires!),
    };
  // A query the widget points at must belong to this workspace.
  const qid = section.data.config.queryId;
  if (qid) {
    const [q] = await db
      .select({ id: queries.id })
      .from(queries)
      .where(and(eq(queries.id, qid), eq(queries.workspaceId, ws.id)));
    if (!q) return { ok: false, error: "That widget uses a query that no longer exists." };
  }

  if (p.data.reportId === null) {
    const [row] = await db
      .insert(reports)
      .values({
        workspaceId: ws.id,
        name: `${section.data.title} report`.slice(0, 100),
        description: "",
        templateId: null,
        range: "30d",
        sections: [section.data],
        createdBy: user.id,
      })
      .returning({ id: reports.id, name: reports.name });
    await auditIn(
      ws,
      user.id,
      "report.created",
      { type: "report", id: row!.id },
      { name: row!.name },
    );
    await auditIn(
      ws,
      user.id,
      "report.section_added",
      { type: "report", id: row!.id },
      { name: row!.name, section: section.data.title },
    );
    revalidatePath(`/w/${slug}/reports`);
    return { ok: true, id: row!.id, name: row!.name, created: true, sections: 1 };
  }

  const row = await appendSection(ws.id, p.data.reportId, section.data);
  if (!row) {
    const r = await getReport(ws.id, p.data.reportId);
    return {
      ok: false,
      error: r
        ? `"${r.name}" already has ${MAX_SECTIONS} sections, the most a report can hold.`
        : "That report no longer exists.",
    };
  }
  await auditIn(
    ws,
    user.id,
    "report.section_added",
    { type: "report", id: p.data.reportId },
    { name: row.name, section: section.data.title },
  );
  revalidatePath(`/w/${slug}/reports`);
  revalidatePath(`/w/${slug}/reports/${p.data.reportId}`);
  return { ok: true, id: p.data.reportId, name: row.name, created: false, sections: row.sections };
}
