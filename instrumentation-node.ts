import { startWorkers } from "./jobs/worker";

if (process.env.RUN_JOBS_IN_PROCESS !== "false") {
  startWorkers().catch((e) => console.error("[jobs] failed to start workers", e));
}
