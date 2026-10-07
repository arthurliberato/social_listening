"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { track } from "@/lib/analytics/client";

export default function PortalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    track("Error Displayed", { error_code: error.digest ?? "creator_portal_failed" });
  }, [error]);
  return (
    <section
      role="alert"
      className="rounded-lg border border-[var(--danger)] bg-[var(--surface)] p-6"
    >
      <h1 className="text-xl font-semibold">We couldn&apos;t load your page</h1>
      <p className="mt-2 text-[var(--text-muted)]">
        Something went wrong on our side, and nothing you did has been lost. Try again; if it keeps
        happening, quote <code>{error.digest ?? "n/a"}</code> to the brand.
      </p>
      <Button className="mt-4" onClick={reset} data-testid="retry">
        Try again
      </Button>
    </section>
  );
}
