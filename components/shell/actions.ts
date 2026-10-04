"use server";

import { signOut } from "@/auth";

/** `next` (an in-app path) is where the login page should send them afterwards, e.g. back to an invitation. */
export async function logOut(next?: string) {
  const safe =
    next && next.startsWith("/") && !next.startsWith("//")
      ? `?next=${encodeURIComponent(next)}`
      : "";
  await signOut({ redirectTo: `/login${safe}` });
}
