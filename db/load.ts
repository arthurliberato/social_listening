// Usage: npx tsx db/load.ts [--dir data/corpus] [--url postgres://...]
// Applies migrations, bulk-loads the generated corpus with COPY, then builds indexes
// (indexes are dropped before the load: far faster than maintaining them row by row).
import { spawn, spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const arg = (k: string, d: string) => {
  const i = process.argv.indexOf(`--${k}`);
  return i >= 0 ? process.argv[i + 1]! : d;
};
const dir = arg("dir", "data/corpus");
const url = arg(
  "url",
  process.env.DATABASE_URL ?? "postgres://ripplewise:ripplewise@localhost:5432/ripplewise",
);

const psql = (sql: string) => {
  const r = spawnSync("psql", [url, "-v", "ON_ERROR_STOP=1", "-q", "-c", sql], {
    encoding: "utf8",
  });
  if (r.status !== 0) throw new Error(r.stderr);
};

function copy(
  table: string,
  columns: readonly string[],
  feed: (stdin: NodeJS.WritableStream) => void | Promise<void>,
) {
  return new Promise<void>((resolve, reject) => {
    const p = spawn(
      "psql",
      [
        url,
        "-v",
        "ON_ERROR_STOP=1",
        "-q",
        "-c",
        `\\copy ${table} (${columns.join(",")}) FROM STDIN`,
      ],
      { stdio: ["pipe", "inherit", "inherit"] },
    );
    p.on("exit", (c) => (c === 0 ? resolve() : reject(new Error(`copy ${table} exited ${c}`))));
    Promise.resolve(feed(p.stdin!)).then(() => p.stdin!.end(), reject);
  });
}

async function copyGz(table: string, columns: readonly string[], file: string) {
  await copy(
    table,
    columns,
    (stdin) =>
      new Promise<void>((resolve, reject) => {
        const z = spawn("zcat", [file]);
        z.stdout.pipe(stdin, { end: false });
        z.on("exit", (c) => (c === 0 ? resolve() : reject(new Error(`zcat ${file}`))));
      }),
  );
}

const q = (v: string | number | null) =>
  v === null ? "\\N" : String(v).replace(/\\/g, "\\\\").replace(/\t/g, " ").replace(/\n/g, " ");
const pgArr = (a: (string | number)[]) =>
  `{${a.map((x) => `"${String(x).replace(/"/g, '\\\\"')}"`).join(",")}}`;

async function main() {
  const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
  const brands = JSON.parse(readFileSync(join(dir, "brands.json"), "utf8"));
  const sources = JSON.parse(readFileSync(join(dir, "sources.json"), "utf8"));
  const stories = JSON.parse(readFileSync(join(dir, "stories.json"), "utf8"));

  // Fresh load: apply the generated migration to an empty schema.
  psql("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  for (const f of readdirSync("db/migrations")
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    const sql = readFileSync(join("db/migrations", f), "utf8").replaceAll(
      "--> statement-breakpoint",
      "",
    );
    const r = spawnSync("psql", [url, "-v", "ON_ERROR_STOP=1", "-q"], {
      input: sql,
      encoding: "utf8",
    });
    if (r.status !== 0) throw new Error(`${f}: ${r.stderr}`);
  }
  const indexes = spawnSync(
    "psql",
    [
      url,
      "-At",
      "-c",
      "select indexname || '|' || indexdef from pg_indexes where tablename='mentions' and indexname like 'mentions\\_%' escape '\\' and indexname <> 'mentions_pkey'",
    ],
    { encoding: "utf8" },
  )
    .stdout.trim()
    .split("\n")
    .filter(Boolean);
  for (const i of indexes) psql(`DROP INDEX ${i.split("|")[0]}`);

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
  for (const i of indexes) psql(i.split("|")[1]!);
  psql("ANALYZE");
  console.error("done");
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
