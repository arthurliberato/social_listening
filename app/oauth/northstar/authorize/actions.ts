"use server";

import { makeCode, normalizeUsername } from "@/lib/auth/oauth-sim";
import { safeNext } from "@/lib/auth/recovery";

/** Returns the callback URL for the browser to navigate to (a real GET; a server-action redirect would re-POST it). */
export async function approve(_p: { error?: string; url?: string }, form: FormData) {
  const username = normalizeUsername(String(form.get("username") ?? ""));
  if (username.length < 3) return { error: "Choose a username of at least 3 letters or numbers." };
  const name =
    String(form.get("name") ?? "")
      .trim()
      .slice(0, 100) || username;
  const state = String(form.get("state") ?? "");
  const next = safeNext(String(form.get("next") ?? ""));
  const q = new URLSearchParams({ code: makeCode(username, name), state });
  if (next !== "/") q.set("next", next);
  return { url: `/oauth/northstar/callback?${q.toString()}` };
}
