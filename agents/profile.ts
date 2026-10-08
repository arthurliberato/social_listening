// A profile is sampled from a role archetype and a seniority, deterministically from the agent id (spec 3).
import { hashSeed, Rng } from "../datagen/rng";
import type { AgentProfile, AgentRole, Awareness, Seniority } from "./types";

const clamp = (x: number) => Math.min(1, Math.max(0, x));
const FLUENCY: Record<Seniority, number> = { lead: 0.82, senior: 0.7, mid: 0.55, junior: 0.35 };
const REGION_HOURS: Record<string, [number, number]> = {
  us_east: [9, 18],
  us_west: [9, 18],
  uk: [9, 17],
  de: [8, 17],
  br: [9, 18],
  in: [10, 19],
  au: [8, 17],
};

export function sampleProfile(
  a: {
    agent_id: string;
    account_id: string;
    workspace_slug: string;
    role: AgentRole;
    seniority: Seniority;
    region: string;
    persona: string;
  },
  opts: { provider?: string; model?: string | null; tier?: 0 | 1 | 2; vision?: boolean } = {},
): AgentProfile {
  const seed = hashSeed(a.agent_id);
  const r = new Rng(seed);
  const n = (sd: number) => r.normal() * sd;
  // One shared latent factor drives most skills, so a fluent person is fluent across the board (spec 4A).
  const fluency = clamp(FLUENCY[a.seniority] + n(0.08));
  const seniorityShift = { lead: 0.15, senior: 0.08, mid: 0, junior: -0.1 }[a.seniority];
  const syntax = clamp(fluency + n(0.07));
  const known = (min: number): Awareness =>
    syntax >= min ? "tried" : syntax >= min - 0.2 ? "aware" : "unknown";
  const [start, end] = REGION_HOURS[a.region] ?? [9, 18];
  return {
    ...a,
    working_hours: { start, end, lunch_dip: true },
    traits: {
      digital_fluency: fluency,
      learning_rate: clamp(0.5 + n(0.12)),
      mentoring_propensity: clamp(0.3 + seniorityShift + n(0.1)),
      sampling_depth: clamp(0.55 + seniorityShift / 2 + n(0.1)),
      refinement_diligence: clamp(0.5 + seniorityShift + n(0.12)),
      correction_propensity: clamp(0.4 + n(0.15)),
      offline_report_tendency: clamp(0.5 + n(0.15)),
      ai_summary_usage: clamp(0.5 + n(0.15)),
      data_judgment: clamp(0.45 + seniorityShift + n(0.1)),
      quality_standard: clamp(0.4 + seniorityShift + n(0.1)),
    },
    competencies: {
      spreadsheet_fluency: clamp(fluency + n(0.1)),
      syntax_effective: syntax,
      intent_clarity: clamp(fluency + n(0.1)),
      api_literacy: clamp(0.02 + Math.abs(n(0.03))),
    },
    awareness: {
      keyword_query: "fluent",
      date_and_platform_filters: syntax >= 0.4 ? "fluent" : "aware",
      exclusions: known(0.5),
      phrases: known(0.4),
      near_operator: known(0.75),
      tags_and_categories: known(0.55),
      sentiment_override: known(0.5),
      url_operator_replies: syntax >= 0.8 ? "aware" : "unknown",
      api_access: "unknown",
    },
    state: {
      fatigue: clamp(0.1 + Math.abs(n(0.05))),
      workload: clamp(0.4 + n(0.1)),
      deadline_pressure: clamp(0.2 + Math.abs(n(0.1))),
      frustration: 0,
      trust_in_data: clamp(0.6 + n(0.1)),
    },
    policy: {
      tier: opts.tier ?? 1,
      provider: opts.provider ?? "scripted",
      model: opts.model ?? null,
      prompt_version: "m1-1",
      perception: opts.vision ? "text+vision" : "text",
    },
    seed,
  };
}
