// The ledger: private ground truth about what an agent did and why (spec 14). Kept apart from the platform's events,
// which show only what a user would observe.
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { AgentProfile } from "./types";
import type { Injected } from "./skill";

export interface LedgerEntry {
  step: string;
  tool: string;
  intent: string;
  injected_errors?: Injected[];
  llm_call_id?: string | null;
  observed?: Record<string, unknown>;
}

export class Ledger {
  readonly entries: (LedgerEntry & Record<string, unknown>)[] = [];
  constructor(
    private readonly file: string | null,
    private readonly ctx: {
      profile: AgentProfile;
      case_id: string;
      task_id: string;
      run_id: string;
    },
  ) {
    if (file) mkdirSync(dirname(file), { recursive: true });
  }
  record(e: LedgerEntry) {
    const { profile: p } = this.ctx;
    const row = {
      ts: new Date().toISOString(),
      run_id: this.ctx.run_id,
      agent_id: p.agent_id,
      case_id: this.ctx.case_id,
      task_id: this.ctx.task_id,
      mission: "setup+investigate",
      capabilities_known: Object.entries(p.awareness)
        .filter(([, v]) => v !== "unknown")
        .map(([k]) => k),
      awareness_state: p.awareness,
      skill_snapshot: p.competencies,
      state_snapshot: p.state,
      ...e,
    };
    this.entries.push(row);
    if (this.file) appendFileSync(this.file, JSON.stringify(row) + "\n");
  }
}
