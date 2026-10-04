import { and, eq, sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { accounts, db, emails, memberships, pool, users } from "@/db/client";
import { hashPassword, verifyPassword } from "./password";
import { DOMAIN, exchangeCode, makeCode, normalizeUsername, readCode } from "./oauth-sim";
import { requestMagicLink, requestPasswordReset, resetPassword, safeNext } from "./recovery";
import { consumeToken, issueToken, peekToken } from "./tokens";

afterAll(() => pool.end());
const rnd = () => Math.random().toString(36).slice(2, 9);

async function user() {
  const [u] = await db
    .insert(users)
    .values({
      email: `rec-${rnd()}@example.test`,
      passwordHash: await hashPassword("old password 123"),
      name: "Rec",
    })
    .returning();
  return u!;
}
const mailsTo = (addr: string, subjectLike: string) =>
  db
    .select()
    .from(emails)
    .where(and(eq(emails.toAddress, addr), sql`${emails.subject} LIKE ${subjectLike}`));
const tokenIn = (body: string, path: string) =>
  new RegExp(`${path}\\?token=([A-Za-z0-9_-]+)`).exec(body)![1]!;

describe("password reset", () => {
  it("answers silently for an unknown address and emails a known one", async () => {
    const before = (await db.select().from(emails)).length;
    await requestPasswordReset(`nobody-${rnd()}@example.test`);
    expect((await db.select().from(emails)).length).toBe(before);
    const u = await user();
    await requestPasswordReset(u.email.toUpperCase());
    const [m] = await mailsTo(u.email, "Reset your%");
    expect(m!.type).toBe("security");
    expect(await peekToken(tokenIn(m!.bodyText, "/reset"), "reset_password")).toBe(true);
  });

  it("is rate limited per account", async () => {
    const u = await user();
    for (let i = 0; i < 6; i++) await requestPasswordReset(u.email);
    expect(await mailsTo(u.email, "Reset your%")).toHaveLength(3);
  });

  it("sets the password once, signs sessions out, and tells the owner", async () => {
    const u = await user();
    await requestPasswordReset(u.email);
    const token = tokenIn((await mailsTo(u.email, "Reset your%"))[0]!.bodyText, "/reset");
    // Too short: refused, and the link still works afterwards.
    expect(await resetPassword(token, "short")).toMatchObject({ ok: false });
    expect(await peekToken(token, "reset_password")).toBe(true);
    expect(await resetPassword(token, "a brand new passphrase")).toEqual({ ok: true });
    const [after] = await db.select().from(users).where(eq(users.id, u.id));
    expect(await verifyPassword(after!.passwordHash, "a brand new passphrase")).toBe(true);
    expect(await verifyPassword(after!.passwordHash, "old password 123")).toBe(false);
    expect(after!.passwordChangedAt).not.toBeNull();
    expect(after!.emailVerifiedAt).not.toBeNull();
    expect(await resetPassword(token, "another passphrase here")).toMatchObject({ ok: false }); // single use
    expect(await mailsTo(u.email, "Your Ripplewise password was changed")).toHaveLength(1);
  });

  it("an expired link and a link of the wrong kind are refused", async () => {
    const u = await user();
    const old = await issueToken(u.id, "reset_password", -1000);
    expect(await resetPassword(old, "a brand new passphrase")).toMatchObject({ ok: false });
    const magic = await issueToken(u.id, "magic_link", 60_000);
    expect(await resetPassword(magic, "a brand new passphrase")).toMatchObject({ ok: false });
    expect(await peekToken(magic, "magic_link")).toBe(true); // wasn't burned by the failed attempt
  });

  it("changing the password retires any pending login links", async () => {
    const u = await user();
    const magic = await issueToken(u.id, "magic_link", 60_000);
    const reset = await issueToken(u.id, "reset_password", 60_000);
    await resetPassword(reset, "a brand new passphrase");
    expect(await peekToken(magic, "magic_link")).toBe(false);
  });
});

describe("magic links", () => {
  it("emails a single-use 15-minute link only to a known address, keeping a safe next path", async () => {
    const u = await user();
    await requestMagicLink(`nobody-${rnd()}@example.test`);
    await requestMagicLink(u.email, "/w/acme/home");
    const [m] = await mailsTo(u.email, "Your Ripplewise login link");
    expect(m!.bodyText).toContain("next=%2Fw%2Facme%2Fhome");
    const token = tokenIn(m!.bodyText, "/login/magic");
    expect(await consumeToken(token, "magic_link")).toBe(u.id);
    expect(await consumeToken(token, "magic_link")).toBeNull();
  });
  it("won't carry an off-site next path", async () => {
    const u = await user();
    await requestMagicLink(u.email, "https://evil.example/x");
    expect((await mailsTo(u.email, "Your Ripplewise login link"))[0]!.bodyText).not.toContain(
      "next=",
    );
    for (const bad of [
      "//evil.example",
      "https://x.y",
      "javascript:alert(1)",
      "/\\evil",
      "",
      null,
      undefined,
    ])
      expect(safeNext(bad)).toBe("/");
    expect(safeNext("/w/a/b?c=1")).toBe("/w/a/b?c=1");
  });
});

describe("simulated Northstar ID", () => {
  it("codes are signed and expire", () => {
    const code = makeCode("ada", "Ada");
    expect(readCode(code)).toMatchObject({ username: "ada", name: "Ada" });
    const [body, sig] = code.split(".");
    expect(readCode(`${body}.${sig!.slice(0, -2)}xx`)).toBeNull();
    const forged = Buffer.from(
      JSON.stringify({ username: "root", name: "x", nonce: "n", exp: Date.now() + 1e6 }),
    ).toString("base64url");
    expect(readCode(`${forged}.${sig}`)).toBeNull();
    expect(readCode(code, Date.now() + 3 * 60_000)).toBeNull();
    expect(readCode("garbage")).toBeNull();
  });

  it("normalises usernames to a safe form, never an email on another domain", () => {
    expect(normalizeUsername("  Ada.Lovelace@gmail.com ")).toBe("ada.lovelace");
    expect(normalizeUsername("A b/c;d")).toBe("abcd");
  });

  it("creates a verified, passwordless account on first use and reuses it after", async () => {
    const name = `ada${rnd()}`;
    const r1 = await exchangeCode(makeCode(name, "Ada L"));
    expect(r1).toMatchObject({ ok: true, created: true });
    const [u] = await db
      .select()
      .from(users)
      .where(eq(users.email, `${name}@${DOMAIN}`));
    expect(u).toMatchObject({ oauthProvider: "northstar", name: "Ada L" });
    expect(u!.emailVerifiedAt).not.toBeNull();
    const [m] = await db.select().from(memberships).where(eq(memberships.userId, u!.id));
    expect(m!.role).toBe("owner");
    expect(
      (await db.select().from(accounts).where(eq(accounts.id, m!.accountId)))[0]!.planTier,
    ).toBe("trial");
    expect(await mailsTo(u!.email, "Verify your email%")).toHaveLength(0);
    // Nobody can password-login to it without a reset.
    expect(await verifyPassword(u!.passwordHash, "")).toBe(false);
    const r2 = await exchangeCode(makeCode(name, "Ada L"));
    expect(r2).toMatchObject({ ok: true, created: false });
    if (r1.ok && r2.ok) expect(await consumeToken(r1.token, "oauth_login")).toBe(u!.id);
  }, 30_000);

  it("never signs in an account it didn't create, even on its own domain", async () => {
    const name = `taken${rnd()}`;
    await db.insert(users).values({
      email: `${name}@${DOMAIN}`,
      passwordHash: await hashPassword("a real password 1"),
      name: "Real",
    });
    expect(await exchangeCode(makeCode(name, "Mallory"))).toEqual({
      ok: false,
      error: "account_exists",
    });
    expect(await exchangeCode("nope")).toEqual({ ok: false, error: "bad_code" });
  });
});
