import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as corpus from "./schema";
import * as app from "./app-schema";

const url =
  process.env.DATABASE_URL ?? "postgres://ripplewise:ripplewise@localhost:5432/ripplewise";

// Reuse the pool across hot reloads in dev.
const g = globalThis as unknown as { __pgPool?: Pool };
export const pool = g.__pgPool ?? (g.__pgPool = new Pool({ connectionString: url, max: 10 }));
export const db = drizzle(pool, { schema: { ...corpus, ...app } });
export * from "./schema";
export * from "./app-schema";
