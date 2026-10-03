import { eq, sql } from "drizzle-orm";
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { z } from "zod";
import authConfig from "./auth.config";
import { db, users } from "./db/client";
import { trackServer } from "./lib/analytics/server";
import { verifyPassword } from "./lib/auth/password";

declare module "next-auth" {
  interface Session {
    user: { id: string; name?: string | null };
  }
}

const Creds = z.object({ email: z.string().email(), password: z.string().min(1) });

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      async authorize(raw) {
        const parsed = Creds.safeParse(raw);
        if (!parsed.success) return null;
        const email = parsed.data.email.toLowerCase();
        const user = (
          await db
            .select()
            .from(users)
            .where(sql`lower(${users.email}) = ${email}`)
            .limit(1)
        )[0];
        if (!user) {
          await trackServer("Login Failed", {}, { error_type: "unknown_email" });
          return null;
        }
        if (!(await verifyPassword(user.passwordHash, parsed.data.password))) {
          await trackServer("Login Failed", { userId: user.id }, { error_type: "bad_password" });
          return null;
        }
        await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
        await trackServer("Login Completed", { userId: user.id }, { method: "password" });
        return { id: user.id, name: user.name };
      },
    }),
  ],
});
