import { sql } from "drizzle-orm";
import { db } from "@/db/client";

export interface OverrideState {
  id: number;
  /** null = no override row (classifier value applies) */
  sentiment: string | null;
  tags: string[];
  flagged: boolean;
  exists: boolean;
}

export async function readOverrides(workspaceId: string, ids: number[]): Promise<OverrideState[]> {
  if (!ids.length) return [];
  const r = await db.execute(sql`
    SELECT m.id, o.sentiment, coalesce(o.tags, '{}') AS tags, coalesce(o.flagged, false) AS flagged, (o.mention_id IS NOT NULL) AS exists
    FROM mentions m LEFT JOIN mention_overrides o ON o.workspace_id = ${workspaceId}::uuid AND o.mention_id = m.id
    WHERE m.id IN (${sql.join(
      ids.map((i) => sql`${i}`),
      sql`, `,
    )})`);
  return (r.rows as Record<string, unknown>[]).map((x) => ({
    id: Number(x.id),
    sentiment: (x.sentiment as string | null) ?? null,
    tags: (x.tags as string[]) ?? [],
    flagged: Boolean(x.flagged),
    exists: Boolean(x.exists),
  }));
}

/** Write full override states (used by every edit and by Undo). Only touches mention_overrides. */
export async function writeOverrides(workspaceId: string, userId: string, states: OverrideState[]) {
  for (const s of states) {
    if (!s.exists && s.sentiment === null && s.tags.length === 0 && !s.flagged) {
      await db.execute(
        sql`DELETE FROM mention_overrides WHERE workspace_id = ${workspaceId}::uuid AND mention_id = ${s.id}`,
      );
      continue;
    }
    await db.execute(sql`
      INSERT INTO mention_overrides (workspace_id, mention_id, sentiment, tags, flagged, updated_by, updated_at)
      VALUES (${workspaceId}::uuid, ${s.id}, ${s.sentiment}, ${sql`ARRAY[${sql.join(
        s.tags.map((t) => sql`${t}`),
        sql`, `,
      )}]::text[]`}, ${s.flagged}, ${userId}::uuid, now())
      ON CONFLICT (workspace_id, mention_id) DO UPDATE
        SET sentiment = excluded.sentiment, tags = excluded.tags, flagged = excluded.flagged, updated_by = excluded.updated_by, updated_at = now()`);
  }
}
