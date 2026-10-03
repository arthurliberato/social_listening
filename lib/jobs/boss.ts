import { PgBoss } from "pg-boss";

export const QUEUES = { backfill: "backfill", release: "release", reports: "reports" } as const;

const g = globalThis as unknown as { __boss?: Promise<PgBoss> };

/** Shared pg-boss instance (jobs are stored in Postgres; no extra infrastructure). */
export function getBoss(): Promise<PgBoss> {
  g.__boss ??= (async () => {
    const boss = new PgBoss(
      process.env.DATABASE_URL ?? "postgres://ripplewise:ripplewise@localhost:5432/ripplewise",
    );
    boss.on("error", (e) => console.error("[pg-boss]", e));
    await boss.start();
    for (const q of Object.values(QUEUES)) await boss.createQueue(q);
    return boss;
  })();
  return g.__boss;
}

export async function enqueueBackfill(queryId: string) {
  const boss = await getBoss();
  // singletonKey collapses duplicate requests while one is already queued.
  await boss.send(QUEUES.backfill, { queryId }, { singletonKey: queryId, retryLimit: 2 });
}
