import { NextResponse } from "next/server";
import NextAuth from "next-auth";
import authConfig from "./auth.config";

const { auth } = NextAuth(authConfig);

// The route guard lives in auth.config's `authorized` callback. This wrapper only forwards the request path
// to server components (x-pathname), so role checks can know which section of a workspace is being opened.
export default auth((req) => {
  const headers = new Headers(req.headers);
  headers.set("x-pathname", req.nextUrl.pathname);
  return NextResponse.next({ request: { headers } });
});

export const config = { matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"] };
