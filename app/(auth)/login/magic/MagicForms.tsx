"use client";

import { useActionState, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { magicLoginAction, magicRequestAction } from "./actions";

/** On the login page: ask for an emailed link. Collapsed so it doesn't compete with the password form. */
export function MagicRequest({ next }: { next?: string }) {
  const [state, action, pending] = useActionState(
    magicRequestAction,
    {} as { sent?: boolean; email?: string },
  );
  return (
    <details className="rounded-md border border-[var(--border)] p-3" data-testid="magic-details">
      <summary className="min-h-6 cursor-pointer text-sm font-medium">
        Email me a login link instead
      </summary>
      {state.sent ? (
        <p role="status" className="mt-3 text-sm" data-testid="magic-sent">
          If there&apos;s an account for <strong>{state.email}</strong>, we&apos;ve sent a login
          link. It works once and expires in 15 minutes. Check your{" "}
          <a href="/inbox" className="underline">
            inbox
          </a>
          .
        </p>
      ) : (
        <form action={action} className="mt-3 flex flex-col gap-3">
          <input type="hidden" name="next" value={next ?? ""} />
          <Field
            label="Email"
            name="email"
            type="email"
            autoComplete="username"
            required
            data-testid="magic-email"
          />
          <Button type="submit" variant="secondary" loading={pending} data-testid="magic-submit">
            Send login link
          </Button>
        </form>
      )}
    </details>
  );
}

/** On the link's landing page: logging in is a deliberate click, so mail scanners that open links can't use it up. */
export function MagicConfirm({ token, next }: { token: string; next: string }) {
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-col gap-3">
      {error && (
        <p role="alert" className="text-sm text-[var(--danger)]" data-testid="magic-error">
          {error}
        </p>
      )}
      <Button
        size="lg"
        loading={pending}
        data-testid="magic-login"
        onClick={() =>
          start(async () => {
            const r = await magicLoginAction(token, next);
            if (r?.error) setError(r.error);
          })
        }
      >
        Log in
      </Button>
    </div>
  );
}
