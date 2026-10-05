"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { finishAction } from "./actions";

/** Completes sign-in on arrival; the button is the fallback if scripts are blocked. */
export function Finish({ token, to }: { token: string; to: string }) {
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const started = useRef(false);
  const go = () =>
    start(async () => {
      const r = await finishAction(token, to);
      if (r?.error) setError(r.error);
    });
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    go();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="flex flex-col gap-3" aria-live="polite">
      {error ? (
        <>
          <p role="alert" className="text-sm text-[var(--danger)]" data-testid="finish-error">
            {error}
          </p>
          <Link href="/login" className="underline">
            Back to log in
          </Link>
        </>
      ) : (
        <>
          <p className="text-[var(--text-muted)]">Signing you in…</p>
          <Button loading={pending} onClick={go} variant="secondary" data-testid="finish-continue">
            Continue
          </Button>
        </>
      )}
    </div>
  );
}
