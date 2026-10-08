// Open and click tracking for emails we send. An "open" is the 1x1 image loading; a "click" is a hit on
// /api/t/c/<id>, which records it and redirects. Both are recorded once per message (first time).
import { and, eq, isNull } from "drizzle-orm";
import { db, emails, reportDeliveries } from "@/db/client";
import { trackServer } from "@/lib/analytics/server";
import { simNow } from "@/lib/simclock";

/** Email types we measure. Verification and invitation mail is transactional and is not tracked. */
export const TRACKED_TYPES = ["report", "digest", "alert"] as const;
export const isTracked = (type: string) => (TRACKED_TYPES as readonly string[]).includes(type);

async function deliveryOf(emailId: string) {
  const [d] = await db.select().from(reportDeliveries).where(eq(reportDeliveries.emailId, emailId));
  return d;
}

export async function recordOpen(emailId: string): Promise<void> {
  if (!/^[0-9a-f-]{36}$/.test(emailId)) return;
  const [m] = await db
    .update(emails)
    .set({ openedAt: simNow() })
    .where(and(eq(emails.id, emailId), isNull(emails.openedAt)))
    .returning({ type: emails.type, userId: emails.toUserId });
  if (!m || !isTracked(m.type)) return; // already counted, unknown, or not a tracked type
  const d = await deliveryOf(emailId);
  if (d)
    await db
      .update(reportDeliveries)
      .set({ openedAt: simNow() })
      .where(and(eq(reportDeliveries.id, d.id), isNull(reportDeliveries.openedAt)));
  const ctx = { userId: m.userId, workspaceId: d?.workspaceId ?? null };
  await trackServer("Email Opened", ctx, { email_type: m.type });
  if (d)
    await trackServer("Report Opened", ctx, { report_id: d.reportId, delivery_channel: "email" });
}

/** Records the click; returns the in-app path to send the reader to (or null if it can't be resolved). */
export async function recordClick(emailId: string, to: string | null): Promise<string | null> {
  const safe = to && to.startsWith("/") && !to.startsWith("//") && !to.includes("\\") ? to : null;
  if (!/^[0-9a-f-]{36}$/.test(emailId)) return safe;
  const [m] = await db.select().from(emails).where(eq(emails.id, emailId));
  if (!m || !isTracked(m.type)) return safe;
  await db
    .update(emails)
    .set({ clickedAt: simNow() })
    .where(and(eq(emails.id, emailId), isNull(emails.clickedAt)));
  const d = await deliveryOf(emailId);
  if (d)
    await db
      .update(reportDeliveries)
      .set({ clickedAt: simNow() })
      .where(and(eq(reportDeliveries.id, d.id), isNull(reportDeliveries.clickedAt)));
  await trackServer(
    "Email Link Clicked",
    { userId: m.toUserId, workspaceId: d?.workspaceId ?? null },
    { email_type: m.type },
  );
  return safe;
}
