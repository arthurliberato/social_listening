"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { resetAction } from "./actions";

export function ResetForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState(resetAction, {} as { error?: string });
  return (
    <form action={action} className="flex flex-col gap-4" data-testid="reset-form">
      <input type="hidden" name="token" value={token} />
      {state.error && (
        <p
          role="alert"
          className="rounded-md border border-[var(--danger)] p-3 text-sm text-[var(--danger)]"
          data-testid="reset-error"
        >
          {state.error}
        </p>
      )}
      <Field
        label="New password"
        name="password"
        type="password"
        autoComplete="new-password"
        required
        minLength={10}
        hint="At least 10 characters. A password manager is a good idea."
        data-testid="reset-password"
      />
      <Button type="submit" size="lg" loading={pending} data-testid="reset-submit">
        Set new password
      </Button>
    </form>
  );
}
