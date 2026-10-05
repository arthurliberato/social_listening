"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { track } from "@/lib/analytics/client";
import { signUp, type SignupState } from "./actions";

function strength(pw: string): { score: number; label: string } {
  let score = 0;
  if (pw.length >= 10) score++;
  if (pw.length >= 14) score++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++;
  if (/\d/.test(pw) && /[^A-Za-z0-9]/.test(pw)) score++;
  return { score, label: ["Too short", "Weak", "Fair", "Good", "Strong"][score]! };
}

const ATTRIBUTION = ["utm_source", "utm_medium", "utm_campaign", "gclid"] as const;

export function SignupForm({ invite, inviteEmail }: { invite?: string; inviteEmail?: string }) {
  const [state, action, pending] = useActionState<SignupState, FormData>(signUp, {});
  const [pw, setPw] = useState("");
  const started = useRef(false);
  const [attr, setAttr] = useState<Record<string, string>>({});
  const s = strength(pw);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const a: Record<string, string> = {};
    for (const k of ATTRIBUTION) if (q.get(k)) a[k] = q.get(k)!;
    if (document.referrer) a.referrer = new URL(document.referrer).hostname;
    const ga = /(?:^|; )_ga=GA\d\.\d\.([^;]+)/.exec(document.cookie);
    if (ga) a.ga_client_id = ga[1]!;
    setAttr(a);
  }, []);

  return (
    <form
      action={action}
      onFocus={() => {
        if (!started.current) {
          started.current = true;
          track("Sign Up Started");
        }
      }}
      className="flex flex-col gap-4"
      data-testid="signup-form"
    >
      <h1 className="text-[24px] font-semibold leading-8">
        {invite ? "Accept your invitation" : "Start your 14-day free trial"}
      </h1>
      {!invite && <p className="text-[var(--text-muted)]">No credit card required.</p>}
      {state.errors?.form && (
        <p
          role="alert"
          className="rounded-md border border-[var(--danger)] p-3 text-sm text-[var(--danger)]"
        >
          {state.errors.form}
        </p>
      )}
      {invite && <input type="hidden" name="invite" value={invite} />}
      {Object.entries(attr).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <Field
        label="Your name"
        name="name"
        autoComplete="name"
        required
        defaultValue={state.values?.name}
        error={state.errors?.name}
        data-testid="signup-name"
      />
      <Field
        label="Work email"
        name="email"
        type="email"
        autoComplete="email"
        required
        defaultValue={inviteEmail ?? state.values?.email}
        readOnly={!!inviteEmail}
        error={state.errors?.email}
        data-testid="signup-email"
        hint={
          state.errors?.email?.includes("already exists") ? (
            <Link href="/login" className="underline">
              Go to log in
            </Link>
          ) : undefined
        }
      />
      {!invite && (
        <Field
          label="Company or team"
          name="company"
          autoComplete="organization"
          required
          defaultValue={state.values?.company}
          error={state.errors?.company}
          data-testid="signup-company"
        />
      )}
      <div>
        <Field
          label="Password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={10}
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          error={state.errors?.password}
          data-testid="signup-password"
          hint="At least 10 characters. Paste and password managers are welcome."
        />
        <div className="mt-2 flex items-center gap-2" aria-live="polite">
          <div className="h-1.5 flex-1 rounded-full bg-[var(--surface-2)]" aria-hidden>
            <div
              className="h-full rounded-full bg-[var(--primary)]"
              style={{ width: `${(s.score / 4) * 100}%` }}
            />
          </div>
          <span className="text-xs text-[var(--text-muted)]" data-testid="password-strength">
            {pw ? s.label : ""}
          </span>
        </div>
      </div>
      <Button type="submit" size="lg" loading={pending} data-testid="signup-submit">
        {invite ? "Join workspace" : "Start 14-day free trial"}
      </Button>
      <p className="text-sm text-[var(--text-muted)]">
        Already have an account?{" "}
        <Link href="/login" className="underline">
          Log in
        </Link>
      </p>
    </form>
  );
}
