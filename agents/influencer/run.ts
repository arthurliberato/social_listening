// Runs one agent through one influencer case on a running platform: ledger, campaign plan, evaluation.
// (The browser setup mirrors run-case.ts, so the platform sees the same labelled synthetic user.)
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Ledger } from "../ledger";
import { loadInfluencerCase, loadInfluencerTruth } from "../cases";
import { sampleProfile } from "../profile";
import type { ManifestAgent } from "../run-case";
import { Workspace } from "../workspace";
import { ScriptedPartnershipsBrain } from "./brain";
import { evaluateInfluencerRun } from "./evaluate";
import { runPartnershipsCase } from "./partnerships";
import type { PartnershipsBrain } from "./types";

export async function runInfluencerCase(o: {
  agent: ManifestAgent;
  caseId: string;
  runId: string;
  baseUrl: string;
  outDir: string;
  clock?: string;
  headed?: boolean;
  brain?: PartnershipsBrain;
}) {
  const assignment = loadInfluencerCase(o.caseId);
  const brain = o.brain ?? new ScriptedPartnershipsBrain();
  const profile = sampleProfile(o.agent, { provider: brain.name, model: brain.model });
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
    // A person gives up on a screen that doesn't respond; an agent that waits forever is a hung run, not data.
    context.setDefaultTimeout(30_000);
    await context.addCookies([
      {
        name: "rw_sim",
        value: Buffer.from(
          JSON.stringify({
            persona: profile.persona,
            run: o.runId,
            model: brain.model,
            ...(o.clock ? { clock: o.clock } : {}),
          }),
        ).toString("base64"),
        url: o.baseUrl,
      },
    ]);
    const ws = await Workspace.open(context, o.baseUrl);
    await ws.login(o.agent.email, o.agent.password);
    ledger.record({ step: "login", tool: "navigate", intent: "start the working session" });
    const plan = await runPartnershipsCase({
      profile,
      assignment,
      brain,
      ws,
      ledger,
      brand: assignment.client,
      deliverablePath: join(dir, "campaign-plan.md"),
    });
    const evaluation = await evaluateInfluencerRun(loadInfluencerTruth(o.caseId), plan.campaignId);
    writeFileSync(join(dir, "evaluation.json"), JSON.stringify(evaluation, null, 2));
    writeFileSync(join(dir, "profile.json"), JSON.stringify(profile, null, 2));
    return { profile, plan, evaluation, ledger: ledger.entries, dir };
  } finally {
    await browser.close();
  }
}
