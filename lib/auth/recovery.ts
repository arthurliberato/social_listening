// Password reset and magic-link login. Both answer identically whether or not the email has an account
// (no way to probe who is registered), are rate limited per account, and use single-use hashed tokens.
import { eq, sql } from "drizzle-orm";
import { db, users } from "@/db/client";
import { hashPassword } from "@/lib/auth/password";
import { clearFailures } from "@/lib/auth/throttle";
import { consumeToken, issueToken, recentTokenCount, revokeTokens } from "@/lib/auth/tokens";
import { APP_URL, sendEmail } from "@/lib/email/service";
import { simNow } from "@/lib/simclock";

export const RESET_TTL_MS = 60 * 60_000;
export const MAGIC_TTL_MS = 15 * 60_000;
export const MAX_PER_HOUR = 3;
export const MIN_PASSWORD = 10;

const findUser = async (email: string) =>
  (
    await db
      .select()
      .from(users)
      .where(sql`lower(${users.email}) = ${email.trim().toLowerCase()}`)
      .limit(1)
  )[0];

/** Only same-site paths: stops a login link being used as an open redirect. */
export const safeNext = (n: string | null | undefined) =>
  n && n.startsWith("/") && !n.startsWith("//") && !n.includes("\\") ? n : "/";

export async function requestPasswordReset(email: string): Promise<void> {
  const u = await findUser(email);
  if (!u) return;
  if (
    (await recentTokenCount(u.id, "reset_password", new Date(simNow().getTime() - 3_600_000))) >=
    MAX_PER_HOUR
  )
    return;
  const token = await issueToken(u.id, "reset_password", RESET_TTL_MS);
  await sendEmail({
    toUserId: u.id,
    to: u.email,
    type: "security",
    subject: "Reset your Ripplewise password",
    text: `Someone asked to reset the password for this account.\n\nChoose a new one here (valid for 1 hour, works once):\n${APP_URL}/reset?token=${token}\n\nIf this wasn't you, ignore this email. Your password stays as it is.`,
  });
}

export type ResetResult = { ok: true } | { ok: false; error: string };

export async function resetPassword(token: string, password: string): Promise<ResetResult> {
  if (password.length < MIN_PASSWORD)
    return { ok: false, error: `Use at least ${MIN_PASSWORD} characters.` };
  if (password.length > 200) return { ok: false, error: "That password is too long." };
  const userId = await consumeToken(token, "reset_password");
  if (!userId)
    return { ok: false, error: "This link has expired or was already used. Ask for a new one." };
  const now = simNow();
  const [u] = await db
    .update(users)
    .set({
      passwordHash: await hashPassword(password),
      passwordChangedAt: now,
      // Reaching the reset link proves they own the inbox.
      emailVerifiedAt: sql`coalesce(${users.emailVerifiedAt}, ${now})`,
    })
    .where(eq(users.id, userId))
    .returning();
  await revokeTokens(userId, ["reset_password", "magic_link"]);
  await clearFailures(u!.email);
  await sendEmail({
    toUserId: userId,
    to: u!.email,
    type: "security",
    subject: "Your Ripplewise password was changed",
    text: `The password for this account was just changed, and every device was signed out.\n\nIf that was you, there's nothing to do. If not, reset it again right away: ${APP_URL}/forgot`,
  });
  return { ok: true };
}

export async function requestMagicLink(email: string, next?: string): Promise<void> {
  const u = await findUser(email);
  if (!u) return;
  if ((await recentTokenCount(u.id, "magic_link", new Date(simNow().getTime() - 3_600_000))) >= 5)
    return;
  const token = await issueToken(u.id, "magic_link", MAGIC_TTL_MS);
  const n = safeNext(next);
  await sendEmail({
    toUserId: u.id,
    to: u.email,
    type: "security",
    subject: "Your Ripplewise login link",
    text: `Use this link to log in (valid for 15 minutes, works once):\n${APP_URL}/login/magic?token=${token}${n !== "/" ? `&next=${encodeURIComponent(n)}` : ""}\n\nIf you didn't ask for it, ignore this email.`,
  });
}
