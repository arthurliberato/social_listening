"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  archiveWorkspaceAction,
  createWorkspaceAction,
  renameWorkspaceAction,
  restoreWorkspaceAction,
} from "@/app/settings/team/actions";
import { PaywallModal, type PaywallProps } from "@/components/listening/PaywallModal";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { PLANS, type PlanTier } from "@/lib/entitlements/plans";
import { ROLE_LABEL, type Role } from "@/lib/permissions";

export interface WsView {
  id: string;
  slug: string;
  name: string;
  role: Role;
  type: string;
  archived: boolean;
  canManage: boolean;
}

const sel =
  "min-h-9 rounded-[var(--radius-input)] border border-[var(--border)] bg-[var(--surface)] px-3 text-sm";

export function WorkspacesPanel({
  from,
  workspaces,
  used,
  limit,
  upgradeTo,
  canCreate,
}: {
  from: string;
  workspaces: WsView[];
  used: number;
  limit: number;
  upgradeTo: PlanTier | null;
  canCreate: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [name, setName] = useState("");
  const [type, setType] = useState<"own_brand" | "client">("client");
  const [copy, setCopy] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [confirm, setConfirm] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [paywall, setPaywall] = useState<PaywallProps | null>(null);
  const active = workspaces.filter((w) => !w.archived);
  const archived = workspaces.filter((w) => w.archived);
  const atLimit = used >= limit;

  const openPaywall = (to: PlanTier) => {
    const p = PLANS[to];
    setPaywall({
      trigger: "workspace_limit",
      title: "You've reached your workspace limit",
      reason: `You're using ${used} of ${limit} workspaces on your plan. Archive one you don't need, or upgrade.`,
      planLabel: p.label,
      priceLine: p.priceMonthly ? `${p.label} is $${p.priceMonthly}/month.` : undefined,
      bullets: [
        `${p.workspaces.toLocaleString()} workspaces`,
        p.features.whiteLabel ? "White-label for client work" : "More teammates",
        `${p.seats} seats`,
      ],
      onClose: () => setPaywall(null),
    });
  };

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (atLimit && upgradeTo) return openPaywall(upgradeTo);
    setBusy("create");
    const r = await createWorkspaceAction(from, { name, type, copyFrom: copy || null });
    setBusy(null);
    if (!r.ok) {
      if (r.upgradeTo) return openPaywall(r.upgradeTo);
      return setError(r.error);
    }
    toast.success(`${name.trim()} created.`);
    router.push(`/w/${r.slug}/home`);
  };
  const run = async (
    key: string,
    fn: () => Promise<{ ok: boolean; error?: string; upgradeTo?: PlanTier }>,
    ok: string,
  ) => {
    setBusy(key);
    setError("");
    const r = await fn();
    setBusy(null);
    setConfirm(null);
    setEditing(null);
    if (!r.ok) {
      if (r.upgradeTo) return openPaywall(r.upgradeTo);
      return setError(r.error ?? "That didn't work.");
    }
    toast.success(ok);
    router.refresh();
  };

  return (
    <div className="flex flex-col gap-8">
      {paywall && <PaywallModal {...paywall} />}
      <p className="text-sm" data-testid="workspace-usage">
        <strong>
          {used} of {limit}
        </strong>{" "}
        workspaces in use.
      </p>
      {error && (
        <p
          role="alert"
          className="rounded-md border border-[var(--danger)] p-3 text-sm text-[var(--danger)]"
          data-testid="workspaces-error"
        >
          {error}
        </p>
      )}

      <section aria-labelledby="ws-h">
        <h2 id="ws-h" className="text-lg font-semibold">
          Your workspaces
        </h2>
        <ul className="mt-3 flex flex-col gap-2" data-testid="workspace-list">
          {active.map((w) => (
            <li
              key={w.id}
              className="flex flex-wrap items-center gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3"
              data-testid="workspace-row"
            >
              {editing === w.slug ? (
                <form
                  className="flex flex-wrap items-end gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    run(`rn-${w.slug}`, () => renameWorkspaceAction(w.slug, draft), "Renamed.");
                  }}
                >
                  <Field
                    label="Workspace name"
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    maxLength={80}
                    data-testid="rename-input"
                  />
                  <Button
                    type="submit"
                    size="sm"
                    loading={busy === `rn-${w.slug}`}
                    data-testid="rename-save"
                  >
                    Save
                  </Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(null)}>
                    Cancel
                  </Button>
                </form>
              ) : (
                <>
                  <span className="font-medium" data-testid="workspace-name-cell">
                    {w.name}
                  </span>
                  <span className="text-sm text-[var(--text-muted)]">
                    {w.type === "client" ? "Client" : "Own brand"} · you&apos;re{" "}
                    {ROLE_LABEL[w.role].toLowerCase()}
                  </span>
                  {w.canManage && (
                    <span className="ml-auto flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                          setEditing(w.slug);
                          setDraft(w.name);
                        }}
                        aria-label={`Rename ${w.name}`}
                        data-testid="rename-open"
                      >
                        Rename
                      </Button>
                      {confirm === w.slug ? (
                        <span
                          role="group"
                          aria-label={`Confirm archiving ${w.name}`}
                          className="flex items-center gap-2"
                        >
                          <span className="text-sm">
                            Pauses its live queries. Nothing is deleted.
                          </span>
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() =>
                              run(`ar-${w.slug}`, () => archiveWorkspaceAction(w.slug), "Archived.")
                            }
                            loading={busy === `ar-${w.slug}`}
                            data-testid="archive-confirm"
                          >
                            Archive
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setConfirm(null)}>
                            Keep
                          </Button>
                        </span>
                      ) : (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setConfirm(w.slug)}
                          aria-label={`Archive ${w.name}`}
                          data-testid="archive-open"
                        >
                          Archive
                        </Button>
                      )}
                    </span>
                  )}
                </>
              )}
            </li>
          ))}
        </ul>
      </section>

      {canCreate ? (
        <section
          aria-labelledby="new-ws"
          className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5"
        >
          <h2 id="new-ws" className="font-semibold">
            New workspace
          </h2>
          <form onSubmit={create} className="mt-3 flex max-w-lg flex-col gap-4" noValidate>
            <Field
              label="Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={80}
              data-testid="ws-name"
              hint="A brand or a client, like “Acme Coffee”."
            />
            <fieldset className="flex flex-col gap-1">
              <legend className="text-sm font-medium">What is it for?</legend>
              {(["client", "own_brand"] as const).map((t) => (
                <label key={t} className="flex min-h-6 items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="ws-type"
                    checked={type === t}
                    onChange={() => setType(t)}
                    className="h-4 w-4"
                    data-testid={`ws-type-${t}`}
                  />
                  {t === "client" ? "A client's brand" : "One of our own brands"}
                </label>
              ))}
            </fieldset>
            <div className="flex flex-col gap-1">
              <label htmlFor="ws-copy" className="text-sm font-medium">
                Start from
              </label>
              <select
                id="ws-copy"
                value={copy}
                onChange={(e) => setCopy(e.target.value)}
                className={sel}
                data-testid="ws-copy"
              >
                <option value="">An empty workspace</option>
                {active.map((w) => (
                  <option key={w.id} value={w.id}>
                    A copy of {w.name}&apos;s dashboards and reports
                  </option>
                ))}
              </select>
              <p className="text-xs text-[var(--text-muted)]">
                Copies layouts only. Queries aren&apos;t copied, so the new workspace never uses
                your mention quota until you add its own.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <Button type="submit" loading={busy === "create"} data-testid="ws-create">
                Create workspace
              </Button>
              {atLimit && (
                <span className="text-sm text-[var(--text-muted)]" data-testid="ws-at-limit">
                  You&apos;re at your plan&apos;s limit.
                </span>
              )}
            </div>
          </form>
        </section>
      ) : (
        <p className="text-sm text-[var(--text-muted)]">
          Only owners and admins can create workspaces.
        </p>
      )}

      {archived.length > 0 && (
        <section aria-labelledby="arch-h">
          <h2 id="arch-h" className="text-lg font-semibold">
            Archived
          </h2>
          <ul className="mt-3 flex flex-col gap-2" data-testid="archived-list">
            {archived.map((w) => (
              <li
                key={w.id}
                className="flex flex-wrap items-center gap-3 rounded-lg border border-dashed border-[var(--border)] p-3"
              >
                <span className="font-medium">{w.name}</span>
                {w.canManage && (
                  <Button
                    size="sm"
                    variant="secondary"
                    className="ml-auto"
                    onClick={() =>
                      run(
                        `rs-${w.slug}`,
                        () => restoreWorkspaceAction(w.slug),
                        "Restored. Its queries are still paused; turn them back on when you're ready.",
                      )
                    }
                    loading={busy === `rs-${w.slug}`}
                    aria-label={`Restore ${w.name}`}
                    data-testid="restore"
                  >
                    Restore
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
