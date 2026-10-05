"use server";

import { AuthError } from "next-auth";
import { signIn } from "@/auth";
import { requestMagicLink, safeNext } from "@/lib/auth/recovery";

/** Same answer for every address. */
export async function magicRequestAction(_p: { sent?: boolean; email?: string }, form: FormData) {
  const email = String(form.get("email") ?? "").trim();
  if (email && email.length < 255 && email.includes("@"))
    await requestMagicLink(email, String(form.get("next") ?? ""));
  return { sent: true, email };
}

export async function magicLoginAction(token: string, next: string) {
  try {
    await signIn("magic-link", { token, redirectTo: safeNext(next) });
  } catch (e) {
    if (e instanceof AuthError) return { error: "This link has expired or was already used." };
    throw e;
  }
  return {};
}
