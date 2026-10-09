// Cases are split in two files on purpose: the public assignment an agent receives, and the truth only the
// evaluator reads (spec 4). The runner hands agents `loadCase` and nothing else.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { InfluencerCase, InfluencerTruth } from "./influencer/types";
import type { CaseTruth, PublicCase } from "./types";

const dir = join(__dirname, "cases");
export const loadCase = (id: string): PublicCase =>
  JSON.parse(readFileSync(join(dir, `${id}.json`), "utf8"));
export const loadTruth = (id: string): CaseTruth =>
  JSON.parse(readFileSync(join(dir, `${id}.truth.json`), "utf8"));

// Influencer cases carry `kind: "influencers"` and have their own shapes.
export const caseKind = (id: string): "listening" | "influencers" =>
  (JSON.parse(readFileSync(join(dir, `${id}.json`), "utf8")) as { kind?: string }).kind ===
  "influencers"
    ? "influencers"
    : "listening";
export const loadInfluencerCase = (id: string): InfluencerCase =>
  JSON.parse(readFileSync(join(dir, `${id}.json`), "utf8"));
export const loadInfluencerTruth = (id: string): InfluencerTruth =>
  JSON.parse(readFileSync(join(dir, `${id}.truth.json`), "utf8"));
