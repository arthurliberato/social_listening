// Runs once when the Next.js server starts. Background job workers boot in-process for dev/e2e;
// in production run `npm run worker` separately and set RUN_JOBS_IN_PROCESS=false.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./instrumentation-node");
  }
}
