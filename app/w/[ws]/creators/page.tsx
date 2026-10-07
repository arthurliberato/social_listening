import Link from "next/link";
import { Avatar } from "@/components/creators/Avatar";
import { AddToListButton } from "@/components/creators/AddToListButton";
import { SearchTracker } from "@/components/creators/SearchTracker";
import { COUNTRIES } from "@/datagen/config";
import { CREATOR_NICHES, CREATOR_PLATFORMS } from "@/datagen/creators";
import { requireWorkspace } from "@/lib/auth/session";
import {
  PAGE_SIZE,
  SORTS,
  SORT_LABEL,
  TIERS,
  activeFilterCount,
  filtersToParams,
  parseCreatorFilters,
} from "@/lib/creators/filters";
import {
  PLATFORM_LABEL,
  SAFETY_LABEL,
  authLabel,
  countryName,
  titleCase,
  usd,
} from "@/lib/creators/labels";
import {
  listsContaining,
  profileViewUsage,
  searchCreators,
  workspaceLists,
} from "@/lib/creators/service";
import { compact } from "@/lib/format";
import { accountPlan, canEdit } from "@/lib/queries";

export const metadata = { title: "Discover creators · Ripplewise" };
export const dynamic = "force-dynamic";

const TIER_LABEL = {
  nano: "Nano (under 10K)",
  micro: "Micro (10K–100K)",
  mid: "Mid (100K–500K)",
  macro: "Macro (500K–1M)",
  mega: "Mega (1M+)",
};

const box =
  "min-h-9 rounded-[var(--radius-input)] border border-[var(--border)] bg-[var(--surface)] px-2 text-sm";

function CheckGroup({
  legend,
  name,
  options,
  selected,
}: {
  legend: string;
  name: string;
  options: { value: string; label: string }[];
  selected: string[];
}) {
  return (
    <fieldset className="min-w-40">
      <legend className="text-xs font-medium text-[var(--text-muted)]">{legend}</legend>
      <ul className="mt-1 flex flex-col">
        {options.map((o) => (
          <li key={o.value}>
            <label className="flex min-h-7 items-center gap-2 text-sm">
              <input
                type="checkbox"
                name={name}
                value={o.value}
                defaultChecked={selected.includes(o.value)}
              />
              {o.label}
            </label>
          </li>
        ))}
      </ul>
    </fieldset>
  );
}

