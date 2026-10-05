// Usage: npx tsx scripts/loadtest.ts --manifest agents.json --users 50 --duration 60 [--think 1.5] [--base http://localhost:3000[,http://localhost:3001...]]
// Each virtual user logs in over HTTP as one of the seeded agents (npm run seed:agents -- --onboard-owner --first-query)
// and then browses the heavy pages of its workspace with think time between requests, like an agent session would.
// Prints latency percentiles per route, errors, throughput, and the server's memory. Test environments only.
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

const arg = (k: string, d?: string) => {
  const i = process.argv.indexOf(`--${k}`);
  return i >= 0 ? process.argv[i + 1] : d;
};
// One or more app instances (comma separated); virtual users are spread across them round-robin.
const bases = arg("base", "http://localhost:3000")!.split(",");
const nUsers = Number(arg("users", "20"));
const durationMs = Number(arg("duration", "60")) * 1000;
const think = Number(arg("think", "1.5")) * 1000;
const manifest = JSON.parse(readFileSync(arg("manifest", "agents.json")!, "utf8")) as {
  agents: { email: string; password: string; workspace_slug: string }[];
};

// Page mix by weight: what an analyst opens most.
const ROUTES: { name: string; path: (ws: string) => string; weight: number }[] = [
  { name: "home", path: (w) => `/w/${w}/home`, weight: 2 },
  { name: "mentions", path: (w) => `/w/${w}/mentions`, weight: 4 },
  {
    name: "mentions?filtered",
    path: (w) => `/w/${w}/mentions?sentiment=negative&range=7d`,
    weight: 3,
  },
  {
    name: "mentions?search",
    path: (w) => `/w/${w}/mentions?search=${encodeURIComponent("price OR expensive OR cheap")}`,
    weight: 2,
  },
  { name: "queries", path: (w) => `/w/${w}/queries`, weight: 1 },
  { name: "dashboards", path: (w) => `/w/${w}/dashboards`, weight: 1 },
  { name: "alerts", path: (w) => `/w/${w}/alerts`, weight: 1 },
  { name: "tags", path: (w) => `/w/${w}/tags`, weight: 1 },
  { name: "authors", path: (w) => `/w/${w}/authors`, weight: 1 },
  { name: "topics", path: (w) => `/w/${w}/topics`, weight: 1 },
];
const total = ROUTES.reduce((a, r) => a + r.weight, 0);
const pick = () => {
  let x = Math.random() * total;
  for (const r of ROUTES) if ((x -= r.weight) < 0) return r;
  return ROUTES[0]!;
};

class Jar {
  private c = new Map<string, string>();
  take(res: Response) {
    for (const line of res.headers.getSetCookie()) {
      const [kv] = line.split(";");
      const i = kv!.indexOf("=");
      this.c.set(kv!.slice(0, i), kv!.slice(i + 1));
    }
  }
  header() {
    return [...this.c].map(([k, v]) => `${k}=${v}`).join("; ");
  }
  has(prefix: string) {
    return [...this.c.keys()].some((k) => k.includes(prefix));
  }
}

async function login(base: string, a: { email: string; password: string }, jar: Jar) {
  const csrf = await fetch(`${base}/api/auth/csrf`);
  jar.take(csrf);
  const { csrfToken } = (await csrf.json()) as { csrfToken: string };
  const res = await fetch(`${base}/api/auth/callback/credentials`, {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded", cookie: jar.header() },
    body: new URLSearchParams({
      csrfToken,
      email: a.email,
      password: a.password,
      callbackUrl: `${base}/`,
    }),
  });
  jar.take(res);
  if (!jar.has("session-token")) throw new Error(`login failed (${res.status})`);
}

const lat = new Map<string, number[]>();
const errors: string[] = [];
const statuses = new Map<string, number>();
const loginMs: number[] = [];
const rec = (name: string, ms: number) => (lat.get(name) ?? lat.set(name, []).get(name)!).push(ms);
const pct = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] ?? 0;
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function vu(i: number, until: number) {
  const base = bases[i % bases.length]!;
  const a = manifest.agents[i % manifest.agents.length]!;
  const jar = new Jar();
  const t0 = performance.now();
  try {
    await login(base, a, jar);
  } catch (e) {
    errors.push(`login ${a.email}: ${(e as Error).message}`);
    return;
  }
  loginMs.push(performance.now() - t0);
  await sleep(Math.random() * think); // spread the start
  while (Date.now() < until) {
    const r = pick();
    const t = performance.now();
    try {
      const res = await fetch(`${base}${r.path(a.workspace_slug)}`, {
        redirect: "manual",
        headers: { cookie: jar.header() },
      });
      await res.arrayBuffer();
      const ms = performance.now() - t;
      rec(r.name, ms);
      statuses.set(`${res.status}`, (statuses.get(`${res.status}`) ?? 0) + 1);
      if (res.status >= 400) errors.push(`${r.name} -> ${res.status}`);
      if (res.status >= 300 && res.status < 400)
        errors.push(`${r.name} -> redirect ${res.headers.get("location")}`);
    } catch (e) {
      errors.push(`${r.name}: ${(e as Error).message}`);
    }
    await sleep(think * (0.5 + Math.random()));
  }
}

function rssMb(pattern: string): number {
  try {
    const out = execSync(
      `ps -eo rss,args | grep -E "${pattern}" | grep -v grep | awk '{s+=$1} END {print s+0}'`,
      { encoding: "utf8" },
    );
    return Math.round(Number(out.trim()) / 1024);
  } catch {
    return 0;
  }
}

async function main() {
  if (nUsers > manifest.agents.length)
    console.log(`note: ${nUsers} users share ${manifest.agents.length} seeded logins`);
  const start = Date.now();
  const until = start + durationMs;
  let maxApp = 0;
  let maxPg = 0;
  const sampler = setInterval(() => {
    maxApp = Math.max(maxApp, rssMb("next-server|next start"));
    maxPg = Math.max(maxPg, rssMb("postgres"));
  }, 2000);
  await Promise.all(Array.from({ length: nUsers }, (_, i) => vu(i, until)));
  clearInterval(sampler);
  const secs = (Date.now() - start) / 1000;
  const n = [...lat.values()].reduce((a, v) => a + v.length, 0);
  console.log(
    `\n${nUsers} virtual users, ${secs.toFixed(0)}s, think ${think / 1000}s: ${n} page loads, ${(n / secs).toFixed(1)}/s`,
  );
  console.log(
    `logins: ${loginMs.length}/${nUsers} ok, p50 ${pct(loginMs, 50).toFixed(0)}ms p95 ${pct(loginMs, 95).toFixed(0)}ms`,
  );
  console.log(
    "route".padEnd(20),
    "n".padStart(5),
    "p50".padStart(7),
    "p95".padStart(7),
    "p99".padStart(7),
    "max".padStart(7),
  );
  for (const [name, xs] of [...lat].sort()) {
    console.log(
      name.padEnd(20),
      String(xs.length).padStart(5),
      ...[50, 95, 99, 100].map((p) => pct(xs, p).toFixed(0).padStart(7)),
    );
  }
  console.log("statuses:", Object.fromEntries(statuses));
  console.log(`memory (max RSS): app ${maxApp} MB, postgres ${maxPg} MB`);
  const uniq = new Map<string, number>();
  for (const e of errors) uniq.set(e, (uniq.get(e) ?? 0) + 1);
  console.log(`errors: ${errors.length}`, [...uniq].slice(0, 8));
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
