import { eq, sql } from "drizzle-orm";
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { z } from "zod";
import authConfig from "./auth.config";
import { db, users } from "./db/client";
import { trackServer } from "./lib/analytics/server";
import { verifyPassword } from "./lib/auth/password";
import { clearFailures, lockedUntil, recordFailure } from "./lib/auth/throttle";
import { consumeToken } from "./lib/auth/tokens";
import { simNow } from "@/lib/simclock";

declare module "@auth/core/jwt" {
  interface JWT {
    uid?: string;
    pc?: number;
  }
}

declare module "next-auth" {
  interface Session {
    user: { id: string; name?: string | null };
  }
}

const Creds = z.object({ email: z.string().email(), password: z.string().min(1) });

/** A provider that signs in whoever holds a valid single-use token of `type` (magic link, simulated OAuth). */
const tokenProvider = (id: string, type: string, method: string) =>
  Credentials({
    id,
    credentials: { token: {} },
    async authorize(raw) {
      const token = typeof raw?.token === "string" ? raw.token : "";
      const userId = token ? await consumeToken(token, type) : null;
      if (!userId) {
        await trackServer("Login Failed", {}, { error_type: "bad_token" });
        return null;
      }
      const [user] = await db.select().from(users).where(eq(users.id, userId));
      if (!user) return null;
      await clearFailures(user.email);
      await db
        .update(users)
        .set({
          lastLoginAt: simNow(),
          emailVerifiedAt: sql`coalesce(${users.emailVerifiedAt}, now())`,
        })
        .where(eq(users.id, user.id));
      await trackServer("Login Completed", { userId: user.id }, { method });
      return { id: user.id, name: user.name };
    },
  });

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  callbacks: {
    ...authConfig.callbacks,
    /**
     * The token remembers the account's password-change stamp from sign-in; if the password has changed
     * since, the session is signed out wherever it is read. (A claim, not `iat`: the edge middleware can
     * re-issue the cookie, which would refresh `iat`.)
     */
    async jwt({ token, user }) {
      const id = (user?.id ?? token.uid) as string | undefined;
      if (!id) return token;
      const [u] = await db
        .select({ changed: users.passwordChangedAt })
        .from(users)
        .where(eq(users.id, id));
      if (!u) return null;
      const stamp = u.changed?.getTime() ?? 0;
      if (user?.id) {
        token.uid = user.id;
        token.pc = stamp;
      } else if ((token.pc ?? 0) !== stamp) return null;
      return token;
    },
  },
  providers: [
    tokenProvider("magic-link", "magic_link", "magic_link"),
    tokenProvider("northstar", "oauth_login", "oauth_northstar"),
    Credentials({
      async authorize(raw) {
        const parsed = Creds.safeParse(raw);
        if (!parsed.success) return null;
        const email = parsed.data.email.toLowerCase();
        // Enforced here, not just in the form, so posting straight to the auth endpoint is throttled too.
        if (await lockedUntil(email)) {
          await trackServer("Login Failed", {}, { error_type: "throttled" });
          return null;
        }
        const user = (
          await db
            .select()
            .from(users)
            .where(sql`lower(${users.email}) = ${email}`)
            .limit(1)
        )[0];
        if (!user) {
          await recordFailure(email);
          await trackServer("Login Failed", {}, { error_type: "unknown_email" });
          return null;
        }
        if (!(await verifyPassword(user.passwordHash, parsed.data.password))) {
          await recordFailure(email);
          await trackServer("Login Failed", { userId: user.id }, { error_type: "bad_password" });
          return null;
        }
        await clearFailures(email);
        await db.update(users).set({ lastLoginAt: simNow() }).where(eq(users.id, user.id));
        await trackServer("Login Completed", { userId: user.id }, { method: "password" });
        return { id: user.id, name: user.name };
      },
    }),
  ],
});
