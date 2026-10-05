import { expect, test } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { runCase } from "../../agents/run-case";
import { seedAgents } from "../../lib/sim/seed-agents";
import { pool } from "./helpers";

// Milestone 1 of the agent programme: one analyst agent takes one case end to end through the real UI, leaves a
// ledger, labelled analytics events and a deliverable, and is scored against the corpus's own truth.
test("an analyst agent completes CS-001 through the platform, and is scored", async ({}, testInfo) => {
  test.setTimeout(300_000);
  const run = `m1-${Date.now().toString(36)}`;
  const agents = await seedAgents({ accounts: 1, seed: 5, run, onboardOwner: true });
  const analyst = agents.find((a) => a.role === "analyst" && a.seniority === "junior")!;
  const out = await runCase({
    agent: analyst,
    caseId: "CS-001",
    runId: run,
    baseUrl: "http://localhost:3000",
    outDir: join(testInfo.outputDir, "agents"),
    forceWeakQuery: true, // the junior searches the bare word and has to deal with homonyms
  });

  // The work is in the platform, made by the agent.
  const q = (
    await pool.query(
      `SELECT q.status, q.backfill_status, u.email FROM queries q JOIN users u ON u.id = q.created_by WHERE q.id = $1`,
      [out.result.queryId],
    )
  ).rows[0];
  expect(q.email).toBe(analyst.email);
  expect(q.status).toBe("live");
  expect(q.backfill_status).toMatch(/done|quota_exhausted/);
  expect(out.result.initialQueryText).toBe("juniper");

  // The ledger explains why: the injected error, and what the agent did about it.
  const steps = out.ledger.map((e) => e.step);
  expect(steps).toEqual(
    expect.arrayContaining(["login", "create_query", "read_sample", "deliver"]),
  );
  const created = out.ledger.find((e) => e.step === "create_query")!;
  expect(created.injected_errors?.[0]).toMatchObject({ type: "weak_query" });
  const ledgerText = JSON.stringify(out.ledger);
  expect(ledgerText).not.toContain("rubric");
  expect(ledgerText).not.toContain("truth");
  // A junior who doesn't know exclusions says so, rather than silently doing better than their profile allows.
  if (out.profile.awareness.exclusions === "unknown")
    expect(out.ledger.find((e) => e.step === "refine")?.observed).toMatchObject({
      latent_need: "exclusions",
    });

  // The platform saw a labelled synthetic user, not the ledger.
  const evs = (
    await pool.query(
      `SELECT e.name, e.props FROM analytics_events e JOIN users u ON u.id = e.user_id WHERE u.email = $1`,
      [analyst.email],
    )
  ).rows;
  const names = new Set(evs.map((e) => e.name));
  for (const n of ["Login Completed", "Query Saved", "Mentions Feed Viewed"])
    expect(names, n).toContain(n);
  expect(evs.every((e) => e.props.is_synthetic === true && e.props.agent_run_id === run)).toBe(
    true,
  );
  expect(evs[0]!.props.persona_archetype).toBe("analyst_junior");

  // A deliverable exists and the evaluator scored the run against the corpus.
  const file = join(out.dir, "deliverable.md");
  expect(existsSync(file)).toBe(true);
  expect(readFileSync(file, "utf8")).toContain("Juniper Roast");
  expect(out.evaluation.deliverable.rubric_pass).toBe(true);
  expect(out.evaluation.query.matched).toBeGreaterThan(50);
  expect(out.evaluation.query.recall).toBeGreaterThan(0.3);
  expect(out.evaluation.query.precision).toBeGreaterThan(0.5);
});
