// The analyst's policy for a research case: set up a query, read a sample, refine it, correct a few sentiments,
// name the themes, and write up the findings. Content decisions come from the brain; how much effort and how
// carefully comes from the profile; errors are injected by the skill layer and logged (spec 7, 9).
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { hashSeed, Rng } from "../datagen/rng";
import type { Ledger } from "./ledger";
import { degradeQuery, knownOperators, refinementBudget, type Injected } from "./skill";
import type { AgentProfile, Brain, Deliverable, PublicCase, SampleMention } from "./types";
import type { Workspace } from "./workspace";

export interface RunResult {
  queryId: string;
  queryName: string;
  queryText: string;
  initialQueryText: string;
  deliverable: Deliverable;
  rounds: number;
  overridden: { id: number; to: string }[];
  injected: Injected[];
}

export interface RunOptions {
  runId: string;
  /** Test hook: make the weak-query error certain, to exercise the refinement path. */
  forceWeakQuery?: boolean;
  deliverablePath?: string | null;
}

export async function runAnalystCase(o: {
  profile: AgentProfile;
  assignment: PublicCase;
  brain: Brain;
  ws: Workspace;
  ledger: Ledger;
  options: RunOptions;
}): Promise<RunResult> {
  const { profile: p, assignment: c, brain, ws, ledger } = o;
  const rng = new Rng(hashSeed(p.agent_id, o.options.runId));
  const injected: Injected[] = [];
  const log = (e: Parameters<Ledger["record"]>[0]) => {
    if (e.injected_errors) injected.push(...e.injected_errors);
    ledger.record(e);
  };
  const ops = knownOperators(p);
  const name = `${c.id} ${c.monitoring_scope.split(",")[0]}`;

  // 1. Write the search the way this person would.
  const draft = await brain.draftQuery({
    brief: c.brief,
    scope: c.monitoring_scope,
    operators: ops,
  });
  const degraded = degradeQuery(p, draft.text, rng, o.options.forceWeakQuery);
  let text = degraded.text;
  const initialQueryText = text;
  const created = await ws.createQuery(name, text);
  log({
    step: "create_query",
    tool: "create_query",
    intent: draft.rationale,
    injected_errors: degraded.errors,
    observed: { text, preview_count: created.previewCount, noise: created.noise },
  });
  await ws.waitCollected(name);

  // 2. Read a sample, as much of it as this person's habits allow, and judge what is relevant.
  const readN = Math.max(15, Math.round(50 * p.traits.sampling_depth));
  let read = await ws.openMentions(created.queryId, { windowDays: c.window_days, n: readN });
  const judge = async (sample: SampleMention[]) => {
    const j = await brain.judgeRelevance({ scope: c.monitoring_scope, mentions: sample });
    const rel = new Set(j.filter((x) => x.relevant).map((x) => x.id));
    return {
      relevant: sample.filter((m) => rel.has(m.id)),
      irrelevant: sample.filter((m) => !rel.has(m.id)),
    };
  };
  let split = await judge(read.sample);
  log({
    step: "read_sample",
    tool: "open_mentions",
    intent: `read ${read.sample.length} of ${read.total} mentions to check the query finds the right things`,
    observed: { read: read.sample.length, total: read.total, irrelevant: split.irrelevant.length },
  });

  // 3. Refine while the sample is noisy, within this person's patience.
  const budget = refinementBudget(p, rng);
  if (budget.errors.length)
    log({
      step: "refine_budget",
      tool: "decide",
      intent: "how many refinement rounds to do",
      injected_errors: budget.errors,
    });
  const baseText = /\sOR\s/.test(text) ? `(${text})` : text;
  const excluded: string[] = [];
  let rounds = 0;
  while (
    split.irrelevant.length / Math.max(1, read.sample.length) > 0.08 &&
    rounds < budget.rounds
  ) {
    if (!ops.includes("NOT")) {
      log({
        step: "refine",
        tool: "decide",
        intent: "the sample is noisy but excluding words is not something this analyst knows to do",
        observed: { latent_need: "exclusions", workaround: "read past the noise" },
      });
      break;
    }
    const terms = (
      await brain.proposeExclusions({
        scope: c.monitoring_scope,
        irrelevant: split.irrelevant.map((m) => m.text),
        relevant: split.relevant.map((m) => m.text),
      })
    ).filter((t) => !excluded.includes(t));
    if (!terms.length) break;
    excluded.push(...terms);
    text = `${baseText} NOT (${excluded.join(" OR ")})`;
    const preview = await ws.editQuery(created.queryId, text);
    await ws.waitCollected(name);
    read = await ws.openMentions(created.queryId, { windowDays: c.window_days, n: readN });
    split = await judge(read.sample);
    rounds++;
    log({
      step: "refine",
      tool: "edit_query",
      intent: `exclude ${terms.join(", ")}, which only appeared in off-topic mentions`,
      observed: {
        text,
        preview_count: preview.previewCount,
        irrelevant_after: split.irrelevant.length,
        read: read.sample.length,
      },
    });
  }

  // 4. Correct a few sentiment labels the analyst disagrees with.
  const overridden: { id: number; to: string }[] = [];
  const aware =
    p.awareness.sentiment_override === "tried" || p.awareness.sentiment_override === "fluent";
  if (aware && split.relevant.length) {
    const check = split.relevant.slice(0, 12);
    const mine = await brain.judgeSentiment({ mentions: check });
    for (const m of mine) {
      const shown = check.find((x) => x.id === m.id)!.sentiment;
      if (
        m.sentiment !== shown &&
        overridden.length < 5 &&
        rng.bool(p.traits.correction_propensity)
      ) {
        await ws.overrideSentiment(m.id, m.sentiment);
        overridden.push({ id: m.id, to: m.sentiment });
        log({
          step: "override_sentiment",
          tool: "override_sentiment",
          intent: `the label said ${shown}; reading it, it is ${m.sentiment}`,
          observed: { mention_id: m.id },
        });
      }
    }
  }

  // 5. Name the themes.
  const categories: Deliverable["categories"] = [];
  if (p.awareness.tags_and_categories === "tried" || p.awareness.tags_and_categories === "fluent") {
    for (const cat of (
      await brain.proposeCategories({ scope: c.monitoring_scope, mentions: split.relevant })
    ).slice(0, 4)) {
      const n = await ws.createCategory(cat.name, cat.search);
      log({
        step: "create_category",
        tool: "create_category",
        intent: `a theme in the sample: ${cat.name}`,
        observed: { search: cat.search, count: n },
      });
      if (n !== null) categories.push({ name: cat.name, count: n });
    }
  } else {
    log({
      step: "create_category",
      tool: "decide",
      intent: "no categories: not something this analyst knows",
      observed: {
        latent_need: "tags_and_categories",
        workaround: "describe themes in the write-up only",
      },
    });
  }

  // 6. Read the final numbers and write the deliverable.
  const all = await ws.openMentions(created.queryId, { windowDays: c.window_days, n: 50 });
  const neg = await ws.openMentions(created.queryId, {
    windowDays: c.window_days,
    sentiment: "negative",
    n: 5,
  });
  const pos = await ws.openMentions(created.queryId, {
    windowDays: c.window_days,
    sentiment: "positive",
    n: 1,
  });
  const pct = (x: number) => (all.total ? Math.round((100 * x) / all.total) : 0);
  const numbers = {
    total: all.total,
    negative_share: pct(neg.total),
    positive_share: pct(pos.total),
  };
  const deliverable = await brain.writeDeliverable({
    brief: c.brief,
    scope: c.monitoring_scope,
    numbers,
    categories,
    negatives: neg.sample.map((m) => m.text),
  });
  if (o.options.deliverablePath) {
    mkdirSync(dirname(o.options.deliverablePath), { recursive: true });
    writeFileSync(o.options.deliverablePath, renderDeliverable(c, deliverable));
  }
  log({
    step: "deliver",
    tool: "write_deliverable",
    intent: "write up the findings for the requester",
    observed: { numbers },
  });
  return {
    queryId: created.queryId,
    queryName: name,
    queryText: text,
    initialQueryText,
    deliverable,
    rounds,
    overridden,
    injected,
  };
}

export function renderDeliverable(c: PublicCase, d: Deliverable): string {
  return [
    `# ${d.title}`,
    "",
    `Case ${c.id} · for the ${c.requester_role}`,
    "",
    "## Findings",
    ...d.findings.map((f) => `- ${f}`),
    "",
    "## Themes",
    ...(d.categories.length
      ? d.categories.map((x) => `- ${x.name}: ${x.count.toLocaleString()} mentions`)
      : ["- (none named)"]),
    "",
    "## Recommendations",
    ...d.recommendations.map((r) => `- ${r}`),
    "",
    `Numbers: ${d.numbers.total.toLocaleString()} mentions, ${d.numbers.negative_share}% negative, ${d.numbers.positive_share}% positive.`,
    "",
  ].join("\n");
}
