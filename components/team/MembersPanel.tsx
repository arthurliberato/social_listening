"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  changeRoleAction,
  invitePeopleAction,
  leaveWorkspaceAction,
  removeMemberAction,
  resendInviteAction,
  revokeInviteAction,
} from "@/app/settings/team/actions";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import {
  assignableRoles,
  canChangeRole,
  ROLE_BLURB,
  ROLE_LABEL,
  ROLES,
  type Role,
} from "@/lib/permissions";
import type { InviteResult } from "@/lib/team/invites";

export interface MemberView {
  userId: string;
  name: string;
  email: string;
  role: Role;
  joined: string;
}
export interface InviteView {
  id: string;
  email: string;
  role: Role;
  expires: string;
}

const sel =
  "min-h-9 rounded-[var(--radius-input)] border border-[var(--border)] bg-[var(--surface)] px-2 text-sm";
const OUTCOME: Record<InviteResult["status"], string> = {
  sent: "Invitation sent",
  already_member: "Already here",
  already_invited: "Already invited",
  invalid: "Not a valid address",
  seat_limit: "No seat free",
  role_not_allowed: "Not allowed",
};

export function MembersPanel({
  ws,
  myId,
  myRole,
  members,
  invites,
  seats,
}: {
  ws: string;
  myId: string;
  myRole: Role;
  members: MemberView[];
  invites: InviteView[];
  seats: { used: number; limit: number; clientViewers: number };
}) {
  const router = useRouter();
  const toast = useToast();
  const mine = assignableRoles(myRole);
  const [emails, setEmails] = useState("");
  const [role, setRole] = useState<Role>(
    mine.includes("editor") ? "editor" : (mine[0] ?? "viewer"),
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [results, setResults] = useState<InviteResult[] | null>(null);
  const [upgradeTo, setUpgradeTo] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [roles, setRoles] = useState<Record<string, Role>>({});

  const invite = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy("invite");
    setError("");
    setResults(null);
    const r = await invitePeopleAction(ws, emails, role);
    setBusy(null);
    if (!r.ok) return setError(r.error);
    setResults(r.results);
    setUpgradeTo(r.upgradeTo ?? null);
    if (r.results.every((x) => x.status === "sent")) setEmails("");
    router.refresh();
  };
  const change = async (m: MemberView, to: Role) => {
    setError("");
    const before = roles[m.userId] ?? m.role;
    setRoles((x) => ({ ...x, [m.userId]: to })); // optimistic
    const r = await changeRoleAction(ws, m.userId, to);
    if (!r.ok) {
      setRoles((x) => ({ ...x, [m.userId]: before }));
      return setError(r.error);
    }
    toast.success(`${m.name} is now ${ROLE_LABEL[to]}.`);
    router.refresh();
  };
  const remove = async (m: MemberView) => {
    setBusy(`rm-${m.userId}`);
    setError("");
    const r =
      m.userId === myId ? await leaveWorkspaceAction(ws) : await removeMemberAction(ws, m.userId);
    setBusy(null);
    setConfirm(null);
    if (!r.ok) return setError(r.error);
    if (m.userId === myId) return router.push("/");
    toast.success(`${m.name} was removed.`);
    router.refresh();
  };
  const inviteAct = async (id: string, kind: "resend" | "revoke") => {
    setBusy(`${kind}-${id}`);
    setError("");
    const r =
      kind === "resend" ? await resendInviteAction(ws, id) : await revokeInviteAction(ws, id);
    setBusy(null);
    if (!r.ok) return setError(r.error);
    toast.success(kind === "resend" ? "Invitation sent again." : "Invitation cancelled.");
    router.refresh();
  };

  const full = seats.used >= seats.limit;
  return (
    <div className="flex flex-col gap-8">
      <section aria-labelledby="seats-h" data-testid="seat-summary">
        <h2 id="seats-h" className="sr-only">
          Seats
        </h2>
        <p className="text-sm">
          <strong data-testid="seat-count">
            {seats.used} of {seats.limit}
          </strong>{" "}
          seats used.{" "}
          <span className="text-[var(--text-muted)]">
            {seats.clientViewers > 0
              ? `${seats.clientViewers} client viewer${seats.clientViewers === 1 ? "" : "s"} on top, free. `
              : "Client viewers are free. "}
          </span>
          {full && (
            <Link href="/upgrade?from=seat_limit" className="underline" data-testid="seats-upgrade">
              Need more seats? See plans
            </Link>
          )}
        </p>
      </section>

      {error && (
        <p
          role="alert"
          className="rounded-md border border-[var(--danger)] p-3 text-sm text-[var(--danger)]"
          data-testid="members-error"
        >
          {error}
        </p>
      )}

      <section
        aria-labelledby="invite-h"
        className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5"
      >
        <h2 id="invite-h" className="font-semibold">
          Invite people
        </h2>
        <form onSubmit={invite} className="mt-3 flex flex-col gap-3" noValidate>
          <div className="flex flex-col gap-1">
            <label htmlFor="invite-emails" className="text-sm font-medium">
              Email addresses
            </label>
            <textarea
              id="invite-emails"
              value={emails}
              onChange={(e) => setEmails(e.target.value)}
              rows={2}
              placeholder="sam@example.com, lee@example.com"
              className="rounded-[var(--radius-input)] border border-[var(--border)] bg-[var(--surface)] p-2 text-sm"
              data-testid="invite-emails"
            />
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1">
              <label htmlFor="invite-role" className="text-sm font-medium">
                Role
              </label>
              <select
                id="invite-role"
                value={role}
                onChange={(e) => setRole(e.target.value as Role)}
                className={sel}
                data-testid="invite-role"
              >
                {mine.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABEL[r]}
                  </option>
                ))}
              </select>
            </div>
            <Button type="submit" loading={busy === "invite"} data-testid="invite-send">
              Send invitations
            </Button>
          </div>
          <p className="text-xs text-[var(--text-muted)]" data-testid="invite-role-blurb">
            {ROLE_BLURB[role]}
          </p>
        </form>
        {results && (
          <div role="status" className="mt-4" data-testid="invite-results">
            <ul className="flex flex-col gap-1 text-sm">
              {results.map((r) => (
                <li key={r.email} data-status={r.status}>
                  <strong>{r.email}</strong>: {OUTCOME[r.status]}
                  {r.reason && r.status !== "sent" ? `. ${r.reason}` : ""}
                </li>
              ))}
            </ul>
            {upgradeTo && (
              <p className="mt-2 text-sm">
                <Link
                  href={`/upgrade?from=seat_limit&plan=${upgradeTo}`}
                  className="underline"
                  data-testid="invite-upgrade"
                >
                  See plans
                </Link>
              </p>
            )}
          </div>
        )}
      </section>

      <section aria-labelledby="members-h">
        <h2 id="members-h" className="text-lg font-semibold">
          People in this workspace
        </h2>
        <div className="mt-3 overflow-x-auto rounded-lg border border-[var(--border)] bg-[var(--surface)]">
          <table className="w-full text-left text-sm" data-testid="member-table">
            <caption className="sr-only">Members of this workspace and their roles</caption>
            <thead className="text-[var(--text-muted)]">
              <tr className="border-b border-[var(--border)]">
                <th scope="col" className="px-3 py-2 font-medium">
                  Person
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Role
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Joined
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => {
                const cur = roles[m.userId] ?? m.role;
                const options = ROLES.filter((r) => r === cur || canChangeRole(myRole, cur, r));
                const isMe = m.userId === myId;
                const canRemove = !isMe && canChangeRole(myRole, cur, null);
                return (
                  <tr
                    key={m.userId}
                    className="border-b border-[var(--border)] last:border-0"
                    data-testid="member-row"
                    data-role={cur}
                  >
                    <th scope="row" className="px-3 py-2 font-medium">
                      {m.name}
                      {isMe && (
                        <span className="ml-1 text-xs font-normal text-[var(--text-muted)]">
                          (you)
                        </span>
                      )}
                      <span className="block text-xs font-normal text-[var(--text-muted)]">
                        {m.email}
                      </span>
                    </th>
                    <td className="px-3 py-2">
                      {options.length > 1 ? (
                        <select
                          aria-label={`Role for ${m.name}`}
                          value={cur}
                          onChange={(e) => change(m, e.target.value as Role)}
                          className={sel}
                          data-testid="member-role"
                        >
                          {options.map((r) => (
                            <option key={r} value={r}>
                              {ROLE_LABEL[r]}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span data-testid="member-role-text">{ROLE_LABEL[cur]}</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-[var(--text-muted)]">{m.joined}</td>
                    <td className="px-3 py-2">
                      {confirm === m.userId ? (
                        <span
                          role="group"
                          aria-label={isMe ? "Confirm leaving" : `Confirm removing ${m.name}`}
                          className="flex flex-wrap items-center gap-2"
                        >
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => remove(m)}
                            loading={busy === `rm-${m.userId}`}
                            data-testid="member-remove-confirm"
                          >
                            {isMe ? "Leave" : "Remove"}
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setConfirm(null)}>
                            Keep
                          </Button>
                        </span>
                      ) : canRemove || isMe ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setConfirm(m.userId)}
                          aria-label={isMe ? "Leave this workspace" : `Remove ${m.name}`}
                          data-testid={isMe ? "member-leave" : "member-remove"}
                        >
                          {isMe ? "Leave workspace" : "Remove"}
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="pending-h">
        <h2 id="pending-h" className="text-lg font-semibold">
          Waiting to join
        </h2>
        {invites.length === 0 ? (
          <p
            className="mt-2 rounded-lg border border-dashed border-[var(--border)] p-5 text-sm text-[var(--text-muted)]"
            data-testid="no-invites"
          >
            No pending invitations.
          </p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2" data-testid="invite-list">
            {invites.map((i) => (
              <li
                key={i.id}
                className="flex flex-wrap items-center gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3 text-sm"
                data-testid="invite-row"
              >
                <span className="font-medium">{i.email}</span>
                <span className="text-[var(--text-muted)]">
                  {ROLE_LABEL[i.role]} · expires {i.expires}
                </span>
                {assignableRoles(myRole).includes(i.role) && (
                  <span className="ml-auto flex gap-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => inviteAct(i.id, "resend")}
                      loading={busy === `resend-${i.id}`}
                      aria-label={`Resend invitation to ${i.email}`}
                      data-testid="invite-resend"
                    >
                      Resend
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => inviteAct(i.id, "revoke")}
                      loading={busy === `revoke-${i.id}`}
                      aria-label={`Cancel invitation to ${i.email}`}
                      data-testid="invite-revoke"
                    >
                      Cancel
                    </Button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="roles-h">
        <h2 id="roles-h" className="text-lg font-semibold">
          What each role can do
        </h2>
        <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2" data-testid="role-guide">
          {ROLES.map((r) => (
            <div
              key={r}
              className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3"
            >
              <dt className="font-medium">{ROLE_LABEL[r]}</dt>
              <dd className="text-[var(--text-muted)]">{ROLE_BLURB[r]}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}
