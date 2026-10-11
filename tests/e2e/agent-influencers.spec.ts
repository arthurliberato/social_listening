import { expect, test } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { runInfluencerCase } from "../../agents/influencer/run";
import { seedAgents } from "../../lib/sim/seed-agents";
import { pool } from "./helpers";

// An influencer-marketing agent takes a campaign case end to end through the real screens: it reads the brief, filters
// the directory, shortlists, builds a campaign and invites, leaving a ledger, labelled events and a plan, and is scored.
test("a partnerships agent runs a campaign case, and what it knows shows in the result", async ({}, testInfo) => {
  test.setTimeout(420_000);
  const run = `ci-${Date.now().toString(36)}`;
  const agents = await seedAgents({ accounts: 2, seed: 9, run, onboardOwner: true });
  const strategists = agents.filter((a) => a.role === "strategist");
  const senior = strategists[0]!;
  // The same kind of person with less practice: a junior who doesn't look at authenticity or keep a running total.
  const junior = {
    ...strategists[1]!,
    agent_id: `${strategists[1]!.agent_id}_jr`,
    seniority: "junior" as const,
    persona: "strategist_junior",
  };
  const base = { caseId: "CI-001", runId: run, baseUrl: "http://localhost:3000" };
  const outDir = join(testInfo.outputDir, "agents");

  const a = await runInfluencerCase({ ...base, agent: senior, outDir });
  const b = await runInfluencerCase({ ...base, agent: junior, outDir });

  if (process.env.AGENT_VERBOSE)
    console.log(JSON.stringify({ senior: a.evaluation, junior: b.evaluation }, null, 1));
  // The senior knows to filter on authenticity and brand safety and to keep to the budget.
  expect(a.profile.awareness.creator_authenticity).not.toBe("unknown");
  expect(a.plan.picked).toHaveLength(3);
  expect(a.plan.invited).toHaveLength(2);
  expect(a.evaluation.rubric.pass).toBe(true);
  expect(a.evaluation.campaign.authentic_share).toBe(1);
  expect(a.evaluation.outreach.within_budget).toBe(true);
  // ...and puts the budget to work instead of leaving most of it unspent.
  expect(a.evaluation.outreach.committed_usd).toBeGreaterThan(1500);
  expect(a.plan.picked.every((c) => c.platform === "instagram" && c.niche === "food")).toBe(true);

  // The junior is blind to authenticity, so the ledger says what was missing, and the campaign is no better than chance
  // on the audience quality it never looked at.
  // "Aware" means they have heard of it but don't use it.
  expect(["unknown", "aware"]).toContain(b.profile.awareness.creator_authenticity);
  const searchStep = b.ledger.find((e) => e.step === "search")!;
  expect(searchStep.observed).toMatchObject({ latent_need: "authenticity" });
  expect(b.plan.picked.every((c) => c.authenticity === null)).toBe(true);
  expect(b.evaluation.campaign.authentic_share ?? 0).toBeLessThanOrEqual(
    a.evaluation.campaign.authentic_share ?? 1,
  );
  // Nobody was keeping count, so the offers add up to more than the budget, and the ledger says so.
  expect(b.evaluation.outreach.within_budget).toBe(false);
  expect(b.evaluation.rubric.pass).toBe(false);
  expect(b.ledger.some((e) => e.injected_errors?.some((x) => x.type === "overspend"))).toBe(true);
  // They reached for audience size: the biggest accounts, which ask for far more in total.
  const asked = (picked: { rateUsd: number }[]) => picked.reduce((sum, c) => sum + c.rateUsd, 0);
  expect(asked(b.plan.picked)).toBeGreaterThan(asked(a.plan.picked));

  // The work is in the platform, made by the agent, with a campaign of the right size.
  const c = (
    await pool.query(
      `SELECT c.budget_usd, c.name, (SELECT count(*)::int FROM campaign_invites i WHERE i.campaign_id = c.id) AS invites FROM campaigns c WHERE c.id = $1`,
      [a.plan.campaignId],
    )
  ).rows[0];
  expect(c.name).toContain("CI-001");
  expect(Number(c.budget_usd)).toBe(6000);
  expect(c.invites).toBe(2);

  // Ledger, plan and events: the ledger explains, the platform sees a labelled synthetic user.
  const steps = a.ledger.map((e) => e.step);
  expect(steps).toEqual(
    expect.arrayContaining([
      "login",
      "plan_search",
      "search",
      "choose",
      "shortlist",
      "create_campaign",
      "invite",
      "deliver",
    ]),
  );
  const ledgerText = JSON.stringify(a.ledger);
  expect(ledgerText).not.toContain("min_authenticity");
  expect(existsSync(join(a.dir, "campaign-plan.md"))).toBe(true);
  expect(readFileSync(join(a.dir, "campaign-plan.md"), "utf8")).toContain("Latte Lane");
  const evs = (
    await pool.query(
      `SELECT e.name, e.props FROM analytics_events e JOIN users u ON u.id = e.user_id WHERE u.email = $1`,
      [senior.email],
    )
  ).rows;
  const names = new Set(evs.map((e) => e.name));
  for (const n of [
    "Creator Search Run",
    "Creator Added To List",
    "Campaign Created",
    "Creator Invitation Sent",
  ])
    expect(names, n).toContain(n);
  expect(evs.every((e) => e.props.is_synthetic === true && e.props.agent_run_id === run)).toBe(
    true,
  );
  expect(evs.every((e) => e.props.persona_archetype === "strategist_senior")).toBe(true);
  expect(
    evs
      .filter((e) => e.name === "Creator Invitation Sent")
      .every((e) => e.props.product === "influencers"),
  ).toBe(true);
});
