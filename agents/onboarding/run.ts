// The onboarding case (CO-001): a newly invited account owner signs in and goes through the first-run wizard, the way a
// person would. Nothing here reads the database or calls a hidden endpoint. An owner whose plan has no query slot free
// meets the limit at step 4, tries again a few times, and leaves; one whose plan has room finishes. What happens is
// decided by the product, not by the agent, so the funnel it produces is a real measurement of the product.
import { chromium, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BRANDS } from "../../datagen/config";
import { Ledger } from "../ledger";
import { loadCase } from "../cases";
import { sampleProfile } from "../profile";
import type { ManifestAgent } from "../run-case";

export type OnboardingOutcome = "completed" | "abandoned" | "already_onboarded";

export interface OnboardingResult {
  outcome: OnboardingOutcome;
  /** The wizard step (1 to 5) the agent was on when it finished or gave up. */
  last_step: number;
  /** How many times it pressed the button on a step that refused it. */
  blocked_attempts: number;
  used_escape: boolean;
  seconds: number;
}

/** A small stable number from a string, so an agent behaves the same on every run (until real latent traits replace it). */
const hash = (s: string) => [...s].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0, 7);
const pick = <T>(xs: readonly T[], seed: number) => xs[seed % xs.length]!;

// Job role chosen in step 1, by the agent's persona (an owner is a leader: these are the roles that fit one).
const ROLE_CHOICES = ["exec", "comms", "agency", "social"] as const;
const GOAL_CHOICES = ["brand_monitoring", "competitor", "campaign", "crisis", "research"] as const;

const BRAND_NAMES = BRANDS.slice(0, 40).map((b) => b.name);

export async function runOnboardingCase(o: {
  agent: ManifestAgent;
  caseId: string;
  runId: string;
  baseUrl: string;
  outDir: string;
  clock?: string;
  headed?: boolean;
}): Promise<{ result: OnboardingResult; dir: string; ledger: Ledger["entries"] }> {
  const assignment = loadCase(o.caseId);
  const profile = sampleProfile(o.agent, { provider: "scripted", model: "scripted" });
  const dir = join(o.outDir, o.runId, o.agent.agent_id);
  mkdirSync(dir, { recursive: true });
  const ledger = new Ledger(join(dir, "ledger.jsonl"), {
    profile,
    case_id: assignment.id,
    task_id: `${assignment.id}-${o.agent.agent_id}`,
    run_id: o.runId,
  });
  const h = hash(o.agent.agent_id);
  // How many times a person presses a button that keeps refusing them before they give up: 1 to 3.
  const patience = 1 + (h % 3);
  const started = Date.now();

  const browser = await chromium.launch({
    headless: !o.headed,
    ...(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {}),
  });
  try {
    const context = await browser.newContext({ viewport: { width: 1360, height: 860 } });
    context.setDefaultTimeout(30_000);
    await context.addCookies([
      {
        name: "rw_sim",
        value: Buffer.from(
          JSON.stringify({
            persona: profile.persona,
            run: o.runId,
            model: "scripted",
            ...(o.clock ? { clock: o.clock } : {}),
          }),
        ).toString("base64"),
        url: o.baseUrl,
      },
    ]);
    const page = await context.newPage();
    const go = async (path: string) => {
      await page.goto(`${o.baseUrl}${path}`);
      await page.waitForLoadState("networkidle");
    };
    await go("/login");
    await page.getByTestId("login-email").fill(o.agent.email);
    await page.getByTestId("login-password").fill(o.agent.password);
    await page.getByTestId("login-submit").click();
    await page.waitForURL(/\/(onboarding|hub|w\/[^/]+\/)/, { timeout: 30_000 });
    await page.waitForLoadState("networkidle");
    ledger.record({
      step: "login",
      tool: "navigate",
      intent: "sign in with the login I was given",
    });

    const result: OnboardingResult = {
      outcome: "completed",
      last_step: 5,
      blocked_attempts: 0,
      used_escape: false,
      seconds: 0,
    };
    if (!new URL(page.url()).pathname.startsWith("/onboarding")) {
      result.outcome = "already_onboarded";
      ledger.record({ step: "onboarding", tool: "observe", intent: "setup is already done" });
    } else {
      await walkWizard(page, h, patience, result, ledger);
    }
    result.seconds = Math.round((Date.now() - started) / 1000);
    // Leaving the page is what makes the wizard report that the person left; give the report a moment to go out.
    if (result.outcome === "abandoned") {
      await page.goto("about:blank");
      await page.waitForTimeout(1500);
    }
    writeFileSync(join(dir, "onboarding.json"), JSON.stringify(result, null, 2));
    writeFileSync(join(dir, "profile.json"), JSON.stringify(profile, null, 2));
    return { result, dir, ledger: ledger.entries };
  } finally {
    await browser.close();
  }
}

