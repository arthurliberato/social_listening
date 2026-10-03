import { getBoss, QUEUES } from "@/lib/jobs/boss";
import { runBackfill } from "./backfill";

let started = false;

/** Register job handlers. Called from instrumentation (in-process) or `npm run worker`. */
export async function startWorkers() {
  if (started) return;
  started = true;
  const boss = await getBoss();
  await boss.work<{ queryId: string }>(QUEUES.backfill, { localConcurrency: 2 }, async (jobs) => {
    for (const job of jobs) await runBackfill(job.data.queryId);
  });
}

if (process.argv[1]?.endsWith("worker.ts")) {
  startWorkers().then(() => console.error("workers running"));
}
