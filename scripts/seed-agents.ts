// Usage: npx tsx scripts/seed-agents.ts --accounts 3 --run run-001 [--seed 1] [--plan agency|growth|starter]
//                                       [--model name] [--onboard-owner] [--out agents.json]
// Creates agent accounts (an owner plus a team of 8-9 people) through the product's own sign-up, invite and
// subscription code, and writes a manifest of logins for the agent harness. Test mode only; fictitious data.
import { writeFileSync } from "node:fs";
import { pool } from "@/db/client";
import { seedAgents } from "@/lib/sim/seed-agents";

const arg = (k: string, d?: string) => {
  const i = process.argv.indexOf(`--${k}`);
  return i >= 0 ? process.argv[i + 1] : d;
};
const run = arg("run");
if (!run) {
  console.error("--run <id> is required (it labels every event and makes emails unique)");
  process.exit(1);
}
async function main() {
  const plan = (arg("plan", "agency") ?? "agency") as "starter" | "growth" | "agency";
  const agents = await seedAgents({
    accounts: Number(arg("accounts", "1")),
    seed: Number(arg("seed", "1")),
    run: run as string,
    model: arg("model"),
    plan,
    onboardOwner: process.argv.includes("--onboard-owner"),
  });
  const out = arg("out", `agents-${run}.json`)!;
  writeFileSync(out, JSON.stringify({ run, agents }, null, 2));
  console.log(
    `${agents.length} agents in ${new Set(agents.map((a) => a.account_id)).size} accounts -> ${out}`,
  );
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
