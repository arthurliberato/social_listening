import Link from "next/link";
import { notFound } from "next/navigation";
import { AddToListButton } from "@/components/creators/AddToListButton";
import { AudienceBar } from "@/components/creators/AudienceCharts";
import { Avatar } from "@/components/creators/Avatar";
import { LockedPanel, PaywallButton, type LockCopy } from "@/components/creators/Locked";
import { AGE_BANDS } from "@/datagen/creators";
import { trackServer } from "@/lib/analytics/server";
import { requireWorkspace } from "@/lib/auth/session";
import {
  PLATFORM_LABEL,
  SAFETY_LABEL,
  authLabel,
  countryName,
  titleCase,
  usd,
} from "@/lib/creators/labels";
import {
  audienceOf,
  getCreator,
  listsContaining,
  recordProfileView,
  workspaceLists,
} from "@/lib/creators/service";
import { PLANS, planUnlocking } from "@/lib/entitlements/plans";
import { compact } from "@/lib/format";
import { accountPlan, canEdit } from "@/lib/queries";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  return { title: "Creator profile · Ripplewise" };
}

function Stat({ label, value, testId }: { label: string; value: string; testId?: string }) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
      <dt className="text-xs text-[var(--text-muted)]">{label}</dt>
      <dd className="mt-1 text-2xl font-semibold tabular-nums" data-testid={testId}>
        {value}
      </dd>
    </div>
  );
}

