"use client";

import Link from "next/link";
import { useState } from "react";
import { removeFromList } from "@/app/w/[ws]/creators/actions";
import { Avatar } from "@/components/creators/Avatar";
import { ExportButton } from "@/components/creators/ExportButton";
import { DeleteListButton } from "@/components/creators/ListsPanel";
import type { LockCopy } from "@/components/creators/Locked";
import { PLATFORM_LABEL, authLabel, countryName, titleCase, usd } from "@/lib/creators/labels";
import { compact } from "@/lib/format";
import { useBusy } from "@/lib/use-busy";

export interface ListItem {
  id: number;
  displayName: string;
  handle: string;
  platform: string;
  country: string;
  niche: string;
  followers: number;
  engagementRate: number;
  authenticityScore: number;
  ratePerPostUsd: number;
  avatarSeed: number;
}

/**
 * A list's contents. The page holds the rows itself and drops one the moment the server confirms the removal,
 * rather than waiting for a re-render of the page to arrive.
 */
export function ListView({
  ws,
  listId,
  name,
  initial,
  editable,
  exportUnlocked,
  exportCopy,
}: {
  ws: string;
  listId: string;
  name: string;
  initial: ListItem[];
  editable: boolean;
  exportUnlocked: boolean;
  exportCopy: LockCopy;
}) {
  const [items, setItems] = useState(initial);
  const [error, setError] = useState("");
  const [busy, run] = useBusy();
  return (
    <>
      <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[30px] font-semibold leading-[38px]" data-testid="list-name">
            {name}
          </h1>
          <p className="text-[var(--text-muted)]" data-testid="list-count">
            {items.length} creator{items.length === 1 ? "" : "s"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {items.length > 0 && (
            <ExportButton
              href={`/api/w/${ws}/creators/lists/${listId}/export`}
              unlocked={exportUnlocked}
              copy={exportCopy}
            />
          )}
          {editable && <DeleteListButton ws={ws} listId={listId} name={name} />}
        </div>
      </div>
      {error && (
        <p role="alert" className="mt-3 text-sm text-[var(--danger)]">
          {error}
        </p>
      )}
      {items.length === 0 ? (
        <div
          className="mt-6 rounded-lg border border-dashed border-[var(--border)] p-8 text-center"
          data-testid="list-empty"
        >
          <p className="font-medium">This list is empty.</p>
          <Link
            href={`/w/${ws}/creators`}
            className="mt-2 inline-block text-[var(--primary)] underline"
          >
            Find creators to add
          </Link>
        </div>
      ) : (
        <div className="mt-5 overflow-x-auto">
          <table className="w-full text-left text-sm" data-testid="list-table">
            <caption className="sr-only">Creators in {name}</caption>
            <thead>
              <tr className="border-b border-[var(--border)] text-[var(--text-muted)]">
                {[
                  "Creator",
                  "Niche",
                  "Followers",
                  "Engagement",
                  "Authenticity",
                  "Est. rate / post",
                  "Remove",
                ].map((h) => (
                  <th key={h} scope="col" className="px-2 py-2 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map((c) => (
                <tr key={c.id} className="border-b border-[var(--border)]" data-testid="list-item">
                  <th scope="row" className="px-2 py-2 font-normal">
                    <div className="flex items-center gap-3">
                      <Avatar name={c.displayName} seed={c.avatarSeed} />
                      <div>
                        <Link
                          href={`/w/${ws}/creators/${c.id}`}
                          className="font-medium text-[var(--primary)] underline underline-offset-2"
                        >
                          {c.displayName}
                        </Link>
                        <div className="text-xs text-[var(--text-muted)]">
                          @{c.handle} · {PLATFORM_LABEL[c.platform]} · {countryName(c.country)}
                        </div>
                      </div>
                    </div>
                  </th>
                  <td className="px-2 py-2">{titleCase(c.niche)}</td>
                  <td className="px-2 py-2 tabular-nums">{compact(c.followers)}</td>
                  <td className="px-2 py-2 tabular-nums">{c.engagementRate.toFixed(2)}%</td>
                  <td className="px-2 py-2 tabular-nums">
                    {c.authenticityScore}{" "}
                    <span className="text-xs text-[var(--text-muted)]">
                      {authLabel(c.authenticityScore)}
                    </span>
                  </td>
                  <td className="px-2 py-2 tabular-nums">{usd(c.ratePerPostUsd)}</td>
                  <td className="px-2 py-2">
                    <button
                      type="button"
                      disabled={!editable || busy}
                      title={editable ? undefined : "Your role can't change lists"}
                      onClick={() =>
                        run(async () => {
                          setError("");
                          const r = await removeFromList(ws, listId, c.id, "list");
                          if (!r.ok) return setError(r.error);
                          setItems((xs) => xs.filter((x) => x.id !== c.id));
                        })
                      }
                      data-testid="remove-from-list"
                      className="min-h-8 rounded-md border border-[var(--border)] px-3 text-sm hover:bg-[var(--surface-2)] disabled:opacity-60"
                    >
                      Remove<span className="sr-only"> {c.displayName}</span>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
