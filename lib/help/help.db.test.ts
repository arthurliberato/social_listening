import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  accounts,
  db,
  emails,
  memberships,
  pool,
  supportRequests,
  users,
  workspaces,
} from "@/db/client";
import { HELP_TOPICS } from "./topics";
import { MAX_PER_DAY, referenceOf, submitSupport } from "./service";

afterAll(() => pool.end());

describe("help center", () => {
  let who: { userId: string; email: string; accountId: string; workspaceId: string };
  beforeAll(async () => {
    const [a] = await db.insert(accounts).values({ name: "help" }).returning();
    const [w] = await db
      .insert(workspaces)
      .values({
        accountId: a!.id,
        name: "h",
        slug: `help-${Math.random().toString(36).slice(2, 8)}`,
      })
      .returning();
    const email = `help-${Math.random().toString(36).slice(2)}@example.test`;
    const [u] = await db
      .insert(users)
      .values({ email, passwordHash: "x", name: "Help" })
      .returning();
    await db
      .insert(memberships)
      .values({ userId: u!.id, workspaceId: w!.id, accountId: a!.id, role: "viewer" });
    who = { userId: u!.id, email, accountId: a!.id, workspaceId: w!.id };
  });

  it("topics are complete and uniquely identified", () => {
    const ids = HELP_TOPICS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const t of HELP_TOPICS) {
      expect(t.title.length).toBeGreaterThan(3);
      expect(t.steps.length).toBeGreaterThan(0);
    }
  });

  it("validates, stores, and sends a reference by email", async () => {
    const bad = await submitSupport({ category: "bug", subject: "x", message: "short" }, who);
    expect(bad).toMatchObject({ ok: false, field: "subject" });
    const bad2 = await submitSupport(
      { category: "nope", subject: "A real title", message: "A real message here" },
      who,
    );
    expect(bad2.ok).toBe(false);

    const r = await submitSupport(
      {
        category: "query",
        subject: "Query misses replies",
        message: "My query does not find replies to our launch post.",
      },
      who,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.reference).toBe(referenceOf(r.id));
    const [row] = await db.select().from(supportRequests).where(eq(supportRequests.id, r.id));
    expect(row).toMatchObject({
      category: "query",
      userId: who.userId,
      workspaceId: who.workspaceId,
      status: "open",
    });
    const mail = await db.select().from(emails).where(eq(emails.toUserId, who.userId));
    expect(mail.map((m) => m.type)).toContain("support");
    expect(mail.find((m) => m.type === "support")!.subject).toContain(r.reference);
  });

  it("limits how many questions one person can send in a day", async () => {
    let last;
    for (let i = 0; i < MAX_PER_DAY + 1; i++)
      last = await submitSupport(
        {
          category: "other",
          subject: `Question ${i} title`,
          message: "A long enough message to pass.",
        },
        who,
      );
    expect(last).toMatchObject({ ok: false });
  });
});
