"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { saveBrandingAction } from "@/app/settings/team/actions";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { contrastOnWhite, isHex, MIN_CONTRAST, type Branding } from "@/lib/team/contrast";

export function BrandingForm({
  ws,
  initial,
  workspaceName,
}: {
  ws: string;
  initial: Branding;
  workspaceName: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [b, setB] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ field?: string; msg: string } | null>(null);
  const contrast = isHex(b.accent) ? contrastOnWhite(b.accent) : null;
  const weak = contrast !== null && contrast < MIN_CONTRAST;

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const r = await saveBrandingAction(ws, b);
    setBusy(false);
    if (!r.ok) return setError({ field: r.field, msg: r.error });
    toast.success("Branding saved.");
    router.refresh();
  };
  const name = b.displayName || workspaceName;
  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <form onSubmit={save} className="flex flex-col gap-4" noValidate>
        <Field
          label="Brand name"
          value={b.displayName}
          onChange={(e) => setB({ ...b, displayName: e.target.value })}
          maxLength={60}
          hint="Shown to clients instead of Ripplewise. Leave empty to keep the workspace name."
          error={error?.field === "displayName" ? error.msg : undefined}
          data-testid="brand-display-name"
        />
        <div className="flex flex-col gap-1">
          <label htmlFor="brand-accent" className="text-sm font-medium">
            Accent colour
          </label>
          <div className="flex items-center gap-2">
            <input
              type="color"
              aria-label="Pick an accent colour"
              value={isHex(b.accent) ? b.accent : "#1f6feb"}
              onChange={(e) => setB({ ...b, accent: e.target.value })}
              className="h-10 w-12 rounded border border-[var(--border)]"
              data-testid="brand-accent-picker"
            />
            <input
              id="brand-accent"
              value={b.accent}
              onChange={(e) => setB({ ...b, accent: e.target.value })}
              placeholder="#1f6feb"
              className="min-h-10 w-32 rounded-[var(--radius-input)] border border-[var(--border)] bg-[var(--surface)] px-3 text-sm"
              aria-describedby="accent-hint"
              data-testid="brand-accent"
            />
          </div>
          <p
            id="accent-hint"
            className={`text-xs ${weak || error?.field === "accent" ? "text-[var(--danger)]" : "text-[var(--text-muted)]"}`}
            data-testid="accent-hint"
            role={weak ? "alert" : undefined}
          >
            {error?.field === "accent"
              ? error.msg
              : contrast === null
                ? "Used for the bar at the top of shared pages and PDFs."
                : weak
                  ? `White text on this colour has a contrast of ${contrast.toFixed(1)}:1; it needs ${MIN_CONTRAST}:1. Choose a darker shade.`
                  : `Contrast with white text: ${contrast.toFixed(1)}:1. Good.`}
          </p>
        </div>
        <Field
          label="Footer text (optional)"
          value={b.footerText}
          onChange={(e) => setB({ ...b, footerText: e.target.value })}
          maxLength={160}
          hint="A line under shared pages and in the PDF footer, like “Prepared by Studio North”."
          error={error?.field === "footerText" ? error.msg : undefined}
          data-testid="brand-footer-text"
        />
        <label className="flex min-h-6 items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={b.hidePoweredBy}
            onChange={(e) => setB({ ...b, hidePoweredBy: e.target.checked })}
            className="h-4 w-4"
            data-testid="brand-hide-powered"
          />
          Hide “Powered by Ripplewise”
        </label>
        {error && !error.field && (
          <p role="alert" className="text-sm text-[var(--danger)]" data-testid="brand-error">
            {error.msg}
          </p>
        )}
        <Button
          type="submit"
          loading={busy}
          disabled={weak}
          className="self-start"
          data-testid="brand-save"
        >
          Save branding
        </Button>
      </form>
      <section
        aria-labelledby="prev-h"
        className="h-fit rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4"
      >
        <h2 id="prev-h" className="mb-3 text-sm font-medium text-[var(--text-muted)]">
          What your clients see
        </h2>
        <div className="rounded-md border border-[var(--border)] p-4" data-testid="brand-preview">
          <div
            className="mb-3 h-1.5 rounded"
            style={{ background: isHex(b.accent) ? b.accent : "var(--border)" }}
          />
          <p className="text-xs text-[var(--text-muted)]">Shared by {name} · read-only</p>
          <p className="text-lg font-semibold">Brand health</p>
          <div className="mt-6 border-t border-[var(--border)] pt-2 text-xs text-[var(--text-muted)]">
            {b.footerText && <p>{b.footerText}</p>}
            {!b.hidePoweredBy && <p>Built with Ripplewise.</p>}
          </div>
        </div>
      </section>
    </div>
  );
}
