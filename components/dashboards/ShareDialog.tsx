"use client";

import { useEffect, useRef, useState } from "react";
import { recordInternalShare, setPublicLink } from "@/app/w/[ws]/dashboards/actions";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { track } from "@/lib/analytics/client";

/** Share a dashboard: an internal link for teammates, and (on Growth and up) a public read-only link. */
export function ShareDialog({
  open,
  ws,
  id,
  token: initial,
  canPublic,
  canEdit,
  onUpgrade,
  onClose,
}: {
  open: boolean;
  ws: string;
  id: string;
  token: string | null;
  canPublic: boolean;
  canEdit: boolean;
  onUpgrade: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const toast = useToast();
  const [token, setToken] = useState(initial);
  // Optimistic: the checkbox flips at once and rolls back if the server refuses.
  const [on, setOn] = useState(!!initial);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const internal = `${origin}/w/${ws}/dashboards/${id}`;
  const publicUrl = token ? `${origin}/share/${token}` : "";
  const copy = async (text: string, what: string, type: "internal_link" | "public_link") => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${what} copied.`);
    } catch {
      toast.error("Couldn't copy automatically. Select the link and copy it.");
    }
    if (type === "internal_link") {
      void recordInternalShare(ws, id);
    }
    track("Insight Shared", { share_channel: type, insight_type: "dashboard" });
  };
  const toggle = async (enabled: boolean) => {
    if (enabled && !canPublic) {
      onUpgrade();
      return;
    }
    setOn(enabled);
    setBusy(true);
    const r = await setPublicLink(ws, id, enabled);
    setBusy(false);
    if (r.ok) {
      setToken(r.token);
      toast.success(
        enabled
          ? "Public link turned on."
          : "Public link turned off. The old link no longer works.",
      );
    } else {
      setOn(!enabled);
      toast.error(r.error);
    }
  };

  return (
    <dialog
      ref={ref}
      aria-labelledby="sh-title"
      onClose={onClose}
      data-testid="share-dialog"
      className="m-auto w-full max-w-lg rounded-[var(--radius-modal)] border border-[var(--border)] bg-[var(--surface)] p-6 text-[var(--text)] backdrop:bg-black/40"
    >
      <h2 id="sh-title" className="text-lg font-semibold">
        Share this dashboard
      </h2>
      <section className="mt-4" aria-labelledby="sh-int">
        <h3 id="sh-int" className="text-sm font-medium">
          Teammates
        </h3>
        <p className="text-sm text-[var(--text-muted)]">
          Anyone in this workspace can open this link after logging in.
        </p>
        <div className="mt-2 flex gap-2">
          <input
            readOnly
            value={internal}
            aria-label="Internal link"
            className="min-h-9 flex-1 rounded border border-[var(--border)] bg-[var(--surface-2)] px-2 text-sm"
            data-testid="share-internal"
          />
          <Button
            variant="secondary"
            onClick={() => copy(internal, "Link", "internal_link")}
            data-testid="copy-internal"
          >
            Copy
          </Button>
        </div>
      </section>
      <section className="mt-5" aria-labelledby="sh-pub">
        <h3 id="sh-pub" className="text-sm font-medium">
          Public link{" "}
          <span className="font-normal text-[var(--text-muted)]">
            {canPublic ? "" : "(Growth plan and up)"}
          </span>
        </h3>
        <p className="text-sm text-[var(--text-muted)]">
          Anyone with the link can view, read-only, without logging in. Turn it off any time.
        </p>
        <label className="mt-2 flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={on}
            disabled={busy || !canEdit}
            onChange={(e) => void toggle(e.target.checked)}
            data-testid="public-toggle"
          />
          Anyone with the link can view
        </label>
        {token && (
          <div className="mt-2 flex gap-2">
            <input
              readOnly
              value={publicUrl}
              aria-label="Public link"
              className="min-h-9 flex-1 rounded border border-[var(--border)] bg-[var(--surface-2)] px-2 text-sm"
              data-testid="share-public"
            />
            <Button
              variant="secondary"
              onClick={() => copy(publicUrl, "Public link", "public_link")}
              data-testid="copy-public"
            >
              Copy
            </Button>
          </div>
        )}
      </section>
      <section className="mt-5 text-sm text-[var(--text-muted)]">
        <h3 className="font-medium text-[var(--text)]">Embed</h3>
        <p>Embedding dashboards in other sites is part of the Enterprise plan.</p>
      </section>
      <div className="mt-6 flex justify-end">
        <Button variant="secondary" onClick={onClose}>
          Done
        </Button>
      </div>
    </dialog>
  );
}
