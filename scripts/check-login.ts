// Usage: npx tsx scripts/check-login.ts <email> [agents-demo.json]
// Checks whether the password the seeder wrote to the manifest matches the hash stored in the database for that
// email. Prints true or false (never the password). Uses DATABASE_URL.
import { readFileSync } from "node:fs";
import { verify } from "@node-rs/argon2";
import pg from "pg";

const email = process.argv[2]?.toLowerCase();
const file = process.argv[3] ?? "agents-demo.json";
if (!email) {
  console.error("Usage: npx tsx scripts/check-login.ts <email> [manifest.json]");
  process.exit(1);
}

async function main() {
  const manifest = JSON.parse(readFileSync(file, "utf8")) as {
    agents: { email: string; password: string }[];
  };
  const entry = manifest.agents.find((a) => a.email.toLowerCase() === email);
  if (!entry) throw new Error(`${email} is not in ${file}`);
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const { rows } = await client.query<{ password_hash: string }>(
    "SELECT password_hash FROM users WHERE lower(email) = $1",
    [email],
  );
  await client.end();
  if (!rows[0]) throw new Error(`${email} is not in the database`);
  const ok = await verify(rows[0].password_hash, entry.password).catch(() => false);
  console.log(`password in ${file} matches the stored hash: ${ok}`);
  console.log(
    `password length in the file: ${entry.password.length}; hash starts with ${rows[0].password_hash.slice(0, 12)}`,
  );
}
main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
