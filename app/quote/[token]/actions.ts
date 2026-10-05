"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { eq } from "drizzle-orm";
import { db, users } from "@/db/client";
import { acceptQuote, findQuote, signContract, signingAccount } from "@/lib/sales/service";

async function who() {
  const session = await auth();
  if (!session?.user?.id) return null;
  const [u] = await db.select().from(users).where(eq(users.id, session.user.id));
  return u ?? null;
}

export async function acceptAction(token: string) {
  const u = await who();
  if (!u) return { ok: false as const, error: "Log in to accept this quote." };
  const f = await findQuote(token);
  if (!f) return { ok: false as const, error: "We couldn't find that quote." };
  if (!(await signingAccount(u.id, f.request.accountId)))
    return {
      ok: false as const,
      error: "Only an owner or admin of the account being upgraded can accept this quote.",
    };
  const r = await acceptQuote(token);
  revalidatePath(`/quote/${token}`);
  return r;
}

export async function signAction(token: string, signatureName: string, agree: boolean) {
  const u = await who();
  if (!u) return { ok: false as const, error: "Log in to sign this contract." };
  if (!agree)
    return { ok: false as const, error: "Tick the box to confirm you agree to the terms." };
  const r = await signContract(token, { id: u.id, name: u.name }, signatureName);
  revalidatePath(`/quote/${token}`);
  return r;
}
