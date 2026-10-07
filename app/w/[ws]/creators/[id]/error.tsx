"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { track } from "@/lib/analytics/client";

export default function CreatorsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    track("Error Displayed", { error_code: error.digest ?? "creators_load_failed" });
  }, [error]);
  return (
    <section
      role="alert"
      className="mx-auto max-w-lg rounded-lg border border-[var(--danger)] bg-[var(--surface)] p-6"
    >
      <h1 className="text-xl font-semibold">We couldn&apos;t load this creator</h1>
      <p className="mt-2 text-[var(--text-muted)]">
        Something went wrong on our side. Your data is safe. Try again, and if it keeps happening
        quote this reference: <code>{error.digest ?? "n/a"}</code>.
      </p>
      <Button className="mt-4" onClick={reset} data-testid="retry">
        Try again
      </Button>
    </section>
  );
}
