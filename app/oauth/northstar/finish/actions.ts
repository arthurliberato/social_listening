"use server";

import { AuthError } from "next-auth";
import { signIn } from "@/auth";
import { safeNext } from "@/lib/auth/recovery";

export async function finishAction(token: string, to: string) {
  try {
    await signIn("northstar", { token, redirectTo: safeNext(to) });
  } catch (e) {
    if (e instanceof AuthError) return { error: "That sign-in attempt expired. Try again." };
    throw e;
  }
  return {};
}
