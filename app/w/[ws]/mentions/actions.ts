"use server";

import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db, savedViews } from "@/db/client";
import { trackServer } from "@/lib/analytics/server";
import { requireWorkspace } from "@/lib/auth/session";
import { canEdit } from "@/lib/queries";
import { ownedMentionIds } from "@/lib/mentions/feed";
import { readOverrides, writeOverrides, type OverrideState } from "@/lib/mentions/overrides";
import { SENTIMENTS } from "@/lib/mentions/filters";

type Fail = { ok: false; error: string };
export type EditResult = { ok: true; snapshot: OverrideState[]; changed: number } | Fail;

const Ids = z.array(z.number().int().positive()).min(1).max(500);
const TagName = z
  .string()
  .trim()
  .min(1, "Tag names can't be empty")
  .max(30, "Tag names are limited to 30 characters")
  .regex(/^[\p{L}\p{N} _-]+$/u, "Use letters, numbers, spaces, - or _");

async function begin(slug: string, rawIds: unknown) {
  const { user, ws } = await requireWorkspace(slug);
  if (!canEdit(ws.role))
    return {
      fail: { ok: false, error: "Your role can view mentions but not change them." } as Fail,
    };
  const ids = Ids.safeParse(rawIds);
  if (!ids.success)
    return { fail: { ok: false, error: "Select between 1 and 500 mentions." } as Fail };
  const owned = await ownedMentionIds(ws.id, ids.data);
  if (!owned.length)
    return { fail: { ok: false, error: "Those mentions aren't in this workspace." } as Fail };
  const before = await readOverrides(ws.id, owned);
  return { user, ws, owned, before };
}

const meta = (rows: { id: number }[]) => rows.length;

export async function setSentiment(
  slug: string,
  rawIds: unknown,
  sentiment: string | null,
  ctx?: { source_type?: string; lang?: string; from?: string },
): Promise<EditResult> {
  if (sentiment !== null && !(SENTIMENTS as readonly string[]).includes(sentiment))
    return { ok: false, error: "Unknown sentiment." };
  const s = await begin(slug, rawIds);
  if ("fail" in s && s.fail) return s.fail;
  const { user, ws, owned, before } = s as Exclude<typeof s, { fail: Fail }>;
  await writeOverrides(
    ws.id,
    user.id,
    before.map((b) => ({ ...b, sentiment, exists: true })),
  );
  if (owned.length === 1) {
    await trackServer(
      "Mention Sentiment Overridden",
      { userId: user.id, workspaceId: ws.id },
      {
        from_sentiment: ctx?.from,
        to_sentiment: sentiment ?? "predicted",
        source_type: ctx?.source_type,
        lang: ctx?.lang,
      },
    );
  } else {
    await trackServer(
      "Mentions Bulk Action Applied",
      { userId: user.id, workspaceId: ws.id },
      { action: "sentiment", bulk_size: meta(owned.map((id) => ({ id }))) },
    );
  }
  return { ok: true, snapshot: before, changed: owned.length };
}

export async function addTags(
  slug: string,
  rawIds: unknown,
  rawTags: unknown,
): Promise<EditResult> {
  const tags = z.array(TagName).min(1).max(5).safeParse(rawTags);
  if (!tags.success) return { ok: false, error: tags.error.issues[0]!.message };
  const s = await begin(slug, rawIds);
  if ("fail" in s && s.fail) return s.fail;
  const { user, ws, owned, before } = s as Exclude<typeof s, { fail: Fail }>;
  const next = before.map((b) => ({
    ...b,
    tags: [...new Set([...b.tags, ...tags.data])].slice(0, 10),
    exists: true,
  }));
  await writeOverrides(ws.id, user.id, next);
  if (owned.length === 1)
    await trackServer("Mention Tagged", { userId: user.id, workspaceId: ws.id }, {});
  else
    await trackServer(
      "Mentions Bulk Action Applied",
      { userId: user.id, workspaceId: ws.id },
      { action: "tag", bulk_size: owned.length },
    );
  return { ok: true, snapshot: before, changed: owned.length };
}

export async function removeTag(slug: string, rawIds: unknown, tag: string): Promise<EditResult> {
  const s = await begin(slug, rawIds);
  if ("fail" in s && s.fail) return s.fail;
  const { user, ws, owned, before } = s as Exclude<typeof s, { fail: Fail }>;
  await writeOverrides(
    ws.id,
    user.id,
    before.map((b) => ({ ...b, tags: b.tags.filter((t) => t !== tag) })),
  );
  if (owned.length > 1)
    await trackServer(
      "Mentions Bulk Action Applied",
      { userId: user.id, workspaceId: ws.id },
      { action: "untag", bulk_size: owned.length },
    );
  return { ok: true, snapshot: before, changed: owned.length };
}

export async function setFlag(
  slug: string,
  rawIds: unknown,
  flagged: boolean,
): Promise<EditResult> {
  const s = await begin(slug, rawIds);
  if ("fail" in s && s.fail) return s.fail;
  const { user, ws, owned, before } = s as Exclude<typeof s, { fail: Fail }>;
  await writeOverrides(
    ws.id,
    user.id,
    before.map((b) => ({ ...b, flagged, exists: true })),
  );
  if (owned.length === 1)
    await trackServer("Mention Flagged", { userId: user.id, workspaceId: ws.id }, {});
  else
    await trackServer(
      "Mentions Bulk Action Applied",
      { userId: user.id, workspaceId: ws.id },
      { action: flagged ? "flag" : "unflag", bulk_size: owned.length },
    );
  return { ok: true, snapshot: before, changed: owned.length };
}

