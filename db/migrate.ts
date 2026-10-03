// Usage: npx tsx db/migrate.ts  — applies drizzle migrations from db/migrations.
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db, pool } from "./client";

migrate(db, { migrationsFolder: "db/migrations" })
  .then(() => console.error("migrated"))
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
