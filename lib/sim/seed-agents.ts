// Harness-only: creates agent accounts the way the product does (real sign-up, invite acceptance and subscription
// code paths), so what the agents then do in the UI starts from the same data a human team would have.
// It adds nothing to the product's behaviour and no endpoint; run it from the command line (scripts/seed-agents.ts).
import { randomBytes } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { db, invitations, queries, users, workspaces } from "@/db/client";
import { runBackfill } from "@/jobs/backfill";
import { rngFor, type Rng } from "@/datagen/rng";
import { hashToken } from "@/lib/auth/tokens";
import { createAccountAndUser } from "@/lib/auth/signup";
import { subscribe } from "@/lib/billing/service";
import type { PlanTier } from "@/lib/entitlements/plans";
import { brandQuery, busiestBrands } from "@/lib/testing/corpus"; // harness-only, like this file
import type { Role } from "@/lib/permissions";
import { simNow } from "@/lib/simclock";

export type AgentRole = "division_leader" | "account_exec" | "strategist" | "analyst";
export type Seniority = "lead" | "senior" | "mid" | "junior";

export interface AgentSeed {
  agent_id: string;
  account_id: string;
  workspace_slug: string;
  email: string;
  password: string;
  name: string;
  role: AgentRole;
  seniority: Seniority;
  /** The product role the agent holds in its workspace. */
  platform_role: Role;
  /** Stored on the user as `persona_archetype`, so every event carries it. */
  persona: string;
  region: string;
  /** Set when the account came from `mix`: its tier profile and the usage it was seeded to show. */
  account_profile?: TierProfile;
  usage_profile?: "at_limits" | "typical" | "low";
}

/**
 * Account tiers for a mixed population. Each is a plan, a team size and how much the account has already used:
 * - starter-limit: the cheapest plan, one seat, all three query slots used, two of them broad enough to fill the
 *   monthly mention allowance (so the quota meter, paywalls and upgrade prompts are in play from day one);
 * - growth: the middle plan with a normal workload of brand queries;
 * - agency-low: the top self-serve plan, barely used (a couple of queries, a small team).
 * Everything is created through the product's own sign-up, subscription and backfill code.
 */
export const TIER_PROFILES = {
  "starter-limit": {
    plan: "starter",
    team: 1,
    brandQueries: [1, 1],
    broadQueries: 2,
    usage: "at_limits",
  },
  growth: { plan: "growth", team: [3, 5], brandQueries: [4, 8], broadQueries: 0, usage: "typical" },
  "agency-low": {
    plan: "agency",
    team: [2, 4],
    brandQueries: [1, 2],
    broadQueries: 0,
    usage: "low",
  },
} as const;
export type TierProfile = keyof typeof TIER_PROFILES;
export const isTierProfile = (s: string): s is TierProfile => s in TIER_PROFILES;

/**
 * Everyday words that appear in many posts, so a query on them matches a large share of the corpus. In the small
 * deployment corpus (`datagen:demo`) the last 30 days hold about 9,400 mentions and these two match about 11,000
 * between them, which is more than a Starter month allows (10,000). Larger corpora reach the cap sooner.
 */
const BROAD_QUERIES = [
  "this OR the OR for OR can OR not OR any OR did OR now",
  "better OR same OR about OR here OR exactly OR relatable OR confirm OR following OR thanks OR interesting OR sharing OR link OR happen OR when OR getting OR still OR with OR price OR their OR place OR good OR than OR skin OR right OR great OR new OR support",
];

export interface SeedOptions {
  accounts: number;
  seed: number;
  run: string;
  model?: string;
  plan?: Exclude<PlanTier, "trial" | "enterprise">;
  /** Finish the owner's onboarding wizard in the database. Off by default: the owner agent does it in the UI. */
  onboardOwner?: boolean;
  /** Give each workspace a live query on one of the corpus's busiest brands, and collect its history. */
  firstQuery?: boolean;
  emailDomain?: string;
  /** Users per account, a number or an inclusive [min, max] range picked per account. Default: the full team of 8-9. */
  teamSize?: number | [number, number];
  /** Accounts per tier profile, in order. Replaces `accounts`, `plan`, `teamSize` and `firstQuery`. */
  mix?: { profile: TierProfile; accounts: number }[];
}

