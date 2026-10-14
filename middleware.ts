import { NextResponse } from "next/server";
import NextAuth from "next-auth";
import authConfig from "./auth.config";
import { resolveSession, SESSION_COOKIE, SESSION_HEADER } from "./lib/analytics/session-constants";

const { auth } = NextAuth(authConfig);

// The route guard lives in auth.config's `authorized` callback. This wrapper forwards the request path to server
// components (x-pathname), so role checks can know which section of a workspace is being opened, and works out which
// visit the request belongs to (see lib/analytics/session-constants.ts), passing its id on as a header so the first
// request of a visit already carries it. The cookie is only rewritten every few minutes: setting one on every response
// makes Next re-render the page on screen.
export default auth((req) => {
  const headers = new Headers(req.headers);
  headers.set("x-pathname", req.nextUrl.pathname);
  const { id, set } = resolveSession(
    req.cookies.get(SESSION_COOKIE)?.value,
    Math.floor(Date.now() / 1000),
    () => crypto.randomUUID(),
  );
  headers.set(SESSION_HEADER, id);
  const res = NextResponse.next({ request: { headers } });
  if (set)
    res.cookies.set(SESSION_COOKIE, set.value, {
      path: "/",
      maxAge: set.maxAge,
      sameSite: "lax",
      httpOnly: true,
    });
  return res;
});

export const config = { matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"] };
