// Harness-only: creates agent accounts the way the product does (real sign-up, invite acceptance and subscription
// code paths), so what the agents then do in the UI starts from the same data a human team would have.
// It adds nothing to the product's behaviour and no endpoint; run it from the command line (scripts/seed-agents.ts).
import { randomBytes } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { db, invitations, users, workspaces } from "@/db/client";
import { rngFor, type Rng } from "@/datagen/rng";
import { hashToken } from "@/lib/auth/tokens";
import { createAccountAndUser } from "@/lib/auth/signup";
import { subscribe } from "@/lib/billing/service";
import type { PlanTier } from "@/lib/entitlements/plans";
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
}

export interface SeedOptions {
  accounts: number;
  seed: number;
  run: string;
  model?: string;
  plan?: Exclude<PlanTier, "trial" | "enterprise">;
  /** Finish the owner's onboarding wizard in the database. Off by default: the owner agent does it in the UI. */
  onboardOwner?: boolean;
  emailDomain?: string;
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
  const domain = o.emailDomain ?? "agents.example.test";
  const sim = { persona: null as string | null, run: o.run, model: o.model ?? null, clock: null };
  for (let a = 0; a < o.accounts; a++) {
    const r = rngFor(o.seed, "account", a);
    const acc = `acc${String(a + 1).padStart(3, "0")}`;
    const company = `${r.pick(CO_A)} ${r.pick(CO_B)} ${acc}`;
    const region = r.pick(REGIONS);
    const team = [
      ...TEAM,
      ...(r.bool(0.5)
        ? [{ role: "analyst" as const, seniority: "junior" as const, platform: "editor" as Role }]
        : []),
    ];
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
      });
    }
    // A paid plan with room for the whole team, through the same code as the Billing page (test card only).
    const sub = await subscribe({
      accountId,
      tier: o.plan ?? "agency",
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
  }
  return out;
}
