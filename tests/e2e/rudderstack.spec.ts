import { expect, test } from "@playwright/test";
import { createUser, pool } from "./helpers";

// The whole path to the warehouse, through the real app: a person uses the product in the browser, the browser tells our
// server, the server mirrors each event to Postgres and sends it to RudderStack (a stand-in here, see
// tests/e2e/mock-dataplane.mjs). What reaches RudderStack must be what the mirror recorded, once, with the global
// properties attached and nothing personal in it.
const PLANE = "http://127.0.0.1:9411";

interface Msg {
  via: string;
  auth: string | null;
  type: string;
  event?: string;
  userId?: string;
  anonymousId?: string;
  groupId?: string;
  traits?: Record<string, unknown>;
  properties?: Record<string, unknown>;
  messageId?: string;
  context?: Record<string, unknown>;
}
const received = async (): Promise<Msg[]> => (await fetch(`${PLANE}/__received`)).json();

test("every event reaches RudderStack once, complete, and without anything personal", async ({
  page,
}) => {
  test.setTimeout(240_000);
  const { slug, email } = await createUser(page, { prefix: "rs", brand: "Orbit Lace" });
  await page.goto(`/w/${slug}/creators?niche=food`); // a browser event on a signed-in page
  await expect(page.getByTestId("creator-row").first()).toBeVisible();
  await page.goto(`/w/${slug}/mentions`);
  await page.waitForLoadState("networkidle");

  const user = (
    await pool.query(`SELECT id FROM users WHERE lower(email) = $1`, [email.toLowerCase()])
  ).rows[0].id as string;

  // The server batches for a few seconds; wait until what the mirror holds for this person has all arrived.
  const mirrored = async () =>
    (
      await pool.query(
        `SELECT name, count(*)::int AS n FROM analytics_events WHERE user_id = $1 GROUP BY name ORDER BY name`,
        [user],
      )
    ).rows as { name: string; n: number }[];
  const delivered = async () => {
    const counts = new Map<string, number>();
    for (const m of await received())
      if (m.type === "track" && m.userId === user)
        counts.set(m.event!, (counts.get(m.event!) ?? 0) + 1);
    return counts;
  };
  await expect
    .poll(
      async () => {
        const want = await mirrored();
        const got = await delivered();
        return want.every((w) => got.get(w.name) === w.n);
      },
      { timeout: 30_000, message: "every mirrored event should reach RudderStack" },
    )
    .toBe(true);

  const want = await mirrored();
  const got = await delivered();
  // Reconciled: the same events, the same counts, nothing extra and nothing twice.
  expect([...got.keys()].sort()).toEqual(want.map((w) => w.name).sort());
  expect(want.length).toBeGreaterThan(5);

  const all = (await received()).filter((m) => m.userId === user || m.anonymousId);
  const mine = all.filter((m) => m.userId === user);
  const ids = mine.map((m) => m.messageId).filter(Boolean);
  expect(new Set(ids).size).toBe(ids.length); // no message sent twice

  // Everything goes through the server, authenticated with the write key.
  expect(mine.every((m) => m.via === "server")).toBe(true);
  expect(
    mine.every((m) => m.auth === `Basic ${Buffer.from("e2e-write-key:").toString("base64")}`),
  ).toBe(true);

  // Browser events carry the global properties too (they used to arrive without the account, plan and role).
  const browserEvent = mine.find((m) => m.type === "track" && m.event === "Creator Search Run")!;
  expect(browserEvent).toBeTruthy();
  expect(browserEvent.properties).toMatchObject({
    product: "influencers",
    actor_type: "member",
    plan_tier: "trial",
    user_role: "owner",
    is_synthetic: true,
    app_version: expect.any(String),
    route: expect.stringContaining("/creators"),
    ui_theme: expect.stringMatching(/light|dark/),
  });
  expect(typeof browserEvent.properties!.account_id).toBe("string");
  expect(typeof browserEvent.properties!.workspace_id).toBe("string");
  expect(browserEvent.context).toMatchObject({ userAgent: expect.stringContaining("Chrome") });

  // The person, their account and their workspace were introduced, with ids and kinds only.
  const identify = mine.find((m) => m.type === "identify")!;
  expect(identify.traits).toMatchObject({ user_type: "member" });
  const accountId = identify.traits!.account_id as string;
  const groups = mine.filter((m) => m.type === "group");
  expect(groups.find((g) => g.groupId === accountId)?.traits).toEqual({ group_type: "account" });
  expect(groups.some((g) => g.traits?.group_type === "workspace")).toBe(true);

  // Nothing personal, anywhere in what was sent for this person: no email, name or company.
  const text = JSON.stringify(mine);
  expect(text).not.toContain(email);
  expect(text).not.toContain("E2E User");
  expect(text).not.toContain("E2E Co");
  expect(text).not.toMatch(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}/);
});
