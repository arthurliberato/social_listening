import { getBoss, QUEUES } from "@/lib/jobs/boss";
import { runBackfill } from "./backfill";
import { runBillingLifecycle } from "@/lib/billing/lifecycle";
import { runDueReports } from "./reports";
import { runReleaseAll } from "./release";

let started = false;

/** Register job handlers. Called from instrumentation (in-process) or `npm run worker`. */
export async function startWorkers() {
  if (started) return;
  started = true;
  const boss = await getBoss();
  await boss.work<{ queryId: string }>(QUEUES.backfill, { localConcurrency: 2 }, async (jobs) => {
    for (const job of jobs) await runBackfill(job.data.queryId);
  });
  // Reveal newly published mentions every 5 minutes (a plan's refresh tier decides what it sees).
  await boss.schedule(QUEUES.release, "*/5 * * * *");
  await boss.work(QUEUES.release, async () => {
    await runReleaseAll();
  });
  // Scheduled reports go out within five minutes of their due time.
  await boss.schedule(QUEUES.reports, "*/5 * * * *");
  await boss.work(QUEUES.reports, async () => {
    await runDueReports();
  });
  // Trial reminders, trial end and lock, renewals, payment retries and cancellations taking effect.
  await boss.schedule(QUEUES.billing, "*/5 * * * *");
  await boss.work(QUEUES.billing, async () => {
    await runBillingLifecycle();
  });
}

if (process.argv[1]?.endsWith("worker.ts")) {
  startWorkers().then(() => console.error("workers running"));
}
