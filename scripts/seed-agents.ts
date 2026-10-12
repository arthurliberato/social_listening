// Usage: npx tsx scripts/seed-agents.ts --accounts 3 --run run-001 [--seed 1] [--plan agency|growth|starter]
//                                       [--model name] [--onboard-owner] [--first-query] [--out agents.json]
//                                       [--team-size 2 | --team-size 2-4]   (users per account; default is the full 8-9)
//                                       [--mix starter-limit:50,growth:25,agency-low:15]   (tiered population; replaces
//                                        --accounts, --plan, --team-size and --first-query)
// Creates agent accounts (an owner plus a team of 8-9 people) through the product's own sign-up, invite and
// subscription code, and writes a manifest of logins for the agent harness. Test mode only; fictitious data.
import { writeFileSync } from "node:fs";
import { pool } from "@/db/client";
import { isTierProfile, seedAgents, TIER_PROFILES, type TierProfile } from "@/lib/sim/seed-agents";

const arg = (k: string, d?: string) => {
  const i = process.argv.indexOf(`--${k}`);
  return i >= 0 ? process.argv[i + 1] : d;
};
const run = arg("run");
if (!run) {
  console.error("--run <id> is required (it labels every event and makes emails unique)");
  process.exit(1);
}
function mix(v?: string): { profile: TierProfile; accounts: number }[] | undefined {
  if (!v) return undefined;
  const clash = ["accounts", "plan", "team-size"].filter((k) => arg(k) !== undefined);
  if (process.argv.includes("--first-query")) clash.push("first-query");
  if (clash.length) throw new Error(`--mix replaces --${clash.join(", --")}; use one or the other`);
  return v.split(",").map((part) => {
    const [profile, n] = part.split(":");
    if (!profile || !isTierProfile(profile) || !/^\d+$/.test(n ?? "") || Number(n) < 1)
      throw new Error(
        `--mix entries look like profile:count, with profile one of ${Object.keys(TIER_PROFILES).join(", ")}; got "${part}"`,
      );
    return { profile, accounts: Number(n) };
  });
}
function teamSize(v?: string): number | [number, number] | undefined {
  if (!v) return undefined;
  const m = /^(\d+)(?:-(\d+))?$/.exec(v);
  if (!m || Number(m[1]) < 1 || (m[2] && Number(m[2]) < Number(m[1])))
    throw new Error(`--team-size must be N or MIN-MAX, got "${v}"`);
  return m[2] ? [Number(m[1]), Number(m[2])] : Number(m[1]);
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
    firstQuery: process.argv.includes("--first-query"),
    teamSize: teamSize(arg("team-size")),
    mix: mix(arg("mix")),
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
