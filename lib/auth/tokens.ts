import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
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
