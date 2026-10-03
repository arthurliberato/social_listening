// Edge-safe config shared with middleware (no Node-only imports such as argon2 or pg).
import type { NextAuthConfig } from "next-auth";

const PROTECTED = [/^\/w(\/|$)/, /^\/onboarding/, /^\/settings/, /^\/inbox/];

export default {
  session: { strategy: "jwt", maxAge: 60 * 60 * 24 * 30 },
  pages: { signIn: "/login" },
  providers: [],
  callbacks: {
    authorized({ auth, request }) {
      const path = request.nextUrl.pathname;
      return PROTECTED.some((re) => re.test(path)) ? !!auth?.user : true;
    },
    jwt({ token, user }) {
      if (user?.id) token.uid = user.id;
      return token;
    },
    session({ session, token }) {
      if (token.uid && session.user) session.user.id = token.uid as string;
      return session;
    },
  },
} satisfies NextAuthConfig;
