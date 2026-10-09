// Shared shapes for the autonomous agents (see docs/agents.md).
export type Awareness = "unknown" | "aware" | "tried" | "fluent";
export type AgentRole = "division_leader" | "account_exec" | "strategist" | "analyst";
export type Seniority = "lead" | "senior" | "mid" | "junior";

export interface AgentProfile {
  agent_id: string;
  account_id: string;
  workspace_slug: string;
  role: AgentRole;
  seniority: Seniority;
  region: string;
  persona: string;
  working_hours: { start: number; end: number; lunch_dip: boolean };
  traits: {
    digital_fluency: number;
    learning_rate: number;
    mentoring_propensity: number;
    sampling_depth: number;
    refinement_diligence: number;
    correction_propensity: number;
    offline_report_tendency: number;
    ai_summary_usage: number;
    data_judgment: number;
    quality_standard: number;
  };
  competencies: {
    spreadsheet_fluency: number;
    syntax_effective: number;
    intent_clarity: number;
    api_literacy: number;
  };
  awareness: Record<string, Awareness>;
  state: {
    fatigue: number;
    workload: number;
    deadline_pressure: number;
    frustration: number;
    trust_in_data: number;
  };
  policy: {
    tier: 0 | 1 | 2;
    provider: string;
    model: string | null;
    prompt_version: string;
    perception: "text" | "text+vision";
  };
  seed: number;
}

/** What an agent is given. The truth and rubric live elsewhere and never reach it. */
export interface PublicCase {
  id: string;
  client_project_id: string;
  requester_role: string;
  brief: string;
  deliverable: "findings_and_recommendations";
  window_days: number;
  monitoring_scope: string;
  due_in_days: number;
}
export interface CaseTruth {
  id: string;
  /** The brand the case is about, as the corpus names it. */
  brand: string;
  rubric: { mentions_brand: boolean; min_recommendations: number; min_findings: number };
}

export interface SampleMention {
  id: number;
  text: string;
  sentiment: string;
}

export interface Deliverable {
  title: string;
  findings: string[];
  recommendations: string[];
  numbers: { total: number; negative_share: number; positive_share: number };
  categories: { name: string; count: number }[];
}

/** The content decisions of an agent. A scripted brain needs no model; a Claude brain uses one. */
export interface Brain {
  readonly name: string;
  readonly model: string | null;
  draftQuery(i: {
    brief: string;
    scope: string;
    operators: string[];
  }): Promise<{ text: string; rationale: string }>;
  judgeRelevance(i: {
    scope: string;
    mentions: SampleMention[];
  }): Promise<{ id: number; relevant: boolean }[]>;
  proposeExclusions(i: {
    scope: string;
    irrelevant: string[];
    relevant: string[];
  }): Promise<string[]>;
  judgeSentiment(i: {
    mentions: SampleMention[];
  }): Promise<{ id: number; sentiment: "positive" | "negative" | "neutral" }[]>;
  proposeCategories(i: {
    scope: string;
    mentions: SampleMention[];
  }): Promise<{ name: string; search: string }[]>;
  /** Optional: a brain that can look at a screenshot. Without it the agent works from page text alone. */
  look?(i: {
    step: string;
    question: string;
    image: { base64: string; mediaType: "image/jpeg" };
  }): Promise<{ observation: string; visual_issues: string[] }>;
  writeDeliverable(i: {
    brief: string;
    scope: string;
    numbers: Deliverable["numbers"];
    categories: Deliverable["categories"];
    negatives: string[];
    /** What the agent saw on screen, when it can look. */
    visualNotes?: string[];
  }): Promise<Deliverable>;
}
