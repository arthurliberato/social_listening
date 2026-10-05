"use client";

import { useEffect, useState, type ReactNode } from "react";
import { AlertRowActions } from "./AlertRowActions";

/**
 * One row of the alert table. The first cells are server-rendered and passed in; the status and actions live
 * here so a mute, unmute or delete shows at once and does not hinge on the page re-rendering (in a production
 * build a refresh started right after a server action was sometimes dropped by the browser).
 */
export function RuleRow({
  ws,
  id,
  name,
  muted,
  canEdit,
  children,
}: {
  ws: string;
  id: string;
  name: string;
  muted: boolean;
  canEdit: boolean;
  children: ReactNode;
}) {
  const [isMuted, setMuted] = useState(muted);
  const [gone, setGone] = useState(false);
  useEffect(() => setMuted(muted), [muted]); // someone else changed it; the page re-rendered
  if (gone) return null;
  return (
    <tr className="border-b border-[var(--border)] last:border-0" data-testid="rule-row">
      {children}
      <td className="px-3 py-2" data-testid="rule-status">
        {isMuted ? "Muted" : "Active"}
      </td>
      <td className="px-3 py-2">
        <AlertRowActions
          ws={ws}
          id={id}
          name={name}
          muted={isMuted}
          canEdit={canEdit}
          onMuted={setMuted}
          onDeleted={() => setGone(true)}
        />
      </td>
    </tr>
  );
}