const TEAM: { role: AgentRole; seniority: Seniority; platform: Role }[] = [
  { role: "division_leader", seniority: "lead", platform: "owner" },
  { role: "account_exec", seniority: "senior", platform: "editor" },
  { role: "strategist", seniority: "senior", platform: "editor" },
  { role: "analyst", seniority: "lead", platform: "editor" },
  { role: "analyst", seniority: "senior", platform: "editor" },
  { role: "analyst", seniority: "mid", platform: "editor" },
  { role: "analyst", seniority: "mid", platform: "editor" },
  { role: "analyst", seniority: "junior", platform: "editor" },
];
/** Who joins first when a team is smaller than the full roster: an owner and an analyst, then the rest. */
const SMALL_TEAM_ORDER = [0, 3, 1, 2, 4, 5, 6, 7, 8];
const REGIONS = ["us_east", "us_west", "uk", "de", "br", "in", "au"];
const FIRST = [
  "Ana",
  "Ben",
  "Chloe",
  "Dev",
  "Eli",
  "Fatima",
  "Gus",
  "Hana",
  "Ivo",
  "Jo",
  "Kai",
  "Lena",
];
const LAST = ["Alder", "Brook", "Cole", "Dunn", "Ellis", "Frost", "Gray", "Hale", "Ito", "Joyce"];
const CO_A = ["Northwind", "Harbor", "Lumen", "Cedar", "Ripple", "Atlas", "Bramble", "Quill"];
const CO_B = ["Collective", "Partners", "Studio", "Group", "Works", "Labs"];

const password = (r: Rng) =>
  `${r.pick(CO_A).toLowerCase()}-${r.int(9000) + 1000}-${randomBytes(6).toString("hex")}`;

