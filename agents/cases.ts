// Cases are split in two files on purpose: the public assignment an agent receives, and the truth only the
// evaluator reads (spec 4). The runner hands agents `loadCase` and nothing else.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { CaseTruth, PublicCase } from "./types";

const dir = join(__dirname, "cases");
export const loadCase = (id: string): PublicCase =>
  JSON.parse(readFileSync(join(dir, `${id}.json`), "utf8"));
export const loadTruth = (id: string): CaseTruth =>
  JSON.parse(readFileSync(join(dir, `${id}.truth.json`), "utf8"));
