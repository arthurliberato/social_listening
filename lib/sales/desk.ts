// The simulated sales desk: plays the rep who answers contact requests and follows up on demos.
import { and, eq, inArray, lte, or } from "drizzle-orm";
import { db, salesRequests } from "@/db/client";
import { simNow } from "@/lib/simclock";
import { createQuote } from "./service";

/** A contact request gets its quote this long after it arrives. */
export const RESPONSE_MS = 10 * 60_000;

export async function runSalesDesk(
  now: Date = simNow(),
  only?: string[],
): Promise<{ requestId: string }[]> {
  const due = await db
    .select({ id: salesRequests.id })
    .from(salesRequests)
    .where(
      and(
        only ? inArray(salesRequests.id, only) : undefined,
        or(
          and(
            eq(salesRequests.status, "new"),
            lte(salesRequests.createdAt, new Date(now.getTime() - RESPONSE_MS)),
          ),
          // After the demo has happened, the follow-up quote goes out.
          and(eq(salesRequests.status, "demo_booked"), lte(salesRequests.demoAt, now)),
        ),
      ),
    );
  const out: { requestId: string }[] = [];
  for (const { id } of due) {
    // Claim by status so concurrent runs can't send two quotes.
    const claimed = await db
      .update(salesRequests)
      .set({ status: "quoted" })
      .where(and(eq(salesRequests.id, id), inArray(salesRequests.status, ["new", "demo_booked"])))
      .returning({ id: salesRequests.id });
    if (!claimed.length) continue;
    await createQuote(id, now);
    out.push({ requestId: id });
  }
  return out;
}
