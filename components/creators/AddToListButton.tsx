"use client";

import { useEffect, useRef, useState } from "react";
import { addToList, removeFromList } from "@/app/w/[ws]/creators/actions";
import { Button } from "@/components/ui/button";
import { PaywallModal } from "@/components/listening/PaywallModal";
import { PLANS, type PlanTier } from "@/lib/entitlements/plans";
import { useBusy } from "@/lib/use-busy";

export interface ListOption {
  id: string;
  name: string;
}

/** "Add to list" for one creator: pick a list (or make one) in a dialog. */
export function AddToListButton({
  ws,
  creatorId,
  creatorName,
  lists,
  inLists,
  canEdit,
  source,
}: {
  ws: string;
  creatorId: number;
  creatorName: string;
  lists: ListOption[];
  inLists: string[];
  canEdit: boolean;
  source: "discovery" | "profile";
}) {
  const dlg = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const [member, setMember] = useState<string[]>(inLists);
  const [choice, setChoice] = useState<string>(lists[0]?.id ?? "new");
  const [newName, setNewName] = useState("");
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [paywall, setPaywall] = useState<{ reason: string; to: PlanTier } | null>(null);
  const [busy, run] = useBusy();

  // The dialog only exists while open: a page of 25 rows would otherwise carry 25 hidden dialogs.
  useEffect(() => {
    if (open) dlg.current?.showModal();
  }, [open]);

  const close = () => {
    setOpen(false);
    setError("");
  };
  const onList = member.length > 0;
  const submit = () =>
    run(async () => {
      setError("");
      const r = await addToList(ws, {
        listId: choice === "new" ? null : choice,
        newListName: choice === "new" ? newName : undefined,
        creatorIds: [creatorId],
        source,
      });
      if (!r.ok) {
        if (r.upgradeTo) {
          close();
          return setPaywall({ reason: r.error, to: r.upgradeTo });
        }
        return setError(r.error);
      }
      setMember((m) => (m.includes(r.listId) ? m : [...m, r.listId]));
      setStatus(
        r.added
          ? `Added ${creatorName} to ${r.listName}.`
          : `${creatorName} is already in ${r.listName}.`,
      );
      close();
    });
  const remove = (listId: string) =>
    run(async () => {
      const r = await removeFromList(ws, listId, creatorId, source);
      if (r.ok) {
        setMember((m) => m.filter((x) => x !== listId));
        setStatus(`Removed ${creatorName} from the list.`);
      } else setError(r.error);
    });

  const p = paywall ? PLANS[paywall.to] : null;
  return (
    <>
      <button
        type="button"
        disabled={!canEdit}
        title={canEdit ? undefined : "Your role can't change lists"}
        onClick={() => setOpen(true)}
        data-testid="add-to-list"
        className="min-h-8 rounded-md border border-[var(--border)] px-3 text-sm hover:bg-[var(--surface-2)] disabled:opacity-60"
      >
        {onList ? `In ${member.length} list${member.length === 1 ? "" : "s"}` : "Add to list"}
        <span className="sr-only"> {creatorName}</span>
      </button>
      <span role="status" className="sr-only" data-testid="add-to-list-status">
        {status}
      </span>
      {open && (
        <dialog
          ref={dlg}
          aria-labelledby={`atl-${creatorId}`}
          onCancel={(e) => {
            e.preventDefault();
            close();
          }}
          className="m-auto w-full max-w-md rounded-[var(--radius-modal)] border border-[var(--border)] bg-[var(--surface)] p-6 text-[var(--text)] backdrop:bg-black/40"
          data-testid="add-to-list-dialog"
        >
          <h2 id={`atl-${creatorId}`} className="text-xl font-semibold">
            Add {creatorName} to a list
          </h2>
          <fieldset className="mt-4">
            <legend className="text-sm font-medium">List</legend>
            <ul className="mt-2 flex flex-col gap-1">
              {lists.map((l) => (
                <li key={l.id} className="flex min-h-9 items-center justify-between gap-2">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name={`list-${creatorId}`}
                      checked={choice === l.id}
                      onChange={() => setChoice(l.id)}
                    />
                    {l.name}
                    {member.includes(l.id) && (
                      <span className="text-xs text-[var(--text-muted)]">(already added)</span>
                    )}
                  </label>
                  {member.includes(l.id) && (
                    <button
                      type="button"
                      onClick={() => remove(l.id)}
                      className="min-h-8 rounded-md px-2 text-xs text-[var(--primary)] underline"
                    >
                      Remove<span className="sr-only"> from {l.name}</span>
                    </button>
                  )}
                </li>
              ))}
              <li className="min-h-9">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name={`list-${creatorId}`}
                    checked={choice === "new"}
                    onChange={() => setChoice("new")}
                  />
                  New list
                </label>
              </li>
            </ul>
          </fieldset>
          {choice === "new" && (
            <div className="mt-2 flex flex-col gap-1">
              <label htmlFor={`nl-${creatorId}`} className="text-sm font-medium">
                List name
              </label>
              <input
                id={`nl-${creatorId}`}
                value={newName}
                maxLength={80}
                onChange={(e) => setNewName(e.target.value)}
                className="min-h-9 rounded-[var(--radius-input)] border border-[var(--border)] bg-[var(--surface)] px-3 text-sm"
                data-testid="new-list-name"
              />
            </div>
          )}
          {error && (
            <p
              role="alert"
              className="mt-3 text-sm text-[var(--danger)]"
              data-testid="add-to-list-error"
            >
              {error}
            </p>
          )}
          <div className="mt-6 flex gap-3">
            <Button onClick={submit} loading={busy} data-testid="add-to-list-confirm">
              Add to list
            </Button>
            <Button variant="secondary" onClick={close}>
              Cancel
            </Button>
          </div>
        </dialog>
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
    </>
  );
}
