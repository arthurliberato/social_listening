// Usage: npx tsx agents/batch.ts --manifest agents-demo.json --base https://your-site [--provider scripted|claude]
//          [--case CS-001] [--profile growth,agency-low] [--role analyst] [--per-account 1] [--count 20]
//          [--agents id1,id2] [--seed 1] [--concurrency 2] [--retries 1] [--timeout-min 10] [--redo]
//          [--out agents/out] [--run demo] [--dry-run]
// Runs many agents through a case, a few at a time. Each run is resumable (finished agents are skipped unless
// --redo), failures are retried, and every outcome lands in <out>/<run>/batch-results.jsonl and batch-summary.csv.
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { pool } from "@/db/client";
import { selectAgents, type Selection } from "./select";
import { caseKind } from "./cases";
import { runCase, type ManifestAgent } from "./run-case";

type Agent = ManifestAgent & { account_profile?: string };
interface Row {
  agent_id: string;
  account_profile: string;
  seniority: string;
  status: "ok" | "failed";
  attempts: number;
  seconds: number;
  precision: number | null;
  recall: number | null;
  f1: number | null;
  spam_share: number | null;
  total_error_pct: number | null;
  rubric_pass: boolean | null;
  llm_calls: number;
  input_tokens: number;
  output_tokens: number;
  error: string;
}

const arg = (k: string, d?: string) => {
  const i = process.argv.indexOf(`--${k}`);
  return i >= 0 ? process.argv[i + 1] : d;
};
const list = (v?: string) =>
  v
    ? v
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean)
    : undefined;
const num = (v: string | undefined) => (v === undefined ? undefined : Number(v));

const withTimeout = <T>(p: Promise<T>, ms: number) =>
  new Promise<T>((resolve, reject) => {
    const t = setTimeout(
      () => reject(new Error(`timed out after ${Math.round(ms / 60_000)} min`)),
      ms,
    );
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });

const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const fmt = (x: number) => (Number.isNaN(x) ? "-" : x.toFixed(2));
const mean = (xs: (number | null)[]) => {
  const v = xs.filter((x): x is number => x !== null);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN;
};

