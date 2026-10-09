import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import {
  accounts,
  campaignContent,
  campaignContentFiles,
  campaignCreators,
  campaignInvites,
  campaigns,
  db,
  pool,
  workspaces,
} from "@/db/client";
import { contentFileResponse } from "./content-download";
import { newToken } from "./outreach-flow";
import { portalFor, submitContent } from "./outreach";

afterAll(() => pool.end());

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

async function fixture() {
  const [a] = await db
    .insert(accounts)
    .values({ name: "upl", planTier: "growth", billingStatus: "active" })
    .returning();
  const [w] = await db
    .insert(workspaces)
    .values({
      accountId: a!.id,
      name: "Latte Lane",
      slug: `upl-${Math.random().toString(36).slice(2, 9)}`,
    })
    .returning();
  const [c] = await db
    .insert(campaigns)
    .values({ workspaceId: w!.id, name: "Spring launch", status: "active" })
    .returning();
  await db
    .insert(campaignCreators)
    .values({ campaignId: c!.id, creatorId: 1, status: "confirmed", feeUsd: 500 });
  const token = newToken();
  await db.insert(campaignInvites).values({
    campaignId: c!.id,
    creatorId: 1,
    token,
    offeredUsd: 500,
    status: "accepted",
    expiresAt: new Date(Date.now() + 86_400_000),
  });
  return { campaignId: c!.id, token };
}

const file = { name: "Reel.png", mime: "image/png", bytes: PNG };

describe("uploaded content", () => {
  it("is stored with a hash, listed without its bytes, and served as what it is", async () => {
    const f = await fixture();
    expect(await submitContent(f.token, "", "First cut", file)).toEqual({ ok: true, version: 1 });
    const [content] = await db
      .select()
      .from(campaignContent)
      .where(eq(campaignContent.campaignId, f.campaignId));
    expect(content).toMatchObject({ url: "", fileName: "Reel.png", fileSize: PNG.length });
    const [stored] = await db
      .select()
      .from(campaignContentFiles)
      .where(eq(campaignContentFiles.contentId, content!.id));
    expect(stored!.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(Buffer.from(stored!.data).equals(PNG)).toBe(true);
    // What the page is built from carries the file's details, not its bytes.
    const p = await portalFor(f.token);
    expect(p!.content[0]).toMatchObject({ fileName: "Reel.png", fileMime: "image/png" });
    expect(JSON.stringify(p!.content)).not.toContain(PNG.toString("base64"));

    const res = await contentFileResponse(f.campaignId, 1, 1);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-disposition")).toContain("inline");
    expect(Buffer.from(await res.arrayBuffer()).equals(PNG)).toBe(true);
  });

  it("is a plain 404 for another creator, another version, or a link-only submission", async () => {
    const f = await fixture();
    await submitContent(f.token, "", "", file);
    expect((await contentFileResponse(f.campaignId, 2, 1)).status).toBe(404);
    expect((await contentFileResponse(f.campaignId, 1, 2)).status).toBe(404);
    expect((await contentFileResponse(f.campaignId, 1, 0)).status).toBe(404);
    const g = await fixture();
    await submitContent(g.token, "https://social.example.test/p/1", "");
    expect((await contentFileResponse(g.campaignId, 1, 1)).status).toBe(404);
  });

  it("can be submitted once while it waits for review, and still needs a link when there is no file", async () => {
    const f = await fixture();
    expect(await submitContent(f.token, "", "")).toMatchObject({ ok: false });
    expect(await submitContent(f.token, "", "x".repeat(2001), file)).toMatchObject({ ok: false });
    expect(await submitContent(f.token, "", "", file)).toMatchObject({ ok: true });
    expect(await submitContent(f.token, "", "", file)).toMatchObject({ ok: false });
    expect(
      await db.select().from(campaignContent).where(eq(campaignContent.campaignId, f.campaignId)),
    ).toHaveLength(1);
  });

  it("goes when the campaign does", async () => {
    const f = await fixture();
    await submitContent(f.token, "", "", file);
    const [content] = await db
      .select()
      .from(campaignContent)
      .where(eq(campaignContent.campaignId, f.campaignId));
    await db.delete(campaigns).where(eq(campaigns.id, f.campaignId));
    expect(
      await db
        .select()
        .from(campaignContentFiles)
        .where(eq(campaignContentFiles.contentId, content!.id)),
    ).toHaveLength(0);
  });
});
