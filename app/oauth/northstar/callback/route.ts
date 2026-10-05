import { NextResponse, type NextRequest } from "next/server";
import { exchangeCode } from "@/lib/auth/oauth-sim";
import { safeNext } from "@/lib/auth/recovery";

const back = (req: NextRequest, why: string) => {
  const res = NextResponse.redirect(new URL(`/login?oauth=${why}`, req.nextUrl.origin));
  res.cookies.delete({ name: "ns_state", path: "/oauth/northstar" });
  return res;
};

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const state = q.get("state") ?? "";
  const cookie = req.cookies.get("ns_state")?.value;
  // The state must match the one this browser started with, or the response belongs to someone else's flow.
  if (!state || !cookie || state !== cookie) return back(req, "bad_state");
  const r = await exchangeCode(q.get("code") ?? "");
  if (!r.ok) return back(req, r.error === "account_exists" ? "exists" : "bad_code");
  const next = safeNext(q.get("next"));
  // Hand the single-use token to the finishing page, which signs in through a server action
  // (the one place Auth.js reliably sets the session cookie and redirects).
  const to = new URL("/oauth/northstar/finish", req.nextUrl.origin);
  to.searchParams.set("token", r.token);
  to.searchParams.set("to", r.created ? "/onboarding" : next);
  const res = NextResponse.redirect(to);
  res.cookies.delete({ name: "ns_state", path: "/oauth/northstar" });
  return res;
}
