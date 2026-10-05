"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { logIn, type LoginState } from "./actions";

export function LoginForm({ next }: { next?: string }) {
  const [state, action, pending] = useActionState<LoginState, FormData>(logIn, {});
  return (
    <form action={action} className="flex flex-col gap-4" data-testid="login-form">
      {state.error && (
        <p
          role="alert"
          data-testid="login-error"
          className="rounded-md border border-[var(--danger)] p-3 text-sm text-[var(--danger)]"
        >
          {state.error}
        </p>
      )}
      <input type="hidden" name="next" value={next && next.startsWith("/") ? next : "/"} />
      <Field
        label="Email"
        name="email"
        type="email"
        autoComplete="username"
        required
        defaultValue={state.email}
        data-testid="login-email"
      />
      <Field
        label="Password"
        name="password"
        type="password"
        autoComplete="current-password"
        required
        data-testid="login-password"
      />
      <Button type="submit" size="lg" loading={pending} data-testid="login-submit">
        Log in
      </Button>
    </form>
  );
}
