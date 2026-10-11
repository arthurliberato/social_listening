"use client";

import Link from "next/link";
import { useState } from "react";
import { deleteSavedSearchAction, saveSearchAction } from "@/app/w/[ws]/creators/search-actions";
import { PaywallModal } from "@/components/listening/PaywallModal";
import { Button } from "@/components/ui/button";
import { track } from "@/lib/analytics/client";
import { PLANS, type PlanTier } from "@/lib/entitlements/plans";
import { useBusy } from "@/lib/use-busy";

export interface SavedItem {
  id: string;
  name: string;
  query: string;
  matches: number;
  filterCount: number;
}

const href = (ws: string, query: string) => `/w/${ws}/creators${query ? `?${query}` : ""}`;

/**
 * Saved searches: apply one with a click, save the current filters under a name, delete the ones you don't need.
 * The list is held here and changes the moment the server confirms, so the panel never waits on a page refresh.
 */
export function SavedSearches({
  ws,
  initial,
  current,
  currentCount,
  currentMatches,
  canEdit,
  limit,
}: {
  ws: string;
  initial: SavedItem[];
  /** The page's filters, as the query-string parameters the server will validate. */
  current: Record<string, string>;
  currentCount: number;
  currentMatches: number;
  canEdit: boolean;
  limit: number;
}) {
  const [items, setItems] = useState(initial);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [paywall, setPaywall] = useState<{ reason: string; to: PlanTier } | null>(null);
  const [busy, run] = useBusy();
  const p = paywall ? PLANS[paywall.to] : null;

  return (
    <section
      aria-labelledby="saved-h"
      className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4"
      data-testid="saved-searches"
    >
      <h2 id="saved-h" className="text-base font-semibold">
        Saved searches
      </h2>
      {items.length === 0 ? (
        <p className="mt-1 text-sm text-[var(--text-muted)]" data-testid="saved-empty">
          Nothing saved yet. Set some filters, then save them to come back with one click.
        </p>
      ) : (
        <ul className="mt-2 flex flex-col gap-1" data-testid="saved-list">
          {items.map((s) => (
            <li
              key={s.id}
              className="flex flex-wrap items-center justify-between gap-2"
              data-testid="saved-item"
            >
              <Link
                href={href(ws, s.query)}
                onClick={() =>
                  track("Saved Search Opened", {
                    saved_search_id: s.id,
                    filter_count: s.filterCount,
                  })
                }
                className="text-sm font-medium text-[var(--primary)] underline underline-offset-2"
                data-testid="saved-link"
              >
                {s.name}
              </Link>
              <span className="flex items-center gap-3 text-sm text-[var(--text-muted)]">
                <span className="tabular-nums" data-testid="saved-matches">
                  {s.matches.toLocaleString("en-US")} creator{s.matches === 1 ? "" : "s"}
                </span>
                {canEdit && (
                  <button
                    type="button"
                    disabled={busy}
                    className="min-h-8 rounded-md px-2 underline disabled:opacity-60"
                    data-testid="saved-delete"
                    onClick={() =>
                      run(async () => {
                        setError("");
                        const r = await deleteSavedSearchAction(ws, s.id);
                        if (!r.ok) return setError(r.error);
                        setItems((xs) => xs.filter((x) => x.id !== s.id));
                        setMsg(`Deleted “${s.name}”.`);
                      })
                    }
                  >
                    Delete<span className="sr-only"> {s.name}</span>
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}

      {canEdit && (
        <form
          noValidate
          aria-label="Save this search"
          className="mt-3 flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            run(async () => {
              setError("");
              setMsg("");
              const r = await saveSearchAction(ws, name, current);
              if (!r.ok) {
                if (r.upgradeTo) return setPaywall({ reason: r.error, to: r.upgradeTo });
                return setError(r.error);
              }
              const query = new URLSearchParams(current).toString();
              setItems((xs) => [
                ...xs,
                {
                  id: r.id,
                  name: name.trim().replace(/\s+/g, " "),
                  query,
                  matches: currentMatches,
                  filterCount: currentCount,
                },
              ]);
              setMsg(`Saved “${name.trim()}”.`);
              setName("");
            });
          }}
        >
          <div className="flex flex-col gap-1">
            <label htmlFor="save-name" className="text-xs text-[var(--text-muted)]">
              Name this search
            </label>
            <input
              id="save-name"
              value={name}
              maxLength={80}
              onChange={(e) => setName(e.target.value)}
              className="min-h-9 w-64 rounded-[var(--radius-input)] border border-[var(--border)] bg-[var(--surface)] px-3 text-sm"
              data-testid="save-name"
            />
          </div>
          <Button
            type="submit"
            size="sm"
            variant="secondary"
            loading={busy}
            data-testid="save-submit"
          >
            Save search
          </Button>
          <span className="text-xs text-[var(--text-muted)]">
            {items.length} of {limit} saved
          </span>
        </form>
      )}
      <p role="status" className="mt-2 text-sm text-[var(--text-muted)]" data-testid="saved-status">
        {msg}
      </p>
      {error && (
        <p role="alert" className="mt-1 text-sm text-[var(--danger)]" data-testid="saved-error">
          {error}
        </p>
      )}
      {paywall && p && (
        <PaywallModal
          trigger="saved_search_limit"
          title="You've used your saved searches"
          reason={paywall.reason}
          planLabel={p.label}
          priceLine={p.priceMonthly ? `${p.label} is $${p.priceMonthly}/month.` : undefined}
          bullets={[
            `${p.savedSearches} saved searches`,
            `Compare up to ${p.compareSize} creators`,
            "Audience insights and list export",
          ]}
          onClose={() => setPaywall(null)}
        />
      )}
    </section>
  );
}