/** Same seed, same teams (names, roles, regions). Emails and passwords include the run id so runs never collide. */
export async function seedAgents(o: SeedOptions): Promise<AgentSeed[]> {
  const out: AgentSeed[] = [];
  let brands: string[] | undefined;
  const domain = o.emailDomain ?? "agents.example.test";
  const sim = { persona: null as string | null, run: o.run, model: o.model ?? null, clock: null };
  const profiles = o.mix?.flatMap((m) => Array<TierProfile>(m.accounts).fill(m.profile));
  const total = profiles?.length ?? o.accounts;
  for (let a = 0; a < total; a++) {
    const tier = profiles ? TIER_PROFILES[profiles[a]!] : undefined;
    const r = rngFor(o.seed, "account", a);
    const acc = `acc${String(a + 1).padStart(3, "0")}`;
    const company = `${r.pick(CO_A)} ${r.pick(CO_B)} ${acc}`;
    const region = r.pick(REGIONS);
    const full = [
      ...TEAM,
      ...(r.bool(0.5)
        ? [{ role: "analyst" as const, seniority: "junior" as const, platform: "editor" as Role }]
        : []),
    ];
    // Own generator, so the default roster and every later draw for an account stay the same as before.
    const wanted: number | readonly [number, number] | undefined = tier ? tier.team : o.teamSize;
    const [lo, hi] = typeof wanted === "number" || wanted === undefined ? [wanted, wanted] : wanted;
    const size =
      lo === undefined
        ? 0
        : Math.min(full.length, rngFor(o.seed, "team", a).int(hi! - lo + 1) + lo);
    const team = size
      ? SMALL_TEAM_ORDER.map((i) => full[i])
          .filter((t): t is (typeof full)[number] => !!t)
          .slice(0, size)
      : full;
    let accountId = "";
    let slug = "";
    let ownerId = "";
    for (const [i, t] of team.entries()) {
      const id = `${acc}_u${String(i + 1).padStart(2, "0")}`;
      const email = `${o.run}.${id}@${domain}`.toLowerCase();
      const pw = password(r);
      const name = `${r.pick(FIRST)} ${r.pick(LAST)}`;
      const persona = `${t.role}_${t.seniority}`;
      let inviteToken: string | null = null;
      if (i > 0) {
        inviteToken = randomBytes(24).toString("base64url");
        const [ws] = await db.select().from(workspaces).where(eq(workspaces.accountId, accountId));
        await db.insert(invitations).values({
          workspaceId: ws!.id,
          accountId,
          email,
          role: t.platform,
          tokenHash: hashToken(inviteToken),
          invitedBy: ownerId,
          source: "settings",
          expiresAt: new Date(simNow().getTime() + 7 * 86_400_000),
        });
      }
      const res = await createAccountAndUser({
        name,
        email,
        password: pw,
        company,
        inviteToken,
        attribution: { utm_source: "agent_harness" },
        sim: { ...sim, persona },
      });
      if (!res.ok) throw new Error(`could not create ${id}: ${res.error}`);
      const [u] = await db.select().from(users).where(eq(users.id, res.userId));
      if (i === 0) {
        ownerId = res.userId;
        // the account and workspace the sign-up just created
        const m = (
          await db.execute(
            sql`SELECT m.account_id AS a, w.slug AS s FROM memberships m JOIN workspaces w ON w.id = m.workspace_id WHERE m.user_id = ${ownerId}::uuid LIMIT 1`,
          )
        ).rows[0] as { a: string; s: string };
        accountId = m.a;
        slug = m.s;
        await db
          .update(users)
          .set({
            emailVerifiedAt: simNow(),
            ...(o.onboardOwner ? { onboardingCompletedAt: simNow(), roleSelected: "agency" } : {}),
          })
          .where(eq(users.id, ownerId));
      }
      out.push({
        agent_id: id,
        account_id: accountId,
        workspace_slug: slug,
        email: u!.email,
        password: pw,
        name,
        role: t.role,
        seniority: t.seniority,
        platform_role: t.platform,
        persona,
        region,
        ...(tier ? { account_profile: profiles![a]!, usage_profile: tier.usage } : {}),
      });
    }
    // A paid plan with room for the whole team, through the same code as the Billing page (test card only).
    const sub = await subscribe({
      accountId,
      tier: tier?.plan ?? o.plan ?? "agency",
      interval: "monthly",
      card: {
        number: "4242 4242 4242 4242",
        expMonth: 12,
        expYear: simNow().getUTCFullYear() + 2,
        cvc: "123",
        name: company,
      },
    });
    if (!sub.ok) throw new Error(`could not subscribe ${acc}: ${sub.error}`);
    if (tier) {
      brands ??= await busiestBrands(12);
      const [ws] = await db.select().from(workspaces).where(eq(workspaces.accountId, accountId));
      const [bLo, bHi] = tier.brandQueries;
      const qr = rngFor(o.seed, "queries", a); // its own stream: the rest of the account is unaffected
      const nBrand = Math.min(brands.length, qr.int(bHi - bLo + 1) + bLo);
      const shuffled = [...brands];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = qr.int(i + 1);
        [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
      }
      const mine = shuffled.slice(0, nBrand);
      const texts = [
        ...mine.map((b) => ({ name: `${b} (brand)`, text: brandQuery(b) })),
        ...BROAD_QUERIES.slice(0, tier.broadQueries).map((t, i) => ({
          name: `Broad chatter ${i + 1}`,
          text: t,
        })),
      ];
      for (const t of texts) {
        const [q] = await db
          .insert(queries)
          .values({
            workspaceId: ws!.id,
            name: t.name,
            booleanText: t.text,
            status: "live",
            createdBy: ownerId,
          })
          .returning({ id: queries.id });
        await runBackfill(q!.id, ownerId);
      }
    } else if (o.firstQuery) {
      brands ??= await busiestBrands(12);
      const brand = r.pick(brands);
      const [ws] = await db.select().from(workspaces).where(eq(workspaces.accountId, accountId));
      const [q] = await db
        .insert(queries)
        .values({
          workspaceId: ws!.id,
          name: `${brand} (brand)`,
          booleanText: brandQuery(brand),
          status: "live",
          createdBy: ownerId,
        })
        .returning({ id: queries.id });
      await runBackfill(q!.id, ownerId);
    }
  }
  return out;
}
