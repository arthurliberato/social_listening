// Usage: npx tsx datagen/seed.ts [--out data/corpus] [--seed 42] [--authors 200000]
//                                [--scale 1] [--brands 40] [--end 2027-04-01]
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { AuthorPool } from "./authors";
import { HISTORY_START, SIM_NOW, SOURCES, VERTICALS, WORLD_END } from "./config";
import {
  WORLD_BRANDS,
  generateBrand,
  planAll,
  slugify,
  type GenOptions,
  type MentionRow,
} from "./generate";
import { AUTHOR_COLUMNS, GzTsv, MENTION_COLUMNS, authorLine, mentionLine } from "./io";
import { Stats } from "./stats";

export interface SeedArgs {
  out: string;
  seed: number;
  authors: number;
  scale: number;
  brands: number;
  endMs: number;
}

export function parseArgs(argv: string[]): SeedArgs {
  const get = (k: string, d: string) => {
    const i = argv.indexOf(`--${k}`);
    return i >= 0 ? argv[i + 1]! : d;
  };
  return {
    out: get("out", "data/corpus"),
    seed: Number(get("seed", "42")),
    authors: Number(get("authors", "200000")),
    scale: Number(get("scale", "1.4")),
    brands: Number(get("brands", String(WORLD_BRANDS.length))),
    endMs: Date.parse(get("end", new Date(WORLD_END).toISOString().slice(0, 10))),
  };
}

export async function seed(args: SeedArgs, write = true) {
  const t0 = Date.now();
  const pool = new AuthorPool(args.seed, args.authors);
  const opts: GenOptions = {
    seed: args.seed,
    pool,
    startMs: HISTORY_START,
    endMs: args.endMs,
    volumeScale: args.scale,
  };
  const brands = WORLD_BRANDS.slice(0, args.brands);
  const plans = planAll(opts, WORLD_BRANDS); // plan all so peer crises are known even for a subset
  const stats = new Stats(new Map(WORLD_BRANDS.map((b) => [b.id, b])), { startMs: HISTORY_START });

  if (write) {
    mkdirSync(join(args.out, "mentions"), { recursive: true });
    const a = new GzTsv(join(args.out, "authors.tsv.gz"));
    for (const au of pool.authors) await a.line(authorLine(au));
    await a.close();
  }
  for (const brand of brands) {
    const rows: MentionRow[] = [];
    generateBrand(opts, brand, plans, (m) => rows.push(m));
    for (const m of rows) stats.add(m);
    if (write) {
      const w = new GzTsv(
        join(args.out, "mentions", `brand-${String(brand.id).padStart(2, "0")}.tsv.gz`),
      );
      for (const m of rows) await w.line(mentionLine(m));
      await w.close();
    }
    console.error(`brand ${brand.id}/${brands.length} ${brand.name}: ${rows.length}`);
  }
  const stories = brands.flatMap((b) => plans.get(b.id)!);
  const report = stats.report(stories);

  if (write) {
    writeFileSync(
      join(args.out, "brands.json"),
      JSON.stringify(
        WORLD_BRANDS.map((b) => ({ ...b, slug: slugify(b.name) })),
        null,
        1,
      ),
    );
    writeFileSync(join(args.out, "sources.json"), JSON.stringify(SOURCES, null, 1));
    writeFileSync(join(args.out, "stories.json"), JSON.stringify(stories));
    writeFileSync(
      join(args.out, "manifest.json"),
      JSON.stringify(
        {
          args,
          simNow: new Date(SIM_NOW).toISOString(),
          historyStart: new Date(HISTORY_START).toISOString(),
          mentionColumns: MENTION_COLUMNS,
          authorColumns: AUTHOR_COLUMNS,
          verticals: Object.keys(VERTICALS),
          generatedMs: Date.now() - t0,
          report,
        },
        null,
        1,
      ),
    );
  }
  return { report, stories, stats };
}

if (process.argv[1]?.endsWith("seed.ts")) {
  seed(parseArgs(process.argv.slice(2))).then(({ report }) =>
    console.log(JSON.stringify(report, null, 1)),
  );
}
