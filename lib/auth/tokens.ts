import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, inArray, isNull } from "drizzle-orm";
import { authTokens, db } from "@/db/client";

const sha = (t: string) => createHash("sha256").update(t).digest("hex");

/** Create a single-use token; only its hash is stored. Returns the raw token for the link. */
export async function issueToken(userId: string, type: string, ttlMs: number): Promise<string> {
  const raw = randomBytes(24).toString("base64url");
  await db
    .insert(authTokens)
    .values({ userId, type, tokenHash: sha(raw), expiresAt: new Date(Date.now() + ttlMs) });
  return raw;
}

/** Atomically consume a token; returns the user id or null if unknown / expired / used. */
export async function consumeToken(raw: string, type: string): Promise<string | null> {
  const rows = await db
    .update(authTokens)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(authTokens.tokenHash, sha(raw)),
        eq(authTokens.type, type),
        isNull(authTokens.usedAt),
        gt(authTokens.expiresAt, new Date()),
      ),
    )
    .returning({ userId: authTokens.userId });
  return rows[0]?.userId ?? null;
}

export const hashToken = sha;

/** Is this token still usable? Doesn't consume it, so mail scanners that open links can't burn it. */
export async function peekToken(raw: string, type: string): Promise<boolean> {
  const rows = await db
    .select({ id: authTokens.id })
    .from(authTokens)
    .where(
      and(
        eq(authTokens.tokenHash, sha(raw)),
        eq(authTokens.type, type),
        isNull(authTokens.usedAt),
        gt(authTokens.expiresAt, new Date()),
      ),
    );
  return rows.length > 0;
}

/** Retire every unused token of these types for a user (after a password change, say). */
export async function revokeTokens(userId: string, types: string[]) {
  await db
    .update(authTokens)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(authTokens.userId, userId),
        isNull(authTokens.usedAt),
        inArray(authTokens.type, types),
      ),
    );
}

/** How many tokens of a type were issued for a user since `since` (for rate limits). */
export async function recentTokenCount(userId: string, type: string, since: Date) {
  const rows = await db
    .select({ id: authTokens.id })
    .from(authTokens)
    .where(
      and(
        eq(authTokens.userId, userId),
        eq(authTokens.type, type),
        gt(authTokens.createdAt, since),
      ),
    );
  return rows.length;
}
