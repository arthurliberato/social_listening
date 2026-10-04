// Failed-login throttling: MAX_FAILURES wrong passwords within WINDOW locks that email for LOCK_MS.
// Keyed by the (hashed) email string whether or not an account exists, so a lock never reveals who is registered.
// Taking a failure is one atomic upsert, so a burst of parallel guesses can't slip past the limit.
import { createHash } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { db, loginThrottle } from "@/db/client";

export const MAX_FAILURES = 5;
export const WINDOW_MS = 15 * 60_000;
export const LOCK_MS = 15 * 60_000;

const keyOf = (email: string) =>
  createHash("sha256").update(email.trim().toLowerCase()).digest("hex");

/** When the lock ends, or null if logging in is allowed. */
export async function lockedUntil(email: string, now: Date = new Date()): Promise<Date | null> {
  const [r] = await db
    .select({ until: loginThrottle.lockedUntil })
    .from(loginThrottle)
    .where(eq(loginThrottle.keyHash, keyOf(email)));
  return r?.until && r.until > now ? r.until : null;
}

export async function recordFailure(email: string, now: Date = new Date()): Promise<void> {
  const k = keyOf(email);
  const fresh = new Date(now.getTime() - WINDOW_MS);
  await db.execute(sql`
    INSERT INTO login_throttle (key_hash, failures, window_start, locked_until)
    VALUES (${k}, 1, ${now}, NULL)
    ON CONFLICT (key_hash) DO UPDATE SET
      failures = CASE WHEN login_throttle.window_start < ${fresh} THEN 1 ELSE login_throttle.failures + 1 END,
      window_start = CASE WHEN login_throttle.window_start < ${fresh} THEN ${now} ELSE login_throttle.window_start END,
      locked_until = CASE
        WHEN (CASE WHEN login_throttle.window_start < ${fresh} THEN 1 ELSE login_throttle.failures + 1 END) >= ${MAX_FAILURES}
        THEN ${new Date(now.getTime() + LOCK_MS)}
        ELSE login_throttle.locked_until END`);
}

/** A successful login, or proving ownership of the inbox (reset / magic link), clears the slate. */
export async function clearFailures(email: string): Promise<void> {
  await db.delete(loginThrottle).where(eq(loginThrottle.keyHash, keyOf(email)));
}

export const minutesLeft = (until: Date, now: Date = new Date()) =>
  Math.max(1, Math.ceil((until.getTime() - now.getTime()) / 60_000));
