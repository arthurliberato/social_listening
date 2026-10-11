"use server";

import { and, desc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { authTokens, db } from "@/db/client";
import { sendVerification } from "@/lib/auth/signup";
import { requireUser } from "@/lib/auth/session";
import { simNow } from "@/lib/simclock";

const RESEND_COOLDOWN_MS = 60_000;

export async function resendVerification(): Promise<{ ok: boolean; waitSeconds?: number }> {
  const user = await requireUser();
  if (user.emailVerifiedAt) return { ok: true };
  const last = (
    await db
      .select({ createdAt: authTokens.createdAt })
      .from(authTokens)
      .where(and(eq(authTokens.userId, user.id), eq(authTokens.type, "verify_email")))
      .orderBy(desc(authTokens.createdAt))
      .limit(1)
  )[0];
  const wait = last ? RESEND_COOLDOWN_MS - (simNow().getTime() - last.createdAt.getTime()) : 0;
  if (wait > 0) return { ok: false, waitSeconds: Math.ceil(wait / 1000) };
  await sendVerification(user.id, user.email);
  revalidatePath("/verify");
  return { ok: true };
}