export default async function DiscoverPage({
  params,
  searchParams,
}: {
  params: Promise<{ ws: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { ws: slug } = await params;
  const sp = await searchParams;
  const { ws } = await requireWorkspace(slug);
  const f = parseCreatorFilters(sp);
  const { accountId, tier } = await accountPlan(ws.id);
  const [{ rows, total, pages }, lists, usage] = await Promise.all([
    searchCreators(f),
    workspaceLists(ws.id),
    profileViewUsage(accountId, tier),
  ]);
  const membership = await listsContaining(
    ws.id,
    rows.map((r) => r.id),
  );
  const editable = canEdit(ws.role);
  const filterCount = activeFilterCount(f);
  const pageHref = (p: number) => {
    const q = filtersToParams({ ...f, page: p }).toString();
    return `/w/${slug}/creators${q ? `?${q}` : ""}`;
  };
  const countries = [...COUNTRIES].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="mx-auto max-w-7xl">
      <SearchTracker
        resultCount={total}
        filterCount={filterCount}
        sort={f.sort}
        hasQuery={!!f.q}
        page={f.page}
      />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[30px] font-semibold leading-[38px]">Discover creators</h1>
          <p className="mt-1 text-[var(--text-muted)]">
            Search the creator directory, check who&apos;s real, and shortlist who to work with.
          </p>
        </div>
        <p className="text-sm text-[var(--text-muted)]" data-testid="profile-quota">
          {usage.used} of {usage.limit} new creator profiles opened this month
        </p>
      </div>

      <form
        method="get"
        className="mt-5 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4"
        role="search"
        aria-label="Find creators"
        data-testid="creator-filters"
      >
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex min-w-60 flex-1 flex-col gap-1">
            <label htmlFor="c-q" className="text-xs font-medium text-[var(--text-muted)]">
              Name, handle or topic
            </label>
            <input
              id="c-q"
              name="q"
              type="search"
              defaultValue={f.q}
              maxLength={80}
              className={box}
              data-testid="creator-search"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="c-sort" className="text-xs font-medium text-[var(--text-muted)]">
              Sort by
            </label>
            <select id="c-sort" name="sort" defaultValue={f.sort} className={box}>
              {SORTS.map((s) => (
                <option key={s} value={s}>
                  {SORT_LABEL[s]}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="c-eng" className="text-xs font-medium text-[var(--text-muted)]">
              Min. engagement %
            </label>
            <input
              id="c-eng"
              name="eng"
              type="number"
              min={0}
              max={100}
              step={0.1}
              defaultValue={f.minEngagement ?? ""}
              className={`${box} w-28`}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="c-auth" className="text-xs font-medium text-[var(--text-muted)]">
              Min. authenticity
            </label>
            <input
              id="c-auth"
              name="auth"
              type="number"
              min={0}
              max={100}
              step={1}
              defaultValue={f.minAuthenticity ?? ""}
              className={`${box} w-28`}
            />
          </div>
        </div>
        <details className="mt-3" open={filterCount > (f.q ? 1 : 0)}>
          <summary className="min-h-8 cursor-pointer text-sm font-medium">More filters</summary>
          <div className="mt-3 flex flex-wrap gap-x-8 gap-y-4">
            <CheckGroup
              legend="Platform"
              name="platform"
              selected={f.platforms}
              options={CREATOR_PLATFORMS.map((p) => ({ value: p, label: PLATFORM_LABEL[p]! }))}
            />
            <CheckGroup
              legend="Audience size"
              name="tier"
              selected={f.tiers}
              options={TIERS.map((t) => ({ value: t, label: TIER_LABEL[t] }))}
            />
            <CheckGroup
              legend="Niche"
              name="niche"
              selected={f.niches}
              options={CREATOR_NICHES.map((n) => ({ value: n, label: titleCase(n) }))}
            />
            <div className="flex flex-col gap-1">
              <label htmlFor="c-country" className="text-xs font-medium text-[var(--text-muted)]">
                Country
              </label>
              <select
                id="c-country"
                name="country"
                defaultValue={f.countries[0] ?? ""}
                className={box}
              >
                <option value="">Any country</option>
                {countries.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.name}
                  </option>
                ))}
              </select>
              <label className="mt-3 flex min-h-8 items-center gap-2 text-sm">
                <input type="checkbox" name="safe" value="1" defaultChecked={f.safeOnly} />
                Brand-safe only
              </label>
            </div>
          </div>
        </details>
        <div className="mt-4 flex items-center gap-3">
          <button
            type="submit"
            className="inline-flex min-h-9 items-center rounded-md bg-[var(--primary)] px-4 text-sm font-medium text-[var(--primary-contrast)]"
            data-testid="creator-apply"
          >
            Search
          </button>
          {filterCount > 0 && (
            <Link
              href={`/w/${slug}/creators`}
              className="text-sm text-[var(--primary)] underline"
              data-testid="creator-clear"
            >
              Clear all filters
            </Link>
          )}
        </div>
      </form>

      <p
        className="mt-5 text-sm text-[var(--text-muted)]"
        role="status"
        data-testid="creator-count"
      >
        {total.toLocaleString("en-US")} creator{total === 1 ? "" : "s"}
        {filterCount ? " match your filters" : " in the directory"}
      </p>

      {rows.length === 0 ? (
        <div
          className="mt-4 rounded-lg border border-dashed border-[var(--border)] p-8 text-center"
          data-testid="creators-empty"
        >
          <p className="font-medium">No creators match these filters.</p>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            Try fewer filters, a lower authenticity or engagement minimum, or a broader audience
            size.
          </p>
          <Link
            href={`/w/${slug}/creators`}
            className="mt-3 inline-block text-[var(--primary)] underline"
          >
            Clear all filters
          </Link>
        </div>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-sm" data-testid="creators-table">
            <caption className="sr-only">
              Creators sorted by {SORT_LABEL[f.sort].toLowerCase()}, page {f.page} of {pages}
            </caption>
            <thead>
              <tr className="border-b border-[var(--border)] text-[var(--text-muted)]">
                {[
                  "Creator",
                  "Niche",
                  "Followers",
                  "Engagement",
                  "Avg. views",
                  "Authenticity",
                  "Brand safety",
                  "Est. rate / post",
                  "Shortlist",
                ].map((h) => (
                  <th key={h} scope="col" className="px-2 py-2 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr
                  key={c.id}
                  className="border-b border-[var(--border)]"
                  data-testid="creator-row"
                >
                  <th scope="row" className="px-2 py-2 font-normal">
                    <div className="flex items-center gap-3">
                      <Avatar name={c.displayName} seed={c.avatarSeed} />
                      <div>
                        <Link
                          href={`/w/${slug}/creators/${c.id}`}
                          className="font-medium text-[var(--primary)] underline underline-offset-2"
                          data-testid="creator-link"
                        >
                          {c.displayName}
                        </Link>
                        {c.verified && (
                          <span className="ml-1 text-xs text-[var(--text-muted)]">(verified)</span>
                        )}
                        <div className="text-xs text-[var(--text-muted)]">
                          @{c.handle} · {PLATFORM_LABEL[c.platform]} · {countryName(c.country)}
                        </div>
                      </div>
                    </div>
                  </th>
                  <td className="px-2 py-2">{titleCase(c.niche)}</td>
                  <td className="px-2 py-2 tabular-nums">{compact(c.followers)}</td>
                  <td className="px-2 py-2 tabular-nums">{c.engagementRate.toFixed(2)}%</td>
                  <td className="px-2 py-2 tabular-nums">{compact(c.avgViews)}</td>
                  <td className="px-2 py-2 tabular-nums" data-testid="creator-auth">
                    {c.authenticityScore}{" "}
                    <span className="text-xs text-[var(--text-muted)]">
                      {authLabel(c.authenticityScore)}
                    </span>
                  </td>
                  <td className="px-2 py-2">
                    {SAFETY_LABEL[c.brandSafety as keyof typeof SAFETY_LABEL]}
                  </td>
                  <td className="px-2 py-2 tabular-nums">{usd(c.ratePerPostUsd)}</td>
                  <td className="px-2 py-2">
                    <AddToListButton
                      ws={slug}
                      creatorId={c.id}
                      creatorName={c.displayName}
                      lists={lists.map((l) => ({ id: l.id, name: l.name }))}
                      inLists={membership.get(c.id) ?? []}
                      canEdit={editable}
                      source="discovery"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pages > 1 && (
        <nav
          aria-label="Pagination"
          className="mt-4 flex items-center justify-between text-sm"
          data-testid="creator-pagination"
        >
          {f.page > 1 ? (
            <Link
              href={pageHref(f.page - 1)}
              rel="prev"
              className="inline-flex min-h-9 items-center rounded-md border border-[var(--border)] px-3"
            >
              Previous
            </Link>
          ) : (
            <span />
          )}
          <span className="text-[var(--text-muted)]">
            Page {f.page} of {pages.toLocaleString("en-US")} · {PAGE_SIZE} per page
          </span>
          {f.page < pages ? (
            <Link
              href={pageHref(f.page + 1)}
              rel="next"
              className="inline-flex min-h-9 items-center rounded-md border border-[var(--border)] px-3"
              data-testid="creator-next"
            >
              Next
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}
    </div>
  );
}