async function walkWizard(
  page: Page,
  h: number,
  patience: number,
  result: OnboardingResult,
  ledger: Ledger,
) {
  const step = async () =>
    Number(/Step (\d) of/.exec(await page.getByTestId("onboarding-progress").innerText())?.[1]);
  const next = () => page.getByTestId("onboarding-next").click();

  // 1. Who they are.
  await page.getByTestId(`role-${pick(ROLE_CHOICES, h)}`).check();
  ledger.record({ step: "onboarding_role", tool: "click", intent: "say what my role is" });
  await next();
  // 2. What they want to do first (optional): one or two goals.
  await page.getByTestId("onboarding-progress").getByText("Step 2").waitFor();
  for (const g of [pick(GOAL_CHOICES, h >> 3), pick(GOAL_CHOICES, h >> 5)])
    await page.getByTestId(`goal-${g}`).check();
  ledger.record({
    step: "onboarding_goals",
    tool: "click",
    intent: "pick what I want to do first",
  });
  await next();
  // 3. Their brand, one that exists in the data.
  await page.getByTestId("onboarding-progress").getByText("Step 3").waitFor();
  const brand = pick(BRAND_NAMES, h >> 7);
  await page.getByTestId("brand-name").fill(brand);
  ledger.record({
    step: "onboarding_brand",
    tool: "type",
    intent: `name the brand I care about: ${brand}`,
  });
  await next();
  // 4. The first query. This is where a plan with no free query slot refuses.
  await page.getByTestId("onboarding-progress").getByText("Step 4").waitFor();
  await page.getByTestId("query-estimate").waitFor({ timeout: 30_000 });
  for (;;) {
    await next();
    const moved = await Promise.race([
      page
        .getByTestId("onboarding-progress")
        .getByText("Step 5")
        .waitFor()
        .then(() => true),
      page
        .getByTestId("onboarding-error")
        .waitFor()
        .then(() => false),
    ]);
    if (moved) break;
    result.blocked_attempts++;
    const message = (await page.getByTestId("onboarding-error").innerText()).slice(0, 200);
    const escape = page.getByTestId("onboarding-escape");
    if (await escape.count()) {
      result.used_escape = true;
      ledger.record({
        step: "onboarding_query",
        tool: "click",
        intent: "the plan won't let me, but there is a way past it",
        observed: { message },
      });
      await escape.click();
      await page.getByTestId("onboarding-progress").getByText("Step 5").waitFor();
      break;
    }
    ledger.record({
      step: "onboarding_query",
      tool: "observe",
      intent: "it refused me",
      observed: { message, attempt: result.blocked_attempts },
    });
    if (result.blocked_attempts >= patience) {
      result.outcome = "abandoned";
      result.last_step = await step();
      ledger.record({
        step: "onboarding_exit",
        tool: "leave",
        intent: "no way past it, I stop here",
      });
      return;
    }
  }
  // 5. Invite teammates: skipped, the team already exists.
  await page.getByTestId("onboarding-skip").click();
  await page.waitForURL(/\/w\/[^/]+\/home/, { timeout: 30_000 });
  ledger.record({
    step: "onboarding_done",
    tool: "navigate",
    intent: "setup finished, on the home screen",
  });
}
