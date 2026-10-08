// The Help center's "ask us" form. A simulated desk acknowledges each question by email; there is no staff console.
import { count, eq, gte, and } from "drizzle-orm";
import { z } from "zod";
import { db, supportRequests } from "@/db/client";
import { trackServer } from "@/lib/analytics/server";
import { sendEmail } from "@/lib/email/service";
import { simNow } from "@/lib/simclock";
import { SUPPORT_CATEGORIES } from "./topics";

export const MAX_PER_DAY = 5;

export const SupportInput = z.object({
  category: z.enum(SUPPORT_CATEGORIES.map((c) => c.id) as [string, ...string[]]),
  subject: z.string().trim().min(3, "Give your question a short title").max(120),
  message: z.string().trim().min(10, "Tell us a little more (at least 10 characters)").max(3000),
});

export type SupportResult =
  | { ok: true; id: string; reference: string }
  | { ok: false; error: string; field?: "subject" | "message" | "category" };

export const referenceOf = (id: string) => `RW-${id.slice(0, 8).toUpperCase()}`;

export async function submitSupport(
  input: unknown,
  who: { userId: string; email: string; accountId: string | null; workspaceId: string | null },
): Promise<SupportResult> {
  const p = SupportInput.safeParse(input);
  if (!p.success) {
    const i = p.error.issues[0]!;
    const f = i.path[0];
    return {
      ok: false,
      error: i.message,
      field: f === "subject" || f === "message" || f === "category" ? f : undefined,
    };
  }
  const now = simNow();
  const [{ n } = { n: 0 }] = await db
    .select({ n: count() })
    .from(supportRequests)
    .where(
      and(
        eq(supportRequests.userId, who.userId),
        gte(supportRequests.createdAt, new Date(now.getTime() - 86_400_000)),
      ),
    );
  if (n >= MAX_PER_DAY)
    return {
      ok: false,
      error: `You've sent ${MAX_PER_DAY} questions today. We'll answer those first; reply to our email to add more.`,
    };
  const [row] = await db
    .insert(supportRequests)
    .values({
      accountId: who.accountId,
      workspaceId: who.workspaceId,
      userId: who.userId,
      category: p.data.category,
      subject: p.data.subject,
      message: p.data.message,
    })
    .returning({ id: supportRequests.id });
  const reference = referenceOf(row!.id);
  await sendEmail({
    toUserId: who.userId,
    to: who.email,
    type: "support",
    subject: `We got your question (${reference})`,
    text: `Thanks for writing to Ripplewise support.\n\nYour reference is ${reference}.\n\nYou asked: ${p.data.subject}\n\nA person on the team will reply by email, usually within one working day. If it's urgent, mention the reference when you reply.`,
  });
  await trackServer(
    "Support Contacted",
    { userId: who.userId, accountId: who.accountId, workspaceId: who.workspaceId },
    { category: p.data.category },
  );
  return { ok: true, id: row!.id, reference };
}
