// Saved discovery searches. What is stored is the canonical query string, rebuilt from the parsed filters, so only
// valid filters ever reach the database and the same search always looks the same.
import { and, asc, count, eq, inArray } from "drizzle-orm";
import { creatorSavedSearches, creators, db } from "@/db/client";
import { activeFilterCount, filtersToParams, parseCreatorFilters } from "./filters";
import { whereFor } from "./service";

type Params = Record<string, string | string[] | undefined>;

export const MAX_NAME = 80;

/** The query for a search with the page forgotten (a saved search starts on page one) and everything validated. */
export function canonicalSearch(sp: Params): { query: string; filterCount: number } {
  const f = parseCreatorFilters(sp);
  return {
    query: filtersToParams({ ...f, page: 1 }).toString(),
    filterCount: activeFilterCount(f),
  };
}

export function checkSearchName(
  raw: string,
): { ok: true; name: string } | { ok: false; reason: string } {
  const name = raw.trim().replace(/\s+/g, " ");
  if (!name) return { ok: false, reason: "Give the search a name." };
  if (name.length > MAX_NAME)
    return { ok: false, reason: `Keep the name under ${MAX_NAME} characters.` };
  return { ok: true, name };
}

export const searchHref = (ws: string, query: string) =>
  `/w/${ws}/creators${query ? `?${query}` : ""}`;

export async function accountSavedCount(workspaceIds: string[]) {
  if (!workspaceIds.length) return 0;
  const [r] = await db
    .select({ n: count() })
    .from(creatorSavedSearches)
    .where(inArray(creatorSavedSearches.workspaceId, workspaceIds));
  return r?.n ?? 0;
}

/** The workspace's saved searches, oldest first, each with how many creators match it today. */
export async function workspaceSavedSearches(workspaceId: string) {
  const rows = await db
    .select()
    .from(creatorSavedSearches)
    .where(eq(creatorSavedSearches.workspaceId, workspaceId))
    .orderBy(asc(creatorSavedSearches.createdAt), asc(creatorSavedSearches.name));
  return Promise.all(
    rows.map(async (r) => {
      const f = parseCreatorFilters(Object.fromEntries(new URLSearchParams(r.query)));
      const [n] = await db.select({ n: count() }).from(creators).where(whereFor(f));
      return {
        id: r.id,
        name: r.name,
        query: r.query,
        matches: n?.n ?? 0,
        filterCount: activeFilterCount(f),
      };
    }),
  );
}

export async function findSavedSearch(workspaceId: string, id: string) {
  if (!/^[0-9a-f-]{36}$/.test(id)) return null;
  const [r] = await db
    .select()
    .from(creatorSavedSearches)
    .where(and(eq(creatorSavedSearches.id, id), eq(creatorSavedSearches.workspaceId, workspaceId)));
  return r ?? null;
}
