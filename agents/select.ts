// Choosing which agents a batch runs: pure, so it can be tested without a browser or a database.
export interface BatchAgent {
  agent_id: string;
  account_id: string;
  role: string;
  account_profile?: string;
}

export interface Selection {
  /** Explicit agent ids; when given, every other filter is ignored. */
  agents?: string[];
  /** Roles to include (default: analyst, the only role with a case today). */
  roles?: string[];
  /** Account profiles to include (`starter-limit`, `growth`, `agency-low`); agents without a profile are excluded. */
  profiles?: string[];
  /** At most this many agents from any one account (default 1). */
  perAccount?: number;
  /** Shuffle with this seed before capping; without it the manifest order is kept. */
  seed?: number;
  /** Cap on the batch size. */
  count?: number;
}

/** A small deterministic generator (mulberry32). */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function selectAgents<T extends BatchAgent>(all: T[], s: Selection = {}): T[] {
  if (s.agents?.length) {
    const byId = new Map(all.map((a) => [a.agent_id, a]));
    const missing = s.agents.filter((id) => !byId.has(id));
    if (missing.length) throw new Error(`not in the manifest: ${missing.join(", ")}`);
    return s.agents.map((id) => byId.get(id)!);
  }
  const roles = s.roles?.length ? s.roles : ["analyst"];
  let pool = all.filter((a) => roles.includes(a.role));
  if (s.profiles?.length)
    pool = pool.filter((a) => a.account_profile && s.profiles!.includes(a.account_profile));
  const seen = new Map<string, number>();
  const limit = s.perAccount ?? 1;
  pool = pool.filter((a) => {
    const n = seen.get(a.account_id) ?? 0;
    seen.set(a.account_id, n + 1);
    return n < limit;
  });
  if (s.seed !== undefined) {
    const r = rng(s.seed);
    pool = [...pool];
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      [pool[i], pool[j]] = [pool[j]!, pool[i]!];
    }
  }
  return s.count !== undefined ? pool.slice(0, s.count) : pool;
}
