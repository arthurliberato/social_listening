import { NextResponse } from "next/server";
import NextAuth from "next-auth";
import authConfig from "./auth.config";
import {
  SESSION_COOKIE,
  SESSION_HEADER,
  SESSION_IDLE_SECONDS,
} from "./lib/analytics/session-constants";

const { auth } = NextAuth(authConfig);

// The route guard lives in auth.config's `authorized` callback. This wrapper forwards the request path to server
// components (x-pathname), so role checks can know which section of a workspace is being opened, and keeps the
// visit's id: a cookie that slides 30 minutes on every page request, also passed on as a header so the first request
// of a visit already carries it (see lib/analytics/session.ts).
export default auth((req) => {
  const headers = new Headers(req.headers);
  headers.set("x-pathname", req.nextUrl.pathname);
  const existing = req.cookies.get(SESSION_COOKIE)?.value;
  const sid = existing && /^[0-9a-f-]{36}$/.test(existing) ? existing : crypto.randomUUID();
  headers.set(SESSION_HEADER, sid);
  const res = NextResponse.next({ request: { headers } });
  res.cookies.set(SESSION_COOKIE, sid, {
    path: "/",
    maxAge: SESSION_IDLE_SECONDS,
    sameSite: "lax",
    httpOnly: true,
  });
  return res;
});

export const config = { matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"] };
