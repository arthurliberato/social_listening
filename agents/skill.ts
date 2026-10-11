// The skill and error layer (spec 8-9): applied outside the model, so its effect is controlled and logged.
import type { Rng } from "../datagen/rng";
import type { AgentProfile } from "./types";

const know = (p: AgentProfile, k: string) =>
  p.awareness[k] === "tried" || p.awareness[k] === "fluent";

/** Operators the agent knows to use. An unknown operator does not exist for it (spec 8). */
export function knownOperators(p: AgentProfile): string[] {
  const ops = ["OR"];
  if (know(p, "phrases")) ops.push("quotes");
  if (know(p, "exclusions")) ops.push("NOT");
  if (know(p, "near_operator")) ops.push("NEAR");
  return ops;
}

export interface Injected {
  type: string;
  detail: string;
}

/** A weaker analyst drops the exact phrase and searches the bare brand word, which pulls in homonyms. */
export function degradeQuery(
  p: AgentProfile,
  text: string,
  rng: Rng,
  force = false,
): { text: string; errors: Injected[] } {
  const pWeak = Math.max(0, 0.8 - p.competencies.syntax_effective);
  const weak = force || rng.bool(pWeak);
  const phrase = /^"([^"]+)"/.exec(text);
  if (weak && phrase) {
    const bare = phrase[1]!.split(/\s+/)[0]!.toLowerCase();
    return {
      text: bare,
      errors: [
        {
          type: "weak_query",
          detail: `searched ${bare} instead of "${phrase[1]}" (syntax ${p.competencies.syntax_effective.toFixed(2)})`,
        },
      ],
    };
  }
  return { text, errors: [] };
}

/** How many refinement rounds this analyst is willing to do (spec 9: diligence, fatigue). */
export function refinementBudget(
  p: AgentProfile,
  rng: Rng,
): { rounds: number; errors: Injected[] } {
  const want = 1 + Math.round(p.traits.refinement_diligence * 3);
  const prematureStop = rng.bool((1 - p.traits.refinement_diligence) * 0.4 + p.state.fatigue * 0.3);
  if (prematureStop && want > 1)
    return {
      rounds: 1,
      errors: [
        { type: "premature_stop", detail: `would have refined ${want} times, stopped after 1` },
      ],
    };
  return { rounds: want, errors: [] };
}
