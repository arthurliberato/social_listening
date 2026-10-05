"use server";

import { redirect } from "next/navigation";
import { resetPassword } from "@/lib/auth/recovery";

export async function resetAction(_p: { error?: string }, form: FormData) {
  const r = await resetPassword(
    String(form.get("token") ?? ""),
    String(form.get("password") ?? ""),
  );
  if (!r.ok) return { error: r.error };
  redirect("/login?reset=1");
}
