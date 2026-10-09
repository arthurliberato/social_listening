// A brain that needs no model: plain rules with the judgement of a reasonably careful analyst. It makes the whole
// pipeline runnable and testable offline, and is the baseline the Claude brain is compared against.
import type { Brain, Deliverable } from "../types";

const STOP = new Set(
  "the and for with that this from have has had were was are but not you your our their about into over also more most very just like than then them they what when where which while will would could should been being its it's".split(
    " ",
  ),
);
const words = (t: string) =>
  t
    .toLowerCase()
    .match(/[a-zà-ÿ']{3,}/g)
    ?.filter((w) => !STOP.has(w)) ?? [];

const POS = [
  "love",
  "loving",
  "great",
  "amazing",
  "best",
  "fantastic",
  "recommend",
  "enjoy",
  "delicious",
  "excellent",
  "perfect",
  "good",
  "happy",
  "🔥",
  "💯",
  "👍",
];
const NEG = [
  "terrible",
  "broke",
  "let me down",
  "worst",
  "awful",
  "disappointed",
  "disappointing",
  "never again",
  "rude",
  "slow",
  "zero support",
  "bad",
  "angry",
  "scam",
  "👎",
  "criticism",
];

export const FAMILIES: { name: string; terms: string[] }[] = [
  {
    name: "Price and value",
    terms: ["price", "expensive", "cheap", "cost", "pricey", "worth", "deal"],
  },
  {
    name: "Service and support",
    terms: ["service", "support", "queue", "staff", "barista", "wait"],
  },
  {
    name: "Product quality",
    terms: ["taste", "flavor", "flavour", "brew", "roast", "quality", "beans"],
  },
  { name: "Delivery and orders", terms: ["delivery", "shipping", "order", "late", "package"] },
  {
    name: "News and company",
    terms: ["reports", "results", "announces", "responds", "launch", "quarterly"],
  },
];

export class ScriptedBrain implements Brain {
  readonly name = "scripted";
  readonly model = null;

  async draftQuery(i: Parameters<Brain["draftQuery"]>[0]) {
    const brand =
      /([A-Z][\w']+(?: [A-Z][\w']+)+)/.exec(i.scope)?.[1] ??
      /([A-Z][\w']+)/.exec(i.scope)?.[1] ??
      i.scope.split(/\s+/)[0]!;
    // The brief says how people also write the name ("also write just Juniper"): cover it, as a careful analyst would.
    const short = /also (?:write|say|call it) (?:just )?"?([A-Za-z][\w']+)/i.exec(i.scope)?.[1];
    if (short && short.toLowerCase() !== brand.toLowerCase())
      return {
        text: `"${brand}" OR ${short.toLowerCase()}`,
        rationale: `the exact name "${brand}" and the short form "${short}" the brief says people use`,
      };
    return { text: `"${brand}"`, rationale: `the exact brand name, "${brand}", in quotes` };
  }

  async judgeRelevance(i: Parameters<Brain["judgeRelevance"]>[0]) {
    const brand = (/([A-Z][\w']+(?: [A-Z][\w']+)+)/.exec(i.scope)?.[1] ?? "").toLowerCase();
    const first = brand.split(" ")[0] ?? "";
    const domain = words(i.scope).filter((w) => !brand.includes(w));
    const cues = new Set([
      ...domain,
      "service",
      "support",
      "queue",
      "taste",
      "price",
      "cup",
      "brew",
      "order",
      "delivery",
      "staff",
    ]);
    return i.mentions.map((m) => {
      const t = m.text.toLowerCase();
      const relevant =
        (brand && t.includes(brand)) ||
        (first && t.includes(first) && words(t).some((w) => cues.has(w)));
      return { id: m.id, relevant: Boolean(relevant) };
    });
  }

  async proposeExclusions(i: Parameters<Brain["proposeExclusions"]>[0]) {
    const count = (xs: string[]) => {
      const c = new Map<string, number>();
      for (const x of xs) for (const w of new Set(words(x))) c.set(w, (c.get(w) ?? 0) + 1);
      return c;
    };
    const bad = count(i.irrelevant);
    const good = count(i.relevant);
    return [...bad]
      .filter(([w, n]) => n >= 2 && (good.get(w) ?? 0) === 0 && w.length > 3)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 4)
      .map(([w]) => w);
  }

  async judgeSentiment(i: Parameters<Brain["judgeSentiment"]>[0]) {
    return i.mentions.map((m) => {
      const t = m.text.toLowerCase();
      const pos = POS.filter((w) => t.includes(w)).length;
      const neg = NEG.filter((w) => t.includes(w)).length;
      return {
        id: m.id,
        sentiment:
          neg > pos
            ? ("negative" as const)
            : pos > neg
              ? ("positive" as const)
              : ("neutral" as const),
      };
    });
  }

  async proposeCategories(i: Parameters<Brain["proposeCategories"]>[0]) {
    // Words inside the brand's own name ("Roast" in Juniper Roast) say nothing about a theme: leave them out.
    const own = new Set(words(i.scope.split(",")[0] ?? ""));
    return FAMILIES.map((f) => ({ ...f, terms: f.terms.filter((t) => !own.has(t)) }))
      .filter(
        (f) =>
          i.mentions.filter((m) => f.terms.some((t) => m.text.toLowerCase().includes(t))).length >=
          3,
      )
      .map((f) => ({ name: f.name, search: f.terms.slice(0, 5).join(" OR ") }));
  }

  async writeDeliverable(i: Parameters<Brain["writeDeliverable"]>[0]): Promise<Deliverable> {
    const { total, negative_share, positive_share } = i.numbers;
    const tone =
      negative_share > 40
        ? "mostly negative"
        : negative_share > 25
          ? "mixed, leaning negative"
          : "mostly positive or neutral";
    const top = [...i.categories].sort((a, b) => b.count - a.count).slice(0, 3);
    return {
      title: `${i.scope.split(",")[0]}: what people are saying`,
      findings: [
        `${total.toLocaleString()} mentions in the period; sentiment is ${tone} (${negative_share}% negative, ${positive_share}% positive).`,
        ...top.map((c) => `${c.name} is a main theme, with ${c.count.toLocaleString()} mentions.`),
        ...(i.negatives[0] ? [`A typical complaint: "${i.negatives[0].slice(0, 140)}"`] : []),
      ],
      recommendations: [
        negative_share > 25
          ? "Acknowledge the main complaints publicly and say what is being done."
          : "Keep doing what is working and reinforce it in the next campaign.",
        top[0]
          ? `Prioritise ${top[0].name.toLowerCase()} in the client conversation, since it drives the most discussion.`
          : "Review the themes again next week.",
        "Set up an alert on negative sentiment so changes are caught within the hour.",
      ],
      numbers: i.numbers,
      categories: i.categories,
    };
  }
}
