// Usage: npx tsx agents/run-case.ts --manifest agents.json --agent acc001_u04 --case CS-001
//          [--provider scripted|claude] [--base http://localhost:3000] [--out agents/out] [--headed] [--clock ISO]
// Runs one agent through one case on a running platform, writes the ledger, the deliverable and the evaluation.
import { chromium } from "@playwright/test";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { pool } from "@/db/client";
import { runAnalystCase } from "./analyst";
import { ClaudeBrain, type CallRecord } from "./brain/claude";
import { ScriptedBrain } from "./brain/scripted";
import { loadCase, loadTruth } from "./cases";
import { evaluate } from "./evaluate";
import { Ledger } from "./ledger";
import { sampleProfile } from "./profile";
import type { AgentProfile, AgentRole, Brain, Seniority } from "./types";
import { Workspace } from "./workspace";

export interface ManifestAgent {
  agent_id: string;
  account_id: string;
  workspace_slug: string;
  email: string;
  password: string;
  role: AgentRole;
  seniority: Seniority;
  region: string;
  persona: string;
}

export async function runCase(o: {
  agent: ManifestAgent;
  caseId: string;
  runId: string;
  baseUrl: string;
  outDir: string;
  provider?: "scripted" | "claude";
  clock?: string;
  headed?: boolean;
  forceWeakQuery?: boolean;
}) {
  const assignment = loadCase(o.caseId);
  const calls: CallRecord[] = [];
  const brain: Brain =
    o.provider === "claude"
      ? new ClaudeBrain(undefined, (c) => calls.push(c))
      : new ScriptedBrain();
  const profile: AgentProfile = sampleProfile(o.agent, {
    provider: brain.name,
    model: brain.model,
  });
  const dir = join(o.outDir, o.runId, o.agent.agent_id);
  mkdirSync(dir, { recursive: true });
  const ledger = new Ledger(join(dir, "ledger.jsonl"), {
    profile,
    case_id: assignment.id,
    task_id: `${assignment.id}-${o.agent.agent_id}`,
    run_id: o.runId,
  });

  const browser = await chromium.launch({
    headless: !o.headed,
    ...(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {}),
  });
  try {
    const context = await browser.newContext({ viewport: { width: 1360, height: 860 } });
    // Labels the platform's events with who this is (and the agent's own clock, when the platform allows it).
    const sim = {
      persona: profile.persona,
      run: o.runId,
      model: brain.model,
      ...(o.clock ? { clock: o.clock } : {}),
    };
    await context.addCookies([
      {
        name: "rw_sim",
        value: Buffer.from(JSON.stringify(sim)).toString("base64"),
        url: o.baseUrl,
      },
    ]);
    const ws = await Workspace.open(context, o.baseUrl);
    await ws.login(o.agent.email, o.agent.password);
    ledger.record({ step: "login", tool: "navigate", intent: "start the working session" });
    const result = await runAnalystCase({
      profile,
      assignment,
      brain,
      ws,
      ledger,
      options: {
        runId: o.runId,
        forceWeakQuery: o.forceWeakQuery,
        deliverablePath: join(dir, "deliverable.md"),
      },
    });
    for (const c of calls)
      ledger.record({
        step: "llm_call",
        tool: "llm",
        intent: c.task,
        llm_call_id: c.llm_call_id,
        observed: { ...c },
      });
    const evaluation = await evaluate({
      assignment,
      truth: loadTruth(o.caseId),
      queryId: result.queryId,
      deliverable: result.deliverable,
      categories: result.deliverable.categories.length,
    });
    writeFileSync(join(dir, "evaluation.json"), JSON.stringify(evaluation, null, 2));
    writeFileSync(join(dir, "profile.json"), JSON.stringify(profile, null, 2));
    return { profile, result, evaluation, ledger: ledger.entries, dir };
  } finally {
    await browser.close();
  }
}

const arg = (k: string, d?: string) => {
  const i = process.argv.indexOf(`--${k}`);
  return i >= 0 ? process.argv[i + 1] : d;
};

async function main() {
  const manifest = JSON.parse(readFileSync(arg("manifest", "agents.json")!, "utf8")) as {
    run: string;
    agents: ManifestAgent[];
  };
  const id = arg("agent");
  const agent =
    manifest.agents.find((a) => a.agent_id === id) ??
    manifest.agents.find((a) => a.role === "analyst");
  if (!agent) throw new Error("no such agent in the manifest");
  const out = await runCase({
    agent,
    caseId: arg("case", "CS-001")!,
    runId: arg("run", manifest.run)!,
    baseUrl: arg("base", "http://localhost:3000")!,
    outDir: arg("out", "agents/out")!,
    provider: arg("provider", "scripted") as "scripted" | "claude",
    clock: arg("clock"),
    headed: process.argv.includes("--headed"),
  });
  console.log(JSON.stringify(out.evaluation, null, 2));
  console.log(`\nledger, deliverable and evaluation in ${out.dir}`);
}

if (process.argv[1]?.endsWith("run-case.ts")) {
  main()
    .catch((e) => {
      console.error(e);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}
