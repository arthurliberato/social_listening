"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import { billingScope } from "@/lib/billing/context";
import { updateCard } from "@/lib/billing/lifecycle";
import { INTERVALS, type Interval } from "@/lib/billing/pricing";
import {
  acceptSaveOffer,
  CANCEL_REASONS,
  cancelScheduledChange,
  changePlan,
  confirmCancel,
  resumeSubscription,
  showSaveOffer,
  subscribe,
  type ChangeResult,
} from "@/lib/billing/service";
import { simNow } from "@/lib/simclock";

type Fail = { ok: false; error: string; field?: string; blockers?: string[] };

/** Every billing action runs as an owner/admin of the account, resolved on the server, never from the request. */
async function manager() {
  const user = await requireUser();
  const scope = await billingScope(user.id);
  if (!scope || !scope.canManage)
    return {
      fail: { ok: false, error: "Only a workspace owner or admin can change billing." } as Fail,
    };
  return { scope };
}

const CardSchema = z.object({
  number: z.string().max(30),
  expMonth: z.number().int(),
  expYear: z.number().int(),
  cvc: z.string().max(5),
  name: z.string().max(100),
});
const Plan = z.object({
  tier: z.string().max(20),
  interval: z.enum(INTERVALS as [Interval, ...Interval[]]),
});

export async function checkoutAction(
  input: unknown,
): Promise<{ ok: true; invoiceNumber: string } | Fail> {
  const m = await manager();
  if (m.fail) return m.fail;
  const p = Plan.extend({ card: CardSchema.optional() }).safeParse(input);
  if (!p.success)
    return { ok: false, error: "Something in that form wasn't right. Check it and try again." };
  const r = await subscribe({ accountId: m.scope.accountId, ...p.data });
  if (r.ok) revalidatePath("/settings/billing");
  return r;
}

export async function changePlanAction(input: unknown): Promise<ChangeResult> {
  const m = await manager();
  if (m.fail) return m.fail;
  const p = Plan.safeParse(input);
  if (!p.success) return { ok: false, error: "Choose a plan." };
  const r = await changePlan({ accountId: m.scope.accountId, ...p.data });
  if (r.ok) revalidatePath("/settings/billing");
  return r;
}

export async function updateCardAction(
  input: unknown,
): Promise<{ ok: true; recovered: boolean } | Fail> {
  const m = await manager();
  if (m.fail) return m.fail;
  const p = CardSchema.safeParse(input);
  if (!p.success) return { ok: false, error: "Check the card details and try again." };
  const r = await updateCard({ accountId: m.scope.accountId, card: p.data }, simNow());
  if (!r.ok) return r;
  revalidatePath("/settings/billing");
  return { ok: true, recovered: r.retried === "retry_succeeded" };
}

export async function keepCurrentPlanAction(): Promise<{ ok: true } | Fail> {
  const m = await manager();
  if (m.fail) return m.fail;
  await cancelScheduledChange(m.scope.accountId);
  revalidatePath("/settings/billing");
  return { ok: true };
}

/** Reaching the confirm step shows the save offer, at most once per account, ever. */
export async function saveOfferAction(): Promise<{ ok: true; show: boolean } | Fail> {
  const m = await manager();
  if (m.fail) return m.fail;
  return { ok: true, show: await showSaveOffer(m.scope.accountId) };
}

export async function acceptOfferAction(): Promise<{ ok: true } | Fail> {
  const m = await manager();
  if (m.fail) return m.fail;
  const r = await acceptSaveOffer(m.scope.accountId);
  if (r.ok) revalidatePath("/settings/billing");
  return r;
}

export async function cancelAction(reason: string): Promise<{ ok: true; endsOn: string } | Fail> {
  const m = await manager();
  if (m.fail) return m.fail;
  const p = z.enum(CANCEL_REASONS).safeParse(reason);
  if (!p.success) return { ok: false, error: "Tell us the main reason, so we can do better." };
  const r = await confirmCancel({ accountId: m.scope.accountId, reason: p.data });
  if (!r.ok) return r;
  revalidatePath("/settings/billing");
  return { ok: true, endsOn: r.endsOn.toISOString() };
}

export async function resumeAction(): Promise<{ ok: true } | Fail> {
  const m = await manager();
  if (m.fail) return m.fail;
  const r = await resumeSubscription(m.scope.accountId);
  if (r.ok) revalidatePath("/settings/billing");
  return r;
}
