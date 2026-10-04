"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { track } from "@/lib/analytics/client";
import { forgotAction } from "./actions";

export function ForgotForm() {
  const [state, action, pending] = useActionState(
    forgotAction,
    {} as { sent?: boolean; email?: string },
  );
  if (state.sent)
    return (
      <div
        role="status"
        className="rounded-md border border-[var(--success)] p-4 text-sm"
        data-testid="forgot-sent"
      >
        If there&apos;s an account for <strong>{state.email}</strong>, we&apos;ve sent a link to
        reset the password. It works once and expires in an hour. Check your{" "}
        <a href="/inbox" className="underline">
          inbox
        </a>
        .
      </div>
    );
  return (
    <form
      action={action}
      onSubmit={() => track("Password Reset Requested", {})}
      className="flex flex-col gap-4"
      data-testid="forgot-form"
    >
      <Field
        label="Email"
        name="email"
        type="email"
        autoComplete="username"
        required
        data-testid="forgot-email"
      />
      <Button type="submit" size="lg" loading={pending} data-testid="forgot-submit">
        Email me a reset link
      </Button>
    </form>
  );
}