async function main() {
  const manifest = JSON.parse(readFileSync(arg("manifest", "agents-demo.json")!, "utf8")) as {
    run: string;
    agents: Agent[];
  };
  const caseId = arg("case", "CS-001")!;
  if (caseKind(caseId) !== "listening")
    throw new Error(`batch runs listening cases (CS-*); ${caseId} is not one`);
  const provider = arg("provider", "scripted") as "scripted" | "claude";
  const base = arg("base", "http://localhost:3000")!;
  const out = arg("out", "agents/out")!;
  const runId = arg("run", manifest.run)!;
  const concurrency = Math.max(1, num(arg("concurrency")) ?? 1);
  const retries = Math.max(0, num(arg("retries")) ?? 1);
  const timeoutMs = (num(arg("timeout-min")) ?? 10) * 60_000;
  const redo = process.argv.includes("--redo");

  const selection: Selection = {
    agents: list(arg("agents")),
    roles: list(arg("role")),
    profiles: list(arg("profile")),
    perAccount: num(arg("per-account")),
    seed: num(arg("seed")),
    count: num(arg("count")),
  };
  const chosen = selectAgents(manifest.agents, selection);
  const dir = join(out, runId);
  mkdirSync(dir, { recursive: true });
  const resultsFile = join(dir, "batch-results.jsonl");
  const rows = new Map<string, Row>();
  if (existsSync(resultsFile))
    for (const l of readFileSync(resultsFile, "utf8").split("\n").filter(Boolean)) {
      const r = JSON.parse(l) as Row;
      rows.set(r.agent_id, r);
    }
  const todo = chosen.filter((a) => redo || rows.get(a.agent_id)?.status !== "ok");
  console.log(
    `${chosen.length} agents selected, ${chosen.length - todo.length} already done, ${todo.length} to run ` +
      `(case ${caseId}, ${provider}, concurrency ${concurrency}, ${retries} retr${retries === 1 ? "y" : "ies"}) against ${base}`,
  );
  if (process.argv.includes("--dry-run")) {
    for (const a of todo)
      console.log(`  ${a.agent_id}  ${a.account_profile ?? "-"}  ${a.seniority}`);
    return;
  }

  let finished = 0;
  const queue = [...todo];
  async function runOne(a: Agent) {
    const started = Date.now();
    let attempts = 0;
    let error = "";
    let row: Row | null = null;
    while (attempts <= retries && !row) {
      attempts++;
      rmSync(join(dir, a.agent_id), { recursive: true, force: true }); // never mix a failed attempt into the next
      try {
        const res = await withTimeout(
          runCase({ agent: a, caseId, runId, baseUrl: base, outDir: out, provider }),
          timeoutMs,
        );
        const ev = res.evaluation as unknown as {
          query: { precision: number; recall: number; f1: number; spam_share: number };
          deliverable: { total_error_pct: number; rubric_pass: boolean };
        };
        const calls = (
          res.ledger as unknown as { step: string; observed?: Record<string, number> }[]
        ).filter((e) => e.step === "llm_call");
        row = {
          agent_id: a.agent_id,
          account_profile: a.account_profile ?? "",
          seniority: a.seniority,
          status: "ok",
          attempts,
          seconds: Math.round((Date.now() - started) / 1000),
          precision: ev.query.precision,
          recall: ev.query.recall,
          f1: ev.query.f1,
          spam_share: ev.query.spam_share,
          total_error_pct: ev.deliverable.total_error_pct,
          rubric_pass: ev.deliverable.rubric_pass,
          llm_calls: calls.length,
          input_tokens: calls.reduce((s, c) => s + (c.observed?.input_tokens ?? 0), 0),
          output_tokens: calls.reduce((s, c) => s + (c.observed?.output_tokens ?? 0), 0),
          error: "",
        };
      } catch (e) {
        error = (e as Error).message.split("\n")[0]!.slice(0, 200);
      }
    }
    row ??= {
      agent_id: a.agent_id,
      account_profile: a.account_profile ?? "",
      seniority: a.seniority,
      status: "failed",
      attempts,
      seconds: Math.round((Date.now() - started) / 1000),
      precision: null,
      recall: null,
      f1: null,
      spam_share: null,
      total_error_pct: null,
      rubric_pass: null,
      llm_calls: 0,
      input_tokens: 0,
      output_tokens: 0,
      error,
    };
    rows.set(a.agent_id, row);
    appendFileSync(resultsFile, JSON.stringify(row) + "\n");
    finished++;
    console.log(
      `[${finished}/${todo.length}] ${a.agent_id} ${row.account_profile || "-"} ${row.status}` +
        (row.status === "ok"
          ? `  precision ${row.precision} recall ${row.recall}  ${row.seconds}s  tokens ${row.input_tokens}/${row.output_tokens}`
          : `  ${row.error} (${row.attempts} attempt${row.attempts === 1 ? "" : "s"})`),
    );
  }
  async function lane() {
    for (let a = queue.shift(); a; a = queue.shift()) await runOne(a);
  }
  await Promise.all(Array.from({ length: concurrency }, lane));

  // Summary over everything recorded for this run, not just this invocation.
  const all = [...rows.values()];
  const cols = Object.keys(all[0] ?? ({} as Row)) as (keyof Row)[];
  writeFileSync(
    join(dir, "batch-summary.csv"),
    [cols.join(","), ...all.map((r) => cols.map((c) => csvCell(r[c])).join(","))].join("\n") + "\n",
  );
  console.log(`\nSummary (${all.length} agents in run ${runId})`);
  for (const p of [...new Set(all.map((r) => r.account_profile || "-"))].sort()) {
    const g = all.filter((r) => (r.account_profile || "-") === p);
    const ok = g.filter((r) => r.status === "ok");
    console.log(
      `  ${p.padEnd(14)} ${ok.length}/${g.length} ok  precision ${fmt(mean(ok.map((r) => r.precision)))}  ` +
        `recall ${fmt(mean(ok.map((r) => r.recall)))}  f1 ${fmt(mean(ok.map((r) => r.f1)))}`,
    );
  }
  const tin = all.reduce((s, r) => s + r.input_tokens, 0);
  const tout = all.reduce((s, r) => s + r.output_tokens, 0);
  if (tin + tout)
    console.log(
      `  tokens ${tin} in / ${tout} out, about $${((tin * 1 + tout * 5) / 1e6).toFixed(3)} at Haiku 4.5 rates`,
    );
  console.log(`  details: ${join(dir, "batch-summary.csv")}`);
  if (all.length && all.every((r) => r.status === "failed")) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e.message ?? e);
    process.exitCode = 1;
  })
  .finally(() => pool.end().then(() => process.exit()));
