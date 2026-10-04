// "Northstar ID": a SIMULATED identity provider, so sign-in-with-a-provider can be built and tested end
// to end without a real one. It is deliberately boxed in so it can't be used to reach real accounts:
//  - identities live only on its own domain (username@northstar-id.test); anyone can claim any username there,
//    so those identities are never treated as proof of owning a real email address;
//  - it can only sign in accounts it created itself (users.oauth_provider), never a password account.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { sql } from "drizzle-orm";
import { db, users } from "@/db/client";
import { createAccountAndUser } from "@/lib/auth/signup";
import { issueToken } from "@/lib/auth/tokens";
import { readSimContext } from "@/lib/sim-context";

export const PROVIDER = "northstar";
import { DOMAIN } from "./oauth-domain";
export { DOMAIN };
export const CODE_TTL_MS = 2 * 60_000;

const secret = () => {
  const s = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;
  if (!s && process.env.NODE_ENV === "production") throw new Error("AUTH_SECRET is not set");
  return s ?? "dev-only-oauth-sim-secret";
};
const sign = (body: string) => createHmac("sha256", secret()).update(body).digest("base64url");

export interface CodePayload {
  username: string;
  name: string;
  nonce: string;
  exp: number;
}

/** The provider's authorization code: a short-lived, signed statement of who approved the request. */
export function makeCode(username: string, name: string, now = Date.now()): string {
  const body = Buffer.from(
    JSON.stringify({
      username,
      name,
      nonce: randomBytes(8).toString("hex"),
      exp: now + CODE_TTL_MS,
    }),
  ).toString("base64url");
  return `${body}.${sign(body)}`;
}

export function readCode(code: string, now = Date.now()): CodePayload | null {
  const [body, sig] = code.split(".");
  if (!body || !sig) return null;
  const want = Buffer.from(sign(body));
  const got = Buffer.from(sig);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString()) as CodePayload;
    return p.exp > now && p.username ? p : null;
  } catch {
    return null;
  }
}

export const normalizeUsername = (raw: string) =>
  raw
    .trim()
    .toLowerCase()
    .replace(/@.*$/, "")
    .replace(/[^a-z0-9._-]/g, "")
    .slice(0, 40);

export type Exchange =
  | { ok: true; token: string; created: boolean }
  | { ok: false; error: "bad_code" | "account_exists" };

/** Turn a verified provider code into a single-use login token, creating the account on first use. */
export async function exchangeCode(code: string): Promise<Exchange> {
  const p = readCode(code);
  if (!p) return { ok: false, error: "bad_code" };
  const email = `${p.username}@${DOMAIN}`;
  const [existing] = await db
    .select()
    .from(users)
    .where(sql`lower(${users.email}) = ${email}`)
    .limit(1);
  let userId: string;
  let created = false;
  if (existing) {
    if (existing.oauthProvider !== PROVIDER) return { ok: false, error: "account_exists" };
    userId = existing.id;
  } else {
    const name = p.name.trim() || p.username;
    const r = await createAccountAndUser({
      name,
      email,
      password: "",
      company: `${name}'s team`,
      attribution: {},
      sim: await readSimContext(),
      oauth: PROVIDER,
    });
    if (!r.ok) return { ok: false, error: "account_exists" };
    userId = r.userId;
    created = true;
  }
  return { ok: true, token: await issueToken(userId, "oauth_login", 60_000), created };
}
