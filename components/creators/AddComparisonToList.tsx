"use client";

import { useState } from "react";
import { addToList } from "@/app/w/[ws]/creators/actions";
import { PaywallModal } from "@/components/listening/PaywallModal";
import { Button } from "@/components/ui/button";
import { rememberList, useLists } from "@/lib/creators/known-lists";
import { PLANS, type PlanTier } from "@/lib/entitlements/plans";
import { useBusy } from "@/lib/use-busy";

const NEW = "new";

/** Puts every creator in the comparison on a list in one step (an existing list, or a new one made on the spot). */
export function AddComparisonToList({
  ws,
  creatorIds,
  lists: serverLists,
  canEdit,
}: {
  ws: string;
  creatorIds: number[];
  lists: { id: string; name: string }[];
  canEdit: boolean;
}) {
  const lists = useLists(serverLists);
  const [choice, setChoice] = useState(serverLists[0]?.id ?? NEW);
  const [newName, setNewName] = useState("");
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [paywall, setPaywall] = useState<{ reason: string; to: PlanTier } | null>(null);
  const [busy, run] = useBusy();
  const p = paywall ? PLANS[paywall.to] : null;
  const n = creatorIds.length;

  return (
    <section
      aria-labelledby="atcl-h"
      className="mt-4 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4"
      data-testid="compare-add-to-list"
    >
      <h2 id="atcl-h" className="text-base font-semibold">
        Add these {n} creators to a list
      </h2>
      {!canEdit ? (
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          Your role can look at creators but not change lists. Ask an editor or admin.
        </p>
      ) : (
        <form
          noValidate
          className="mt-2 flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            run(async () => {
              setError("");
              setMsg("");
              const r = await addToList(ws, {
                listId: choice === NEW ? null : choice,
                newListName: choice === NEW ? newName : undefined,
                creatorIds,
                source: "compare",
              });
              if (!r.ok) {
                if (r.upgradeTo) return setPaywall({ reason: r.error, to: r.upgradeTo });
                return setError(r.error);
              }
              rememberList({ id: r.listId, name: r.listName });
              setChoice(r.listId);
              setNewName("");
              const already = n - r.added;
              setMsg(
                r.added === 0
                  ? `All ${n} were already in ${r.listName}.`
                  : `Added ${r.added} creator${r.added === 1 ? "" : "s"} to ${r.listName}${already ? ` (${already} already there)` : ""}.`,
              );
            });
          }}
        >
          <div className="flex flex-col gap-1">
            <label htmlFor="atcl-list" className="text-xs text-[var(--text-muted)]">
              List
            </label>
            <select
              id="atcl-list"
              value={choice}
              onChange={(e) => setChoice(e.target.value)}
              className="min-h-9 rounded-[var(--radius-input)] border border-[var(--border)] bg-[var(--surface)] px-3 text-sm"
              data-testid="compare-list-select"
            >
              {lists.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
              <option value={NEW}>New list…</option>
            </select>
          </div>
          {choice === NEW && (
            <div className="flex flex-col gap-1">
              <label htmlFor="atcl-name" className="text-xs text-[var(--text-muted)]">
                New list name
              </label>
              <input
                id="atcl-name"
                value={newName}
                maxLength={80}
                onChange={(e) => setNewName(e.target.value)}
                className="min-h-9 w-64 rounded-[var(--radius-input)] border border-[var(--border)] bg-[var(--surface)] px-3 text-sm"
                data-testid="compare-list-name"
              />
            </div>
          )}
          <Button
            type="submit"
            size="sm"
            variant="secondary"
            loading={busy}
            data-testid="compare-list-add"
          >
            Add all to list
          </Button>
        </form>
      )}
      <p
        role="status"
        className="mt-2 text-sm text-[var(--text-muted)]"
        data-testid="compare-list-status"
      >
        {msg}
      </p>
      {error && (
        <p
          role="alert"
          className="mt-1 text-sm text-[var(--danger)]"
          data-testid="compare-list-error"
        >
          {error}
        </p>
      )}
      {paywall && p && (
        <PaywallModal
          trigger="creator_list_limit"
          title="You've reached your creator list limit"
          reason={paywall.reason}
          planLabel={p.label}
          priceLine={p.priceMonthly ? `${p.label} is $${p.priceMonthly}/month.` : undefined}
          bullets={[
            `${p.creatorLists} creator lists`,
            `${p.creatorProfilesPerMonth} new creator profiles per month`,
            "Audience insights and list export",
          ]}
          onClose={() => setPaywall(null)}
        />
      )}
    </section>
  );
}
