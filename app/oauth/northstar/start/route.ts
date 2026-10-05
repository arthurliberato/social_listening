import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { safeNext } from "@/lib/auth/recovery";

/** Begin the (simulated) provider flow: remember a random state in a cookie and send the browser over. */
export function GET(req: NextRequest) {
  const state = randomBytes(16).toString("hex");
  const next = safeNext(req.nextUrl.searchParams.get("next"));
  const url = new URL("/oauth/northstar/authorize", req.nextUrl.origin);
  url.searchParams.set("state", state);
  if (next !== "/") url.searchParams.set("next", next);
  const res = NextResponse.redirect(url);
  res.cookies.set("ns_state", state, {
    httpOnly: true,
    sameSite: "lax",
    maxAge: 600,
    path: "/oauth/northstar",
  });
  return res;
}
