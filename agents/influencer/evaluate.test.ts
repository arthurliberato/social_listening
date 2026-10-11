import { describe, expect, it } from "vitest";
import { scoreCampaign } from "./evaluate";
import type { InfluencerTruth } from "./types";

const truth: InfluencerTruth = {
  id: "CI-001",
  platform: "instagram",
  niche: "food",
  min_authenticity: 70,
  brand_safe_required: true,
  budget_usd: 6000,
  creators_wanted: 3,
  invites_wanted: 2,
};
const row = (o: Partial<Parameters<typeof scoreCampaign>[1][number]> = {}) => ({
  platform: "instagram",
  niche: "food",
  authenticity: 85,
  brandSafety: "safe",
  ...o,
});

describe("scoring a campaign against the case", () => {
  it("passes when the roster fits, the invitations are made and the offers stay in budget", () => {
    const e = scoreCampaign(truth, [row(), row(), row()], [1500, 2000]);
    expect(e.rubric).toEqual({
      invitations_made: true,
      within_budget: true,
      fits_brief: true,
      pass: true,
    });
    expect(e.campaign).toMatchObject({ roster: 3, all_criteria: 3, authentic_share: 1 });
    expect(e.outreach).toMatchObject({ committed_usd: 3500, over_budget_usd: 0 });
  });
  it("fails on offers above the budget, and says by how much", () => {
    const e = scoreCampaign(truth, [row(), row(), row()], [5000, 5250]);
    expect(e.rubric.within_budget).toBe(false);
    expect(e.rubric.pass).toBe(false);
    expect(e.outreach.over_budget_usd).toBe(4250);
  });
  it("counts audience quality and brand safety separately from fit", () => {
    const e = scoreCampaign(
      truth,
      [row({ authenticity: 40 }), row({ brandSafety: "risk" }), row({ platform: "tiktok" })],
      [1000, 1000],
    );
    expect(e.campaign).toMatchObject({
      roster: 3,
      fit_platform_niche: 2,
      authentic: 2,
      brand_safe: 2,
      all_criteria: 0,
    });
    expect(e.campaign.authentic_share).toBeCloseTo(2 / 3);
    expect(e.rubric.fits_brief).toBe(false);
  });
  it("needs enough invitations and a full roster; an empty campaign has no share", () => {
    expect(scoreCampaign(truth, [row(), row(), row()], [1000]).rubric.invitations_made).toBe(false);
    const empty = scoreCampaign(truth, [], []);
    expect(empty.campaign.authentic_share).toBeNull();
    expect(empty.rubric.pass).toBe(false);
  });
});