export default async function CreatorProfile({
  params,
}: {
  params: Promise<{ ws: string; id: string }>;
}) {
  const { ws: slug, id: rawId } = await params;
  const { user, ws } = await requireWorkspace(slug);
  const creator = await getCreator(Number(rawId));
  if (!creator) notFound();
  const { accountId, tier, plan } = await accountPlan(ws.id);

  const view = await recordProfileView(accountId, tier, creator.id);
  if (!view.allowed) {
    const to =
      (["starter", "growth", "agency", "enterprise"] as const).find(
        (t) => PLANS[t].creatorProfilesPerMonth > plan.creatorProfilesPerMonth,
      ) ?? "enterprise";
    const copy: LockCopy = {
      trigger: "creator_profile_quota",
      title: "You've used this month's creator profiles",
      reason: `Your ${plan.label} plan includes ${view.limit} new creator profiles a month, and you've opened ${view.used}. Profiles you've already opened stay available.`,
      upgradeTo: to,
      bullets: [
        `${PLANS[to].creatorProfilesPerMonth} new creator profiles per month`,
        "Audience insights and list export",
      ],
    };
    return (
      <div className="mx-auto max-w-2xl" data-testid="profile-quota-reached">
        <Link href={`/w/${slug}/creators`} className="text-sm text-[var(--primary)] underline">
          ← Back to discovery
        </Link>
        <h1 className="mt-3 text-[30px] font-semibold leading-[38px]">
          You&apos;ve used this month&apos;s creator profiles
        </h1>
        <p className="mt-2 text-[var(--text-muted)]">
          {copy.reason} The allowance resets next month.
        </p>
        <PaywallButton
          copy={copy}
          testId="profile-quota-upgrade"
          className="mt-4 inline-flex min-h-9 items-center rounded-md bg-[var(--primary)] px-4 text-sm font-medium text-[var(--primary-contrast)]"
        >
          See plans
        </PaywallButton>
      </div>
    );
  }

  const audienceOpen = plan.features.creatorAudience;
  await trackServer(
    "Creator Profile Viewed",
    { userId: user.id, workspaceId: ws.id },
    {
      creator_id: creator.id,
      platform: creator.platform,
      niche: creator.niche,
      audience_locked: !audienceOpen,
      profile_views_used: view.used,
    },
  );

  const [lists, membership] = await Promise.all([
    workspaceLists(ws.id),
    listsContaining(ws.id, [creator.id]),
  ]);
  const aud = audienceOf(creator);
  const unlockTo = planUnlocking("creatorAudience");
  const lock: LockCopy = {
    trigger: "creator_audience",
    title: "Audience insights",
    reason: `Who follows a creator matters as much as how many. Audience demographics and follower quality are part of ${PLANS[unlockTo].label}.`,
    upgradeTo: unlockTo,
    bullets: [
      "Age, gender, country and interests",
      "Fake-follower and sponsored-post rates",
      "Creator list export to CSV",
    ],
  };

  return (
    <div className="mx-auto max-w-5xl">
      <Link href={`/w/${slug}/creators`} className="text-sm text-[var(--primary)] underline">
        ← Back to discovery
      </Link>
      <header className="mt-3 flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          <Avatar name={creator.displayName} seed={creator.avatarSeed} size={64} />
          <div>
            <h1 className="text-[30px] font-semibold leading-[38px]" data-testid="creator-name">
              {creator.displayName}
              {creator.verified && (
                <span className="ml-2 text-sm font-normal text-[var(--text-muted)]">
                  (verified)
                </span>
              )}
            </h1>
            <p className="text-[var(--text-muted)]">
              @{creator.handle} · {PLATFORM_LABEL[creator.platform]} · {titleCase(creator.niche)} ·{" "}
              {countryName(creator.country)}
            </p>
          </div>
        </div>
        <AddToListButton
          ws={slug}
          creatorId={creator.id}
          creatorName={creator.displayName}
          lists={lists.map((l) => ({ id: l.id, name: l.name }))}
          inLists={membership.get(creator.id) ?? []}
          canEdit={canEdit(ws.role)}
          source="profile"
        />
      </header>
      <p className="mt-3 max-w-prose">{creator.bio}</p>
      <p className="mt-2 text-sm text-[var(--text-muted)]">
        Topics: {creator.tags.map(titleCase).join(", ")}
      </p>

      <dl
        className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6"
        aria-label="Key numbers"
      >
        <Stat label="Followers" value={compact(creator.followers)} testId="stat-followers" />
        <Stat label="Engagement rate" value={`${creator.engagementRate.toFixed(2)}%`} />
        <Stat label="Avg. views" value={compact(creator.avgViews)} />
        <Stat label="Posts / week" value={String(creator.postsPerWeek)} />
        <Stat
          label="30-day growth"
          value={`${creator.growth30d > 0 ? "+" : ""}${creator.growth30d}%`}
        />
        <Stat label="Est. rate / post" value={usd(creator.ratePerPostUsd)} />
      </dl>

      <section aria-labelledby="auth-h" className="mt-8" data-testid="authenticity">
        <h2 id="auth-h" className="text-xl font-semibold">
          Authenticity and brand safety
        </h2>
        <dl className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
          <Stat
            label="Authenticity score"
            value={`${creator.authenticityScore} · ${authLabel(creator.authenticityScore)}`}
            testId="auth-score"
          />
          <Stat
            label="Brand safety"
            value={SAFETY_LABEL[creator.brandSafety as keyof typeof SAFETY_LABEL]}
          />
          {audienceOpen ? (
            <Stat
              label="Likely fake followers"
              value={`${creator.fakeFollowerPct}%`}
              testId="fake-pct"
            />
          ) : (
            <div className="rounded-lg border border-dashed border-[var(--border)] p-4">
              <dt className="text-xs text-[var(--text-muted)]">Likely fake followers</dt>
              <dd className="mt-1 text-sm">Included in {PLANS[unlockTo].label}</dd>
            </div>
          )}
        </dl>
        {audienceOpen && (
          <p className="mt-2 text-sm text-[var(--text-muted)]">
            {creator.sponsoredPct}% of recent posts were paid partnerships. Scores are estimated
            from synthetic follower and engagement patterns.
          </p>
        )}
      </section>

      <section aria-labelledby="aud-h" className="mt-8">
        <h2 id="aud-h" className="text-xl font-semibold">
          Audience
        </h2>
        {audienceOpen ? (
          <div className="mt-3 grid grid-cols-1 gap-4 lg:grid-cols-2" data-testid="audience">
            <AudienceBar
              testId="aud-age"
              title="Age"
              rows={AGE_BANDS.map((b) => ({ label: b, value: aud.age[b] }))}
            />
            <AudienceBar
              testId="aud-gender"
              title="Gender"
              rows={[
                { label: "Female", value: aud.gender.female },
                { label: "Male", value: aud.gender.male },
                { label: "Other", value: aud.gender.other },
              ]}
            />
            <AudienceBar
              testId="aud-country"
              title="Top countries"
              rows={aud.countries.map((c) => ({ label: countryName(c.code), value: c.pct }))}
            />
            <AudienceBar
              testId="aud-interests"
              title="Interests"
              rows={aud.interests.map((i) => ({ label: i.name, value: i.pct }))}
            />
          </div>
        ) : (
          <div className="mt-3">
            <LockedPanel
              testId="audience-locked"
              heading="Audience insights are locked"
              blurb="See who follows this creator: age, gender, country and interests, plus how many followers look fake."
              copy={lock}
            />
          </div>
        )}
      </section>
    </div>
  );
}
