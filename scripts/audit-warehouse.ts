// Checks the events actually recorded in the Postgres mirror against what BigQuery (through RudderStack) will accept:
// a property that has been sent as two different types for the same event would split into columns or be discarded,
// a property the plan doesn't declare would create an unplanned column, and nothing personal should ever appear.
// Usage: npm run audit:warehouse [-- --since 2026-01-01]   Exits 1 when it finds a problem.
import { pool } from "@/db/client";
import { EVENTS, GLOBAL_PROPERTIES } from "@/lib/analytics/events";

const since = process.argv.includes("--since")
  ? process.argv[process.argv.indexOf("--since") + 1]
  : "1970-01-01";
const PERSONAL_KEY = /(^|_)(e_?mail|first_?name|last_?name|full_?name|phone|address)(_|$)/i;
// Names that match the pattern but are not personal: the kind of email sent, not an address.
const NOT_PERSONAL = new Set(["email_type"]);
const LONG = 1000;

async function main() {
  const problems: string[] = [];
  const note = (s: string) => problems.push(s);
  const declared = new Map(
    Object.entries(EVENTS).map(([n, e]) => [
      n,
      new Set<string>([...GLOBAL_PROPERTIES, ...e.properties]),
    ]),
  );

  const total = (
    await pool.query(
      `SELECT count(*)::int AS n, count(DISTINCT name)::int AS names FROM analytics_events WHERE ts >= $1`,
      [since],
    )
  ).rows[0];
  console.log(`checking ${total.n} events of ${total.names} kinds since ${since}`);

  const kinds = await pool.query(
    `SELECT name, k, array_agg(DISTINCT jsonb_typeof(v)) FILTER (WHERE jsonb_typeof(v) <> 'null') AS types, count(*)::int AS n,
            max(length(v #>> '{}')) FILTER (WHERE jsonb_typeof(v) = 'string') AS longest
       FROM analytics_events, jsonb_each(props) AS e(k, v) WHERE ts >= $1 GROUP BY name, k`,
    [since],
  );
  for (const r of kinds.rows as {
    name: string;
    k: string;
    types: string[] | null;
    n: number;
    longest: number | null;
  }[]) {
    if (!declared.has(r.name)) {
      note(`event "${r.name}" is not in the tracking plan (${r.n} values of ${r.k})`);
      continue;
    }
    if (!declared.get(r.name)!.has(r.k))
      note(`"${r.name}" carries "${r.k}", which the plan does not declare`);
    if (r.types && r.types.length > 1)
      note(`"${r.name}.${r.k}" was sent as more than one type: ${r.types.join(", ")}`);
    if (PERSONAL_KEY.test(r.k) && !NOT_PERSONAL.has(r.k))
      note(`"${r.name}.${r.k}" looks like personal data by its name`);
    if ((r.longest ?? 0) > LONG)
      note(`"${r.name}.${r.k}" has values up to ${r.longest} characters`);
  }
  const emails = await pool.query(
    `SELECT name, k, count(*)::int AS n FROM analytics_events, jsonb_each(props) AS e(k, v)
      WHERE ts >= $1 AND jsonb_typeof(v) = 'string' AND (v #>> '{}') ~ '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[a-z]{2,}' GROUP BY 1, 2`,
    [since],
  );
  for (const r of emails.rows) note(`"${r.name}.${r.k}" holds email-like values (${r.n})`);

  const arrays = await pool.query(
    `SELECT DISTINCT name, k FROM analytics_events, jsonb_each(props) AS e(k, v) WHERE ts >= $1 AND jsonb_typeof(v) IN ('array', 'object')`,
    [since],
  );
  for (const r of arrays.rows)
    console.log(
      `note: "${r.name}.${r.k}" is a list; RudderStack stores it in one column as JSON text`,
    );

  if (problems.length) {
    console.log(`\n${problems.length} problem(s):`);
    for (const p of problems) console.log(` - ${p}`);
    process.exitCode = 1;
  } else
    console.log(
      "\nno problems: types are consistent, every property is declared, nothing personal found",
    );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
