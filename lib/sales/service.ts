// Sales-assist: contact and demo requests, quotes, and signing a contract that activates Enterprise.
// There is no staff console in the product; a simulated sales desk (desk.ts) plays the sales rep.
import { createHash, randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { accounts, contracts, db, memberships, quotes, salesRequests } from "@/db/client";
import { trackServer } from "@/lib/analytics/server";
import { audit } from "@/lib/audit";
import { billingContacts, eventCtx } from "@/lib/billing/service";
import { APP_URL, sendEmail } from "@/lib/email/service";
import { simNow } from "@/lib/simclock";
import { MAX_SEATS, MIN_SEATS, quoteValueCents, usd } from "./pricing";

export const SALES_ENTRY_POINTS = [
  "pricing_enterprise",
  "upgrade_page",
  "pqa_card",
  "usage_page",
  "direct",
] as const;

export const RequestInput = z.object({
  kind: z.enum(["contact", "demo"]),
  name: z.string().trim().min(1, "Tell us your name").max(120),
  email: z.string().trim().toLowerCase().email("Enter a valid work email").max(200),
  company: z.string().trim().min(1, "Tell us your company").max(160),
  seats: z.number().int().min(1, "Enter how many people will use it").max(MAX_SEATS),
  message: z.string().trim().max(2000).default(""),
  entryPoint: z.enum(SALES_ENTRY_POINTS).default("direct"),
  /** ISO time of the chosen demo slot (demo requests only). */
  demoAt: z.string().datetime().optional(),
});
export type RequestInput = z.input<typeof RequestInput>;

const hash = (t: string) => createHash("sha256").update(t).digest("hex");
/** Demo slots are offered on weekdays at fixed hours, from tomorrow. */
export const DEMO_HOURS_UTC = [14, 16];
export function demoSlots(now: Date, n = 6): Date[] {
  const out: Date[] = [];
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  while (out.length < n) {
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6)
      for (const h of DEMO_HOURS_UTC) {
        if (out.length < n) out.push(new Date(d.getTime() + h * 3_600_000));
      }
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

export type Submit = { ok: true; id: string; demoAt?: string } | { ok: false; error: string };

export async function submitRequest(
  input: unknown,
  who: { userId?: string | null; accountId?: string | null; workspaceId?: string | null },
  now: Date = simNow(),
): Promise<Submit> {
  const p = RequestInput.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]!.message };
  const v = p.data;
  let demoAt: Date | null = null;
  if (v.kind === "demo") {
    if (!v.demoAt) return { ok: false, error: "Pick a time for the demo." };
    demoAt = new Date(v.demoAt);
    if (!demoSlots(now, 12).some((s) => s.getTime() === demoAt!.getTime()))
      return { ok: false, error: "That time is no longer available. Pick another." };
  }
  const [row] = await db
    .insert(salesRequests)
    .values({
      accountId: who.accountId ?? null,
      userId: who.userId ?? null,
      name: v.name,
      email: v.email,
      company: v.company,
      kind: v.kind,
      seats: v.seats,
      message: v.message,
      entryPoint: v.entryPoint,
      demoAt,
      status: v.kind === "demo" ? "demo_booked" : "new",
      createdAt: now,
    })
    .returning({ id: salesRequests.id });
  const toUserId = who.userId ?? null;
  await sendEmail({
    toUserId,
    to: v.email,
    type: "sales",
    subject: v.kind === "demo" ? "Your Ripplewise demo is booked" : "We got your message",
    text:
      v.kind === "demo"
        ? `Hi ${v.name},\n\nYour demo is booked for ${demoAt!.toISOString().replace("T", " ").slice(0, 16)} UTC. Someone from our team will join you with a calendar invite shortly.\n\nIf the time no longer works, reply to this email and we'll move it.`
        : `Hi ${v.name},\n\nThanks for getting in touch about Ripplewise for ${v.company}. A member of our team will send you a tailored quote shortly.`,
  });
  if (v.kind === "demo")
    await trackServer(
      "Demo Booked",
      { userId: toUserId, accountId: who.accountId, workspaceId: who.workspaceId },
      { seats_requested: v.seats },
    );
  return { ok: true, id: row!.id, demoAt: demoAt?.toISOString() };
}

/** Make a quote for a request and email the link. Returns the token (only ever emailed, never stored). */
export async function createQuote(requestId: string, now: Date = simNow()) {
  const [r] = await db.select().from(salesRequests).where(eq(salesRequests.id, requestId));
  if (!r) return null;
  const seats = Math.max(MIN_SEATS, r.seats);
  const termMonths = 12;
  const token = randomBytes(24).toString("hex");
  const [q] = await db
    .insert(quotes)
    .values({
      requestId,
      tokenHash: hash(token),
      seats,
      termMonths,
      valueCents: quoteValueCents(seats, termMonths),
      expiresAt: new Date(now.getTime() + 30 * 86_400_000),
      createdAt: now,
    })
    .returning();
  await db.update(salesRequests).set({ status: "quoted" }).where(eq(salesRequests.id, requestId));
  await sendEmail({
    toUserId: r.userId,
    to: r.email,
    type: "sales",
    subject: `Your Ripplewise Enterprise quote for ${r.company}`,
    text: `Hi ${r.name},\n\nHere is your quote for ${seats} seats on a ${termMonths}-month Enterprise term: ${usd(q!.valueCents)} in total.\n\nReview it, accept it and sign here (valid for 30 days):\n${APP_URL}/quote/${token}\n\nAnything you'd like changed, just reply.`,
  });
  return { quoteId: q!.id, token };
}

