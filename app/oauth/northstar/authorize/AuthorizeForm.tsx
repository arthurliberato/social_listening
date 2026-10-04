"use client";

import Link from "next/link";
import { useActionState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { DOMAIN } from "@/lib/auth/oauth-domain";
import { approve } from "./actions";

export function AuthorizeForm({ state, next }: { state: string; next: string }) {
  const [s, action, pending] = useActionState(approve, {} as { error?: string; url?: string });
  useEffect(() => {
    if (s.url) window.location.assign(s.url);
  }, [s.url]);
  return (
    <form action={action} className="flex flex-col gap-4" data-testid="ns-form">
      <input type="hidden" name="state" value={state} />
      <input type="hidden" name="next" value={next} />
      {s.error && (
        <p role="alert" className="text-sm text-[var(--danger)]" data-testid="ns-error">
          {s.error}
        </p>
      )}
      <Field
        label="Username"
        name="username"
        autoComplete="off"
        required
        hint={`Your Northstar ID will be username@${DOMAIN}`}
        data-testid="ns-username"
      />
      <Field label="Display name" name="name" autoComplete="off" data-testid="ns-name" />
      <p className="text-sm text-[var(--text-muted)]">
        Ripplewise will receive your Northstar ID and display name. Nothing else.
      </p>
      <div className="flex gap-3">
        <Button type="submit" loading={pending} data-testid="ns-allow">
          Allow
        </Button>
        <Link
          href="/login?oauth=cancelled"
          className="inline-flex min-h-9 items-center rounded-md border border-[var(--border)] px-4 text-sm hover:bg-[var(--surface-2)]"
          data-testid="ns-cancel"
        >
          Cancel
        </Link>
      </div>
    </form>
  );
}
