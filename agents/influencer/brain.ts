// The scripted partnerships brain: rules, no model, runs anywhere. It decides from what it can see, so an agent that
// can't see authenticity chooses on size, as a person who doesn't look at it would.
import { offerFor, pickBest, planFromBrief } from "./parse";
import type { PartnershipsBrain } from "./types";

export class ScriptedPartnershipsBrain implements PartnershipsBrain {
  readonly name = "scripted";
  readonly model = null;

  async planSearch(i: { brief: string; platforms: string[]; niches: string[] }) {
    return planFromBrief(i.brief, i.platforms, i.niches);
  }

  async choose(i: {
    brief: string;
    budgetUsd: number;
    wanted: number;
    candidates: Parameters<PartnershipsBrain["choose"]>[0]["candidates"];
  }) {
    // With no authenticity on screen there is nothing to weigh trust by: big accounts look best.
    const blind = i.candidates.length > 0 && i.candidates.every((c) => c.authenticity === null);
    const picked = pickBest(i.candidates, i.wanted, { sizeBias: blind, budgetUsd: i.budgetUsd });
    return {
      ids: picked.map((c) => c.id),
      rationale: blind
        ? "no authenticity on screen, so ranked by audience size"
        : "ranked by engagement and audience trust per dollar, brand-safe only, within budget",
    };
  }

  async writeInvite(i: {
    campaign: string;
    brand: string;
    creator: { name: string };
    offerUsd: number;
  }) {
    return `Hi ${i.creator.name.split(" ")[0]}, we're ${i.brand} and we'd love to work with you on "${i.campaign}". We can offer $${i.offerUsd.toLocaleString("en-US")} per post. Let us know if that works.`;
  }
}

export { offerFor };
