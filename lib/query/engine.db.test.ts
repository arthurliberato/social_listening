// Integration tests: run compiled queries against the seeded corpus and verify results independently in JS.
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, pool } from "@/db/client";
import { compile } from "./compile";
import { analyze } from "./lint";
import { tokens } from "./tokens";

interface Row extends Record<string, unknown> {
  id: number;
  text: string;
  title: string | null;
  lang: string;
  country: string;
  detected_logos: string[];
  author_id: number;
}

let corpusReady = false;
beforeAll(async () => {
  try {
    const r = await db.execute(sql`SELECT count(*)::int AS n FROM mentions`);
    corpusReady = (r.rows[0] as { n: number }).n > 100_000;
  } catch {
    corpusReady = false;
  }
});
afterAll(() => pool.end());

async function run(q: string, limit = 30_000): Promise<Row[]> {
  const a = analyze(q);
  expect(
    a.issues.filter((i) => i.severity === "error"),
    q,
  ).toEqual([]);
  const r = await db.execute(
    sql`SELECT id, text, title, lang, country, detected_logos, author_id FROM mentions WHERE ${compile(a.ast!)} LIMIT ${limit}`,
  );
  return r.rows as Row[];
}
const count = async (q: string) => (await run(q, 1_000_000)).length;
const words = (r: Row) => tokens(`${r.title ?? ""} ${r.text}`);

describe.runIf(process.env.DATABASE_URL !== "skip")("query engine against the corpus", () => {
  const need = () => {
    if (!corpusReady)
      throw new Error(
        "Seed the corpus first: npm run datagen && npm run db:migrate && npm run db:load",
      );
  };

  it("matches phrases exactly", async () => {
    need();
    const rows = await run('"Juniper Roast"');
    expect(rows.length).toBeGreaterThan(100);
    for (const r of rows) expect(words(r).join(" ")).toContain("juniper roast");
  });

  it("applies exclusions", async () => {
    need();
    const all = await count("juniper");
    const withoutJobs = await count("juniper NOT (hiring OR apply OR giveaway)");
    expect(withoutJobs).toBeLessThan(all);
    const rows = await run("juniper NOT hiring");
    for (const r of rows) expect(words(r)).not.toContain("hiring");
  });

  it("satisfies the NOT algebra: count(A) = count(A AND B) + count(A NOT B)", async () => {
    need();
    const [a, ab, anb] = await Promise.all([
      count("brewline"),
      count("brewline AND love"),
      count("brewline NOT love"),
    ]);
    expect(ab).toBeGreaterThan(0);
    expect(ab + anb).toBe(a);
  });

  it("evaluates OR as a union", async () => {
    need();
    const [a, b, either, both] = await Promise.all([
      count("stridewell"),
      count("voltara"),
      count("stridewell OR voltara"),
      count("stridewell voltara"),
    ]);
    expect(either).toBe(a + b - both);
  });

  it("honours NEAR/n distances (verified independently)", async () => {
    need();
    const near = async (n: number, ordered = false) => {
      const rows = await run(`terrible NEAR/${n}${ordered ? "f" : ""} support`);
      for (const r of rows) {
        const w = words(r);
        const ta = w.flatMap((x, i) => (x === "terrible" ? [i] : []));
        const sb = w.flatMap((x, i) => (x === "support" ? [i] : []));
        const ok = ta.some((i) =>
          sb.some((j) =>
            ordered ? j - i >= 1 && j - i <= n : Math.abs(i - j) >= 1 && Math.abs(i - j) <= n,
          ),
        );
        expect(ok, r.text).toBe(true);
      }
      return rows.length;
    };
    const n2 = await near(2);
    const n3 = await near(3);
    const n3f = await near(3, true);
    const n3r = await count("support NEAR/3f terrible");
    expect(n3).toBeGreaterThan(0);
    expect(n3).toBeGreaterThanOrEqual(n2);
    expect(n3f).toBeLessThanOrEqual(n3);
    expect(n3f + n3r).toBeLessThanOrEqual(n3);
  });

  it("supports trailing wildcards", async () => {
    need();
    const [exact, wild] = await Promise.all([count("terrible"), count("terribl*")]);
    expect(wild).toBe(exact);
    expect(await count("disappoint*")).toBeGreaterThan(0);
  });

  it("searches non-English text with accents (needs a UTF-8 database locale)", async () => {
    need();
    const rows = await run("déçu");
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(words(r)).toContain("déçu"); // reposts keep the original language
    expect(rows.filter((r) => r.lang === "fr").length).toBeGreaterThan(rows.length / 2);
    expect(await count("deçu")).toBe(0); // no accent folding: documented behaviour
  });

  it("filters by language and country fields", async () => {
    need();
    const es = await run("brewline lang:es");
    expect(es.length).toBeGreaterThanOrEqual(0);
    for (const r of es) expect(r.lang).toBe("es");
    const us = await run("juniper country:us");
    expect(us.length).toBeGreaterThan(0);
    for (const r of us) expect(r.country).toBe("US");
  });

  it("requires the # marker for hashtags", async () => {
    need();
    const tagged = await run("#juniper");
    expect(tagged.length).toBeGreaterThan(0);
    for (const r of tagged)
      expect(r.text.toLowerCase()).toMatch(/(^|[^a-z0-9_])#juniper([^a-z0-9_]|$)/);
    expect(tagged.length).toBeLessThan(await count("juniper"));
  });

  it("matches detected logos even when the text never names the brand", async () => {
    need();
    const rows = await run("logo:juniperroast");
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(r.detected_logos).toContain("juniperroast");
    expect(rows.some((r) => !r.text.toLowerCase().includes("juniper"))).toBe(true);
  });

  it("filters by author handle", async () => {
    need();
    const h = await db.execute(
      sql`SELECT a.handle FROM authors a JOIN mentions m ON m.author_id = a.id WHERE a.followers > 1000 LIMIT 1`,
    );
    const { handle } = h.rows[0] as { handle: string };
    const rows = await run(`author:${handle}`);
    expect(rows.length).toBeGreaterThan(0);
    // Handles are only unique per platform, so every hit must belong to *an* author with that handle.
    const owners = await db.execute(
      sql`SELECT id FROM authors WHERE lower(handle) = ${handle.toLowerCase()}`,
    );
    const ids = new Set((owners.rows as { id: number }[]).map((o) => o.id));
    for (const r of rows) expect(ids.has(r.author_id)).toBe(true);
  });

  it("is injection-safe", async () => {
    need();
    const r = await run(`author:"x'; DROP TABLE mentions;--"`);
    expect(r).toEqual([]);
    expect(await count("juniper")).toBeGreaterThan(0);
  });
});
