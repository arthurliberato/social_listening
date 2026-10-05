"use server";

import { requestPasswordReset } from "@/lib/auth/recovery";

/** Same answer for every address, so the form can't be used to find out who has an account. */
export async function forgotAction(_p: { sent?: boolean }, form: FormData) {
  const email = String(form.get("email") ?? "").trim();
  if (email && email.length < 255 && email.includes("@")) await requestPasswordReset(email);
  return { sent: true, email };
}