export async function findQuote(token: string) {
  const [q] = await db
    .select()
    .from(quotes)
    .where(eq(quotes.tokenHash, hash(token)));
  if (!q) return null;
  const [r] = await db.select().from(salesRequests).where(eq(salesRequests.id, q.requestId));
  return { quote: q, request: r! };
}

export const isExpired = (q: { expiresAt: Date; status: string }, now: Date = simNow()) =>
  q.status !== "signed" && q.expiresAt.getTime() < now.getTime();

/** First view only moves the status; later views change nothing. */
export async function markViewed(quoteId: string, now: Date = simNow()) {
  const res = await db
    .update(quotes)
    .set({ status: "viewed", viewedAt: now })
    .where(and(eq(quotes.id, quoteId), eq(quotes.status, "sent")))
    .returning({ id: quotes.id });
  return res.length > 0;
}

export async function acceptQuote(
  token: string,
  now: Date = simNow(),
): Promise<{ ok: true } | { ok: false; error: string }> {
  const f = await findQuote(token);
  if (!f) return { ok: false, error: "We couldn't find that quote." };
  if (isExpired(f.quote, now))
    return { ok: false, error: "This quote has expired. Reply to our email for a fresh one." };
  if (f.quote.status === "signed") return { ok: false, error: "This quote is already signed." };
  await db
    .update(quotes)
    .set({ status: "accepted", acceptedAt: f.quote.acceptedAt ?? now })
    .where(eq(quotes.id, f.quote.id));
  return { ok: true };
}

/** Which account a signature would upgrade, if this person is allowed to sign for it. */
export async function signingAccount(userId: string, requestAccountId: string | null) {
  const rows = await db
    .select({ accountId: memberships.accountId, role: memberships.role })
    .from(memberships)
    .where(eq(memberships.userId, userId));
  const mine = rows.filter((r) => r.role === "owner" || r.role === "admin");
  if (requestAccountId)
    return mine.find((r) => r.accountId === requestAccountId)?.accountId ?? null;
  return mine[0]?.accountId ?? null;
}

export type Sign = { ok: true; contractId: string } | { ok: false; error: string };

export async function signContract(
  token: string,
  user: { id: string; name: string },
  signatureName: string,
  now: Date = simNow(),
): Promise<Sign> {
  const f = await findQuote(token);
  if (!f) return { ok: false, error: "We couldn't find that quote." };
  const q = f.quote;
  if (q.status === "signed") return { ok: false, error: "This quote is already signed." };
  if (isExpired(q, now))
    return { ok: false, error: "This quote has expired. Reply to our email for a fresh one." };
  if (q.status !== "accepted") return { ok: false, error: "Accept the quote before signing." };
  const sig = signatureName.trim();
  if (sig.length < 2) return { ok: false, error: "Type your full name to sign." };
  const accountId = await signingAccount(user.id, f.request.accountId);
  if (!accountId)
    return {
      ok: false,
      error: "Only an owner or admin of the account being upgraded can sign this contract.",
    };
  const [before] = await db.select().from(accounts).where(eq(accounts.id, accountId));
  const ends = new Date(now);
  ends.setUTCMonth(ends.getUTCMonth() + q.termMonths);
  // Claim the quote so a double-click or two tabs can't sign twice.
  const claimed = await db
    .update(quotes)
    .set({ status: "signed" })
    .where(and(eq(quotes.id, q.id), eq(quotes.status, "accepted")))
    .returning({ id: quotes.id });
  if (!claimed.length) return { ok: false, error: "This quote is already signed." };
  const [c] = await db
    .insert(contracts)
    .values({
      quoteId: q.id,
      accountId,
      signedBy: user.id,
      signatureName: sig,
      seats: q.seats,
      termMonths: q.termMonths,
      valueCents: q.valueCents,
      startsAt: now,
      endsAt: ends,
      signedAt: now,
    })
    .returning({ id: contracts.id });
  await db
    .update(accounts)
    .set({
      planTier: "enterprise",
      motion: "sales_assisted",
      billingStatus: "active",
      billingInterval: "yearly",
      currentPeriodStart: now,
      currentPeriodEnd: ends,
      cancelAtPeriodEnd: false,
      pendingTier: null,
      pendingInterval: null,
      dunningAttempts: 0,
      nextRetryAt: null,
    })
    .where(eq(accounts.id, accountId));
  const ctx = await eventCtx(accountId);
  await audit({
    accountId,
    actorUserId: user.id,
    action: "contract.signed",
    targetType: "contract",
    targetId: c!.id,
    meta: { seats: q.seats, term_months: q.termMonths, value_usd: Math.round(q.valueCents / 100) },
  });
  await trackServer(
    "Contract Signed",
    { ...ctx, userId: user.id },
    {
      quote_value: Math.round(q.valueCents / 100),
      contract_months: q.termMonths,
    },
  );
  await trackServer(
    "Plan Upgraded",
    { ...ctx, userId: user.id },
    {
      from_plan: before?.planTier ?? "trial",
      to_plan: "enterprise",
      billing_interval: "yearly",
      mrr_delta: Math.round(q.valueCents / q.termMonths) / 100,
    },
  );
  for (const b of await billingContacts(accountId))
    await sendEmail({
      toUserId: b.id,
      to: b.email,
      type: "billing",
      subject: "Your Ripplewise Enterprise contract is signed",
      text: `Enterprise is active for ${q.seats} seats until ${ends.toISOString().slice(0, 10)} (${q.termMonths} months, ${usd(q.valueCents)} total, invoiced). Signed by ${sig}.\n\nYou can see the plan on Billing.`,
    });
  return { ok: true, contractId: c!.id };
}
