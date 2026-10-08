// What RudderStack's warehouse destination (BigQuery) does with an event, so the tracking plan can be checked against it
// before anything is sent. RudderStack writes each event name to its own table (`creator_invitation_sent`) and each
// property to a column, with names tidied to snake_case; it also keeps its own tables and columns. A property or event
// that collides with one of those, or whose name tidies to the same thing as another, would be merged or discarded
// silently. These rules are conservative on length (63) so they hold for every warehouse RudderStack supports.

export const MAX_NAME = 63;

/** Tables RudderStack creates for itself. An event named like one of these would land in the wrong place. */
export const RESERVED_TABLES = [
  "tracks",
  "identifies",
  "users",
  "pages",
  "screens",
  "groups",
  "aliases",
  "rudder_discards",
  "rudder_staging_files",
];

/** Columns every event table already has. A property with one of these names would overwrite it. */
export const RESERVED_COLUMNS = [
  "id",
  "anonymous_id",
  "user_id",
  "sent_at",
  "timestamp",
  "received_at",
  "original_timestamp",
  "channel",
  "event",
  "event_text",
  "uuid_ts",
  "loaded_at",
];

const snake = (s: string) =>
  s
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();

/** "Creator Invitation Sent" → "creator_invitation_sent". A leading digit gets an underscore. */
export function warehouseTable(event: string): string {
  const t = snake(event);
  return /^[0-9]/.test(t) ? `_${t}` : t;
}

export function warehouseColumn(prop: string): string {
  const c = snake(prop);
  return /^[0-9]/.test(c) ? `_${c}` : c;
}

/** A name BigQuery accepts for a table or column: letters, digits and underscores, starting with a letter or underscore. */
export const isValidIdentifier = (s: string) =>
  /^[a-z_][a-z0-9_]*$/.test(s) && s.length <= MAX_NAME;

export const isReservedColumn = (col: string) =>
  RESERVED_COLUMNS.includes(col) || col.startsWith("context_");

export interface PlanProblem {
  event: string;
  problem: string;
}

/** Everything in the plan that would not survive the trip to the warehouse. An empty list means it will. */
export function checkPlan(
  events: { name: string; properties: readonly string[] }[],
  globals: readonly string[],
): PlanProblem[] {
  const out: PlanProblem[] = [];
  const tables = new Map<string, string>();
  for (const e of events) {
    const table = warehouseTable(e.name);
    if (!isValidIdentifier(table))
      out.push({ event: e.name, problem: `table name "${table}" is not a valid identifier` });
    if (RESERVED_TABLES.includes(table))
      out.push({ event: e.name, problem: `table "${table}" is one RudderStack keeps for itself` });
    const other = tables.get(table);
    if (other) out.push({ event: e.name, problem: `shares the table "${table}" with "${other}"` });
    tables.set(table, e.name);

    const cols = new Map<string, string>();
    for (const p of [...globals, ...e.properties]) {
      const col = warehouseColumn(p);
      if (!isValidIdentifier(col))
        out.push({ event: e.name, problem: `column "${col}" (from "${p}") is not valid` });
      if (isReservedColumn(col))
        out.push({ event: e.name, problem: `"${p}" collides with the reserved column "${col}"` });
      const prev = cols.get(col);
      if (prev && prev !== p)
        out.push({
          event: e.name,
          problem: `"${p}" and "${prev}" become the same column "${col}"`,
        });
      cols.set(col, p);
    }
  }
  return out;
}
