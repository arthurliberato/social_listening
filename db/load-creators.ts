// Usage: npx tsx db/load-creators.ts [--seed 42] [--count 50000]
// Seeds the synthetic creator directory (Influencers product). Idempotent: replaces the whole directory,
// so a seeded run is reproducible. Lists reference creators by id, which stays stable for a given seed.
import { generateCreators } from "../datagen/creators";
import { creators, db, pool } from "./client";

const arg = (k: string, d: string) => {
  const i = process.argv.indexOf(`--${k}`);
  return i >= 0 ? process.argv[i + 1]! : d;
};
const seed = Number(arg("seed", "42"));
const count = Number(arg("count", "50000"));

async function main() {
  const t0 = Date.now();
  const all = generateCreators(seed, count);
  await db.transaction(async (tx) => {
    await tx.delete(creators);
    for (let i = 0; i < all.length; i += 1000) {
      await tx.insert(creators).values(all.slice(i, i + 1000));
    }
  });
  console.error(`loaded ${all.length} creators in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
