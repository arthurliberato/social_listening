// The partnerships manager's policy for an influencer case: find creators who fit, check who is real, shortlist,
// build a campaign inside the budget and invite the best. Content decisions come from the brain; how carefully comes
// from the profile (what the person knows to look at); mistakes that follow from that are logged (spec 7-9).
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Ledger } from "../ledger";
import type { AgentProfile } from "../types";
import type { Workspace } from "../workspace";
import { CreatorsUi } from "./creators-ui";
import { offerFor } from "./parse";
import type { Candidate, CampaignPlan, InfluencerCase, PartnershipsBrain } from "./types";

const know = (p: AgentProfile, k: string) =>
  p.awareness[k] === "tried" || p.awareness[k] === "fluent";

export async function runPartnershipsCase(o: {
  profile: AgentProfile;
  assignment: InfluencerCase;
  brain: PartnershipsBrain;
  ws: Workspace;
  ledger: Ledger;
  brand: string;
  deliverablePath?: string | null;
}): Promise<CampaignPlan> {
  const { profile: p, assignment: c, brain, ws, ledger } = o;
  const ui = new CreatorsUi(ws);
  const injected: CampaignPlan["injected"] = [];
  const log = (e: Parameters<Ledger["record"]>[0]) => {
    if (e.injected_errors) injected.push(...e.injected_errors);
    ledger.record(e);
  };
  const looksAtAuthenticity = know(p, "creator_authenticity");
  const tracksBudget = know(p, "creator_budget_tracking");

  // 1. Work out what the brief is asking for, using the names the product offers.
  const opts = await ui.filterOptions();
  const plan = await brain.planSearch({ brief: c.brief, ...opts });
  log({
    step: "plan_search",
    tool: "read_brief",
    intent: plan.rationale,
    observed: { platform: plan.platform, niche: plan.niche },
  });

  // 2. Search the directory, with the filters this person knows to use.
  const found = await ui.search({
    platform: plan.platform,
    niche: plan.niche,
    minAuthenticity: looksAtAuthenticity ? 70 : undefined,
    brandSafeOnly: looksAtAuthenticity,
  });
  log({
    step: "search",
    tool: "discover_creators",
    intent: "narrow the directory to creators that fit the brief",
    injected_errors: looksAtAuthenticity
      ? []
      : [
          {
            type: "unfiltered_quality",
            detail: "does not use the authenticity or brand-safety filters",
          },
        ],
    observed: {
      matches: found.matches,
      latent_need: looksAtAuthenticity ? undefined : "authenticity",
    },
  });

  // 3. Read as many pages as this person's habits allow.
  const pages = 1 + Math.round(p.traits.sampling_depth * 2);
  const candidates: Candidate[] = [];
  for (let i = 0; i < pages; i++) {
    candidates.push(...(await ui.readPage(looksAtAuthenticity)));
    if (!(await ui.nextPage())) break;
  }
  log({
    step: "read_candidates",
    tool: "read_table",
    intent: "read the creators on offer",
    observed: { read: candidates.length, pages },
  });

  // 4. Decide who to shortlist.
  const choice = await brain.choose({
    brief: c.brief,
    budgetUsd: c.budget_usd,
    wanted: c.creators_wanted,
    candidates,
  });
  const picked = choice.ids
    .map((id) => candidates.find((x) => x.id === id))
    .filter((x): x is Candidate => !!x);
  log({
    step: "choose",
    tool: "judge",
    intent: choice.rationale,
    observed: {
      picked: picked.map((x) => ({ id: x.id, followers: x.followers, rate: x.rateUsd })),
    },
  });

  // 5. Shortlist them, then build the campaign from the list.
  const campaignName = `${c.id} ${o.brand}`;
  const listName = `${campaignName} shortlist`;
  await ui.shortlist(
    picked.map((x) => x.id),
    listName,
  );
  log({
    step: "shortlist",
    tool: "add_to_list",
    intent: "keep the picks together",
    observed: { list: listName },
  });
  const campaignId = await ui.createCampaign(campaignName, c.budget_usd, listName);
  log({
    step: "create_campaign",
    tool: "create_campaign",
    intent: "set up the campaign with the budget from the brief",
    observed: { budget: c.budget_usd, creators: picked.length },
  });

  // 6. Invite the best, offering what the budget allows (or the asking rate, if nobody is keeping count).
  const invited: CampaignPlan["invited"] = [];
  let committed = 0;
  const toInvite = picked.slice(0, c.invites_wanted);
  for (const [i, creator] of toInvite.entries()) {
    const offer = offerFor(creator, {
      tracksBudget,
      remainingUsd: c.budget_usd - committed,
      slotsLeft: toInvite.length - i,
    });
    const message = await brain.writeInvite({
      campaign: campaignName,
      brand: o.brand,
      creator,
      offerUsd: offer,
    });
    await ui.invite(creator.name, offer, message);
    committed += offer;
    invited.push({ id: creator.id, offerUsd: offer });
    log({
      step: "invite",
      tool: "send_invitation",
      intent: `invite ${creator.name}`,
      injected_errors:
        !tracksBudget && committed > c.budget_usd
          ? [
              {
                type: "overspend",
                detail: `offers total $${committed} against a $${c.budget_usd} budget`,
              },
            ]
          : [],
      observed: {
        creator: creator.id,
        offer,
        committed,
        latent_need: tracksBudget ? undefined : "budget_tracking",
      },
    });
  }

  // 7. Write up the plan.
  const result: CampaignPlan = {
    campaignId,
    campaignName,
    picked,
    invited,
    committedUsd: committed,
    rationale: choice.rationale,
    injected,
  };
  const md = [
    `# ${campaignName}`,
    "",
    `Budget: $${c.budget_usd.toLocaleString("en-US")}. Committed in offers: $${committed.toLocaleString("en-US")}.`,
    "",
    "## Shortlist",
    ...picked.map(
      (x) =>
        `- ${x.name} (@${x.handle}): ${x.followers.toLocaleString("en-US")} followers, ${x.engagement}% engagement, ` +
        `authenticity ${x.authenticity ?? "not checked"}, asking $${x.rateUsd.toLocaleString("en-US")} per post`,
    ),
    "",
    "## Invited",
    ...invited.map(
      (i) => `- ${picked.find((x) => x.id === i.id)?.name}: $${i.offerUsd.toLocaleString("en-US")}`,
    ),
    "",
    `Why: ${choice.rationale}.`,
    "",
  ].join("\n");
  if (o.deliverablePath) {
    mkdirSync(dirname(o.deliverablePath), { recursive: true });
    writeFileSync(o.deliverablePath, md);
  }
  log({
    step: "deliver",
    tool: "write_plan",
    intent: "hand over the campaign plan",
    observed: { committed },
  });
  return result;
}
