// Usage: npx tsx db/load.ts [--dir data/corpus] [--url postgres://...]
// Bulk-loads the generated corpus with COPY, then builds indexes (indexes are dropped before the load: far faster
// than maintaining them row by row). Run `npm run db:migrate` first. Pure Node (pg and pg-copy-streams, Node's gzip),
// so it needs no psql or zcat and runs on Windows too.
import { createReadStream, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PassThrough, type Readable, type Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";
import pg from "pg";
import { from as copyFrom } from "pg-copy-streams";

const arg = (k: string, d: string) => {
  const i = process.argv.indexOf(`--${k}`);
  return i >= 0 ? process.argv[i + 1]! : d;
};
const dir = arg("dir", "data/corpus");
const url = arg(
  "url",
  process.env.DATABASE_URL ?? "postgres://ripplewise:ripplewise@localhost:5432/ripplewise",
);
const client = new pg.Client({ connectionString: url });

const run = (sql: string) => client.query(sql);

async function copyFromSource(table: string, columns: readonly string[], source: Readable) {
  const ingest = client.query(copyFrom(`COPY ${table} (${columns.join(",")}) FROM STDIN`));
  await pipeline(source, ingest);
}

/** The small reference tables are written from memory. */
async function copy(
  table: string,
  columns: readonly string[],
  feed: (stdin: Writable) => void | Promise<void>,
) {
  const rows = new PassThrough();
  const done = copyFromSource(table, columns, rows);
  await feed(rows);
  rows.end();
  await done;
}

/** The big tables stream from gzipped files, never held in memory. */
async function copyGz(table: string, columns: readonly string[], file: string) {
  const ingest = client.query(copyFrom(`COPY ${table} (${columns.join(",")}) FROM STDIN`));
  await pipeline(createReadStream(file), createGunzip(), ingest);
}

// Dropped before the bulk load and rebuilt after: far faster than per-row index maintenance.
const INDEXES = [
  "CREATE INDEX mentions_published_idx ON mentions (published_at)",
  "CREATE INDEX mentions_brand_published_idx ON mentions (brand_id, published_at)",
  "CREATE INDEX mentions_tsv_idx ON mentions USING gin (tsv)",
  "CREATE INDEX mentions_story_idx ON mentions (story_id)",
];
const indexName = (sql: string) => /INDEX (\w+)/.exec(sql)![1]!;

const q = (v: string | number | null) =>
  v === null ? "\\N" : String(v).replace(/\\/g, "\\\\").replace(/\t/g, " ").replace(/\n/g, " ");
const pgArr = (a: (string | number)[]) =>
  `{${a.map((x) => `"${String(x).replace(/"/g, '\\\\"')}"`).join(",")}}`;

async function main() {
  const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
  const brands = JSON.parse(readFileSync(join(dir, "brands.json"), "utf8"));
  const sources = JSON.parse(readFileSync(join(dir, "sources.json"), "utf8"));
  const stories = JSON.parse(readFileSync(join(dir, "stories.json"), "utf8"));

  // Corpus tables only: tenant/app tables are left untouched. Run `npm run db:migrate` first.
  await client.connect();
  await run("TRUNCATE mentions, authors, stories, brands, sources RESTART IDENTITY CASCADE");
  for (const i of INDEXES) await run(`DROP INDEX IF EXISTS ${indexName(i)}`);

  await copy("sources", ["id", "type", "display_name", "reach_multiplier"], (w) => {
    for (const s of sources)
      w.write([s.id, s.type, q(s.displayName), s.reachMultiplier].join("\t") + "\n");
  });
  await copy(
    "brands",
    [
      "id",
      "slug",
      "name",
      "short_name",
      "vertical",
      "homonym_sense",
      "markets",
      "aliases",
      "competitor_ids",
    ],
    (w) => {
      for (const b of brands) {
        const peers = brands
          .filter(
            (x: { vertical: string; id: number }) => x.vertical === b.vertical && x.id !== b.id,
          )
          .map((x: { id: number }) => x.id);
        w.write(
          [
            b.id,
            b.slug,
            q(b.name),
            q(b.short),
            b.vertical,
            q(b.homonym?.sense ?? null),
            pgArr(b.markets),
            pgArr([b.name, b.short, b.slug]),
            pgArr(peers),
          ].join("\t") + "\n",
        );
      }
    },
  );
  await copy(
    "stories",
    [
      "id",
      "type",
      "brand_id",
      "start_at",
      "peak_at",
      "end_at",
      "decay_half_life_hours",
      "peak_multiple",
      "keywords",
      "meta",
    ],
    (w) => {
      for (const s of stories) {
        const iso = (ms: number) => new Date(ms).toISOString();
        const meta = JSON.stringify({
          seeds: s.seeds.length,
          crowdless: s.crowdless,
          sentTarget: s.sentTarget,
          sentHlHours: s.sentHlHours,
        });
        w.write(
          [
            s.id,
            s.type,
            s.brandIdx + 1,
            iso(s.startMs),
            iso(s.peakMs),
            iso(s.endMs),
            s.volHlHours,
            s.peakMult,
            pgArr(s.keywords),
            q(meta),
          ].join("\t") + "\n",
        );
      }
    },
  );
  await copyGz("authors", manifest.authorColumns.map(String), join(dir, "authors.tsv.gz"));
  for (const f of readdirSync(join(dir, "mentions")).sort()) {
    await copyGz("mentions", manifest.mentionColumns, join(dir, "mentions", f));
    console.error(`loaded ${f}`);
  }
  for (const i of INDEXES) await run(i);
  await run("ANALYZE");
  await client.end();
  console.error("done");
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