/** Undo: put back exactly the override states captured before an edit. */
export async function restoreOverrides(
  slug: string,
  snapshot: OverrideState[],
): Promise<{ ok: boolean }> {
  const { user, ws } = await requireWorkspace(slug);
  if (!canEdit(ws.role)) return { ok: false };
  const owned = new Set(
    await ownedMentionIds(
      ws.id,
      snapshot.map((s) => s.id),
    ),
  );
  await writeOverrides(
    ws.id,
    user.id,
    snapshot.filter((s) => owned.has(s.id)),
  );
  return { ok: true };
}

export interface MentionDetail {
  id: number;
  parent: { id: number; text: string; author: string; sentiment: string } | null;
  replies: number;
  matchedQueries: string[];
  entities: string[];
  detectedLogos: string[];
  region: string;
  predicted: string;
  history: string | null;
}

export async function getMentionDetail(slug: string, id: number): Promise<MentionDetail | null> {
  const { ws } = await requireWorkspace(slug);
  if (!(await ownedMentionIds(ws.id, [id])).length) return null;
  const r = await db.execute(sql`
    SELECT m.id, m.parent_id, m.entities, m.detected_logos, m.region, m.sentiment_pred,
           p.text AS parent_text, pa.display_name AS parent_author, p.sentiment_pred AS parent_sentiment,
           (SELECT count(*)::int FROM mentions c WHERE c.parent_id = m.id) AS replies,
           (SELECT coalesce(array_agg(q.name ORDER BY q.name), '{}') FROM query_matches qm JOIN queries q ON q.id = qm.query_id
             WHERE qm.mention_id = m.id AND q.workspace_id = ${ws.id}::uuid) AS matched_queries,
           (SELECT to_char(o.updated_at, 'YYYY-MM-DD HH24:MI') FROM mention_overrides o WHERE o.workspace_id = ${ws.id}::uuid AND o.mention_id = m.id) AS edited_at
    FROM mentions m LEFT JOIN mentions p ON p.id = m.parent_id LEFT JOIN authors pa ON pa.id = p.author_id
    WHERE m.id = ${id}`);
  const x = r.rows[0] as Record<string, unknown> | undefined;
  if (!x) return null;
  return {
    id,
    parent: x.parent_id
      ? {
          id: Number(x.parent_id),
          text: String(x.parent_text ?? ""),
          author: String(x.parent_author ?? ""),
          sentiment: String(x.parent_sentiment ?? "neutral"),
        }
      : null,
    replies: Number(x.replies),
    matchedQueries: (x.matched_queries as string[]) ?? [],
    entities: (x.entities as string[]) ?? [],
    detectedLogos: (x.detected_logos as string[]) ?? [],
    region: String(x.region),
    predicted: String(x.sentiment_pred),
    history: (x.edited_at as string | null) ?? null,
  };
}

/** New matches released since the page loaded (powers "N new mentions — press N to load"). */
export async function countNewMentions(slug: string, loadedAtIso: string): Promise<number> {
  const { ws } = await requireWorkspace(slug);
  const t = new Date(loadedAtIso);
  if (Number.isNaN(t.getTime())) return 0;
  const r = await db.execute(sql`
    SELECT count(DISTINCT qm.mention_id)::int AS n FROM query_matches qm JOIN queries q ON q.id = qm.query_id
    WHERE q.workspace_id = ${ws.id}::uuid AND qm.matched_at > ${t}`);
  return (r.rows[0] as { n: number }).n;
}

export async function listSavedViews(slug: string) {
  const { ws } = await requireWorkspace(slug);
  return db
    .select({ id: savedViews.id, name: savedViews.name, params: savedViews.params })
    .from(savedViews)
    .where(eq(savedViews.workspaceId, ws.id))
    .orderBy(desc(savedViews.createdAt));
}

export async function saveView(
  slug: string,
  name: string,
  params: string,
): Promise<{ ok: true; id: string } | Fail> {
  const { user, ws } = await requireWorkspace(slug);
  if (!canEdit(ws.role)) return { ok: false, error: "Your role can't save views." };
  const n = z.string().trim().min(1, "Give the view a name").max(60).safeParse(name);
  if (!n.success) return { ok: false, error: n.error.issues[0]!.message };
  const clean = new URLSearchParams(params);
  for (const k of ["m", "page"]) clean.delete(k);
  const [row] = await db
    .insert(savedViews)
    .values({
      workspaceId: ws.id,
      name: n.data,
      params: clean.toString().slice(0, 1500),
      createdBy: user.id,
    })
    .returning({ id: savedViews.id });
  await trackServer(
    "Saved View Created",
    { userId: user.id, workspaceId: ws.id },
    {
      filter_count: [...clean.keys()].filter((k) => !["sort", "view", "size", "range"].includes(k))
        .length,
    },
  );
  return { ok: true, id: row!.id };
}

export async function deleteView(slug: string, id: string): Promise<{ ok: boolean }> {
  const { ws } = await requireWorkspace(slug);
  if (!canEdit(ws.role)) return { ok: false };
  await db.delete(savedViews).where(and(eq(savedViews.id, id), eq(savedViews.workspaceId, ws.id)));
  return { ok: true };
}

export async function workspaceTags(slug: string): Promise<string[]> {
  const { ws } = await requireWorkspace(slug);
  const r = await db.execute(
    sql`SELECT t AS tag, count(*)::int AS n FROM mention_overrides o, unnest(o.tags) t WHERE o.workspace_id = ${ws.id}::uuid GROUP BY t ORDER BY n DESC, t LIMIT 50`,
  );
  return (r.rows as { tag: string }[]).map((x) => x.tag);
}
