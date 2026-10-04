"use server";

import { and, eq } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db, memberships, reports, reportSchedules, users } from "@/db/client";
import { auditIn } from "@/lib/audit";
import { requireWorkspace } from "@/lib/auth/session";
import { widgetAllowed } from "@/lib/dashboards/catalog";
import { workspaceAccount } from "@/lib/dashboards/service";
import { PLANS, planUnlocking, type PlanTier } from "@/lib/entitlements/plans";
import { deliverReport } from "@/lib/reports/deliver";
import { FREQUENCIES, nextRun, type Frequency } from "@/lib/reports/schedule";
import { getReport } from "@/lib/reports/service";
import { getReportTemplate } from "@/lib/reports/templates";
import { RANGES, SectionsSchema } from "@/lib/reports/types";
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
