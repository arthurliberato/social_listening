import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { db, loginThrottle, pool } from "@/db/client";
import { hashPassword } from "./password";
import { users } from "@/db/client";
import { requestPasswordReset, resetPassword } from "./recovery";
import {
  clearFailures,
  LOCK_MS,
  lockedUntil,
  MAX_FAILURES,
  minutesLeft,
  recordFailure,
  WINDOW_MS,
} from "./throttle";
import { and, sql } from "drizzle-orm";
import { emails } from "@/db/client";

afterAll(() => pool.end());
const addr = () => `thr-${Math.random().toString(36).slice(2, 9)}@example.test`;

describe("login throttle", () => {
  it("locks on the 5th failure, not before, and is case-insensitive", async () => {
    const e = addr();
    for (let i = 0; i < MAX_FAILURES - 1; i++) await recordFailure(e);
    expect(await lockedUntil(e)).toBeNull();
    await recordFailure(e.toUpperCase());
    const until = await lockedUntil(e);
    expect(until).not.toBeNull();
    expect(until!.getTime() - Date.now()).toBeGreaterThan(LOCK_MS - 5_000);
    expect(minutesLeft(until!)).toBe(15);
  });

  it("tracks addresses with no account too, so a lock never reveals who is registered", async () => {
    const ghost = addr();
    for (let i = 0; i < MAX_FAILURES; i++) await recordFailure(ghost);
    expect(await lockedUntil(ghost)).not.toBeNull();
  });

  it("a burst of parallel guesses is counted exactly, none slip through", async () => {
    const e = addr();
    await Promise.all(Array.from({ length: 12 }, () => recordFailure(e)));
    expect(await lockedUntil(e)).not.toBeNull();
    const rows = await db.select().from(loginThrottle);
    expect(rows.some((r) => r.failures === 12)).toBe(true);
  });

  it("old failures age out of the window, and the lock itself expires", async () => {
    const e = addr();
    const t0 = new Date(Date.now() - WINDOW_MS - 60_000);
    for (let i = 0; i < MAX_FAILURES - 1; i++) await recordFailure(e, t0);
    await recordFailure(e); // the window has passed: this is failure #1, not #5
    expect(await lockedUntil(e)).toBeNull();
    const f = addr();
    for (let i = 0; i < MAX_FAILURES; i++) await recordFailure(f, t0);
    expect(await lockedUntil(f, new Date(t0.getTime() + 1000))).not.toBeNull();
    expect(await lockedUntil(f)).toBeNull(); // 16 minutes later: free again
  });

  it("success (or proving inbox ownership) clears it", async () => {
    const e = addr();
    for (let i = 0; i < MAX_FAILURES; i++) await recordFailure(e);
    await clearFailures(e);
    expect(await lockedUntil(e)).toBeNull();
    await recordFailure(e);
    expect(await lockedUntil(e)).toBeNull(); // starts from one again
  });

  it("a password reset unlocks the account", async () => {
    const e = addr();
    const [u] = await db
      .insert(users)
      .values({ email: e, passwordHash: await hashPassword("old password 123"), name: "T" })
      .returning();
    for (let i = 0; i < MAX_FAILURES; i++) await recordFailure(e);
    expect(await lockedUntil(e)).not.toBeNull();
    await requestPasswordReset(e);
    const [m] = await db
      .select()
      .from(emails)
      .where(and(eq(emails.toUserId, u!.id), sql`${emails.subject} LIKE 'Reset your%'`));
    const token = /token=([A-Za-z0-9_-]+)/.exec(m!.bodyText)![1]!;
    await resetPassword(token, "a brand new passphrase");
    expect(await lockedUntil(e)).toBeNull();
  });
});
