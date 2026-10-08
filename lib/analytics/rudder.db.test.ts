import { createServer, type IncomingMessage, type Server } from "node:http";
import { gunzipSync } from "node:zlib";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { accounts, db, memberships, pool, users, workspaces } from "@/db/client";
import { groupIdentifyAccount, trackServer } from "./server";
import { flushRudder } from "./rudder";

// A stand-in for RudderStack's data plane: it records what the app sends, so the payloads BigQuery will eventually
// receive can be checked without an account or network.
interface Msg {
  type: string;
  event?: string;
  userId?: string;
  anonymousId?: string;
  groupId?: string;
  properties?: Record<string, unknown>;
  traits?: Record<string, unknown>;
  timestamp?: string;
  messageId?: string;
}
let server: Server;
let received: { auth: string | undefined; path: string; msgs: Msg[] }[] = [];

const body = (req: IncomingMessage) =>
  new Promise<Buffer>((resolve) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
  });

beforeAll(async () => {
  server = createServer(async (req, res) => {
    let raw = await body(req);
    if (req.headers["content-encoding"] === "gzip") raw = gunzipSync(raw);
    const json = JSON.parse(raw.toString("utf8")) as { batch?: Msg[] };
    received.push({ auth: req.headers.authorization, path: req.url ?? "", msgs: json.batch ?? [] });
    res.statusCode = 200;
    res.end("OK");
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as { port: number };
  process.env.RUDDERSTACK_WRITE_KEY = "test-write-key";
  process.env.RUDDERSTACK_DATA_PLANE_URL = `http://127.0.0.1:${port}`;
});
beforeEach(() => {
  received = [];
});
afterAll(async () => {
  await new Promise((r) => server.close(r));
  delete process.env.RUDDERSTACK_WRITE_KEY;
  delete process.env.RUDDERSTACK_DATA_PLANE_URL;
  await pool.end();
});

const sent = () => received.flatMap((r) => r.msgs);

describe("what the server sends to RudderStack", () => {
  it("authenticates with the write key and sends a creator's event under their own id", async () => {
    await trackServer(
      "Creator Portal Viewed",
      { creatorId: 77 },
      { campaign_id: "c1", creator_id: 77, invite_state: "open" },
    );
    await flushRudder();
    expect(received.length).toBeGreaterThan(0);
    expect(received[0]!.path).toBe("/v1/batch");
    expect(received[0]!.auth).toBe(`Basic ${Buffer.from("test-write-key:").toString("base64")}`);
    const m = sent().find((x) => x.type === "track")!;
    expect(m).toMatchObject({
      type: "track",
      event: "Creator Portal Viewed",
      userId: "creator_77",
    });
    expect(m.properties).toMatchObject({
      campaign_id: "c1",
      product: "creator_portal",
      actor_type: "creator",
      is_synthetic: true,
    });
    expect(m.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(m.messageId).toBeTruthy();
  });

  it("sends an event with no person under the server's own anonymous id", async () => {
    await trackServer(
      "Creator Invitation Reminded",
      { system: true },
      {
        campaign_id: "c1",
        creator_id: 5,
        days_left: 2,
      },
    );
    await flushRudder();
    const m = sent().find((x) => x.type === "track")!;
    expect(m.userId).toBeUndefined();
    expect(m.anonymousId).toBe("server");
    expect(m.properties).toMatchObject({ actor_type: "system", product: "influencers" });
  });

  it("does not resend an event the browser already sent", async () => {
    await trackServer(
      "Help Opened",
      {},
      {},
      { forwarded: true, device_id: "dev-1", side: "client" },
    );
    await flushRudder();
    expect(sent()).toHaveLength(0);
  });

  it("uses the browser's device id for anonymous events from the browser", async () => {
    await trackServer("Pricing Page Viewed", {}, {}, { device_id: "dev-9", side: "client" });
    await flushRudder();
    expect(sent().find((x) => x.type === "track")).toMatchObject({ anonymousId: "dev-9" });
  });

  it("sends only what the plan allows: no emails, no names, in any property", async () => {
    await trackServer(
      "Creator Portal Viewed",
      { creatorId: 1 },
      {
        campaign_id: "c",
        creator_id: 1,
        invite_state: "open",
      },
    );
    await flushRudder();
    const text = JSON.stringify(sent());
    expect(text).not.toMatch(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}/);
    for (const m of sent())
      for (const k of Object.keys({ ...m.properties, ...m.traits }))
        expect(k, k).not.toMatch(/email|first_?name|last_?name|^name$|phone/i);
  });

  it("sends what is known about an account as a group call, with scores and counts only", async () => {
    await groupIdentifyAccount("acc-1", {
      health_band: "healthy",
      pqa_score: 72,
      uses_both_products: true,
    });
    const g = sent().find((m) => m.type === "group")!;
    expect(g).toMatchObject({ groupId: "acc-1", anonymousId: "server" });
    expect(g.traits).toEqual({
      group_type: "account",
      health_band: "healthy",
      pqa_score: 72,
      uses_both_products: true,
    });
  });

  it("introduces a creator as a creator, once", async () => {
    const ctx = { creatorId: 4242 };
    const props = { campaign_id: "c", creator_id: 4242, invite_state: "open" };
    await trackServer("Creator Portal Viewed", ctx, props);
    await trackServer("Creator Portal Viewed", ctx, props);
    await flushRudder();
    const ids = sent().filter((m) => m.type === "identify");
    expect(ids).toHaveLength(1);
    expect(ids[0]).toMatchObject({ userId: "creator_4242", traits: { user_type: "creator" } });
    expect(sent().filter((m) => m.type === "track")).toHaveLength(2);
  });

  it("introduces a member with their account and workspace once, and a new workspace again", async () => {
    const [a] = await db.insert(accounts).values({ name: "intro", planTier: "growth" }).returning();
    const mk = async (slug: string) =>
      (
        await db
          .insert(workspaces)
          .values({
            accountId: a!.id,
            name: slug,
            slug: `${slug}-${Math.random().toString(36).slice(2, 8)}`,
          })
          .returning()
      )[0]!;
    const w1 = await mk("one");
    const w2 = await mk("two");
    const [u] = await db
      .insert(users)
      .values({
        email: `intro-${Date.now()}@example.test`,
        passwordHash: "x",
        name: "Private Name",
      })
      .returning();
    for (const w of [w1, w2])
      await db
        .insert(memberships)
        .values({ userId: u!.id, accountId: a!.id, workspaceId: w.id, role: "editor" });

    const p = { entry_point: "test" } as never;
    await trackServer("Pricing Page Viewed", { userId: u!.id, workspaceId: w1.id }, p);
    await trackServer("Pricing Page Viewed", { userId: u!.id, workspaceId: w1.id }, p);
    await flushRudder();
    const first = sent();
    expect(first.filter((m) => m.type === "identify")).toHaveLength(1);
    expect(first.find((m) => m.type === "identify")).toMatchObject({
      userId: u!.id,
      traits: { user_type: "member", account_id: a!.id },
    });
    const groups = first.filter((m) => m.type === "group");
    expect(groups.map((g) => g.groupId).sort()).toEqual([a!.id, w1.id].sort());
    expect(groups.find((g) => g.groupId === w1.id)!.traits).toEqual({
      group_type: "workspace",
      account_id: a!.id,
    });
    expect(first.filter((m) => m.type === "track")).toHaveLength(2);

    // Switching workspace is a new introduction.
    received = [];
    await trackServer("Pricing Page Viewed", { userId: u!.id, workspaceId: w2.id }, p);
    await flushRudder();
    expect(
      sent()
        .filter((m) => m.type === "group")
        .map((g) => g.groupId),
    ).toContain(w2.id);
    // The person's name never leaves.
    expect(JSON.stringify([...first, ...sent()])).not.toContain("Private Name");
  });

  it("sends nothing at all without settings, and an event is still recorded", async () => {
    const key = process.env.RUDDERSTACK_WRITE_KEY;
    delete process.env.RUDDERSTACK_WRITE_KEY;
    await trackServer("Pricing Page Viewed", {}, {}, { device_id: "dev-0", side: "client" });
    await flushRudder();
    expect(sent()).toHaveLength(0);
    process.env.RUDDERSTACK_WRITE_KEY = key;
  });
});
