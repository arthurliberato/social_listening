import Link from "next/link";
import { LoginForm } from "./LoginForm";
import { MagicRequest } from "./magic/MagicForms";

export const metadata = { title: "Log in · Ripplewise" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; verified?: string; reset?: string; oauth?: string }>;
}) {
  const { next, verified, reset, oauth } = await searchParams;
  const oauthMsg: Record<string, string> = {
    cancelled: "Sign-in with Northstar ID was cancelled.",
    exists:
      "That Northstar ID can't be used here because an account with that email already exists.",
    bad_state: "That sign-in attempt expired or came from another browser. Try again.",
    bad_code: "That sign-in attempt expired. Try again.",
  };
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-[24px] font-semibold leading-8">Log in</h1>
      {verified && (
        <p
          role="status"
          className="rounded-md border border-[var(--success)] p-3 text-sm text-[var(--success)]"
        >
          Email verified. Log in to continue.
        </p>
      )}
      {reset && (
        <p
          role="status"
          className="rounded-md border border-[var(--success)] p-3 text-sm text-[var(--success)]"
          data-testid="reset-done"
        >
          Password changed. Log in with your new password.
        </p>
      )}
      {oauth && oauthMsg[oauth] && (
        <p
          role="alert"
          className="rounded-md border border-[var(--warning)] p-3 text-sm"
          data-testid="oauth-error"
        >
          {oauthMsg[oauth]}
        </p>
      )}
      <LoginForm next={next} />
      <p className="text-sm">
        <Link href="/forgot" className="underline" data-testid="forgot-link">
          Forgot your password?
        </Link>
      </p>
      <MagicRequest next={next} />
      <div className="flex flex-col gap-2 border-t border-[var(--border)] pt-4">
        <a
          href={`/oauth/northstar/start${next ? `?next=${encodeURIComponent(next)}` : ""}`}
          className="inline-flex min-h-10 items-center justify-center rounded-md border border-[var(--border)] px-4 text-sm font-medium hover:bg-[var(--surface-2)]"
          data-testid="oauth-northstar"
        >
          Continue with Northstar ID
        </a>
        <p className="text-xs text-[var(--text-muted)]">
          Northstar ID is a simulated provider used for testing.
        </p>
      </div>
      <p className="text-sm text-[var(--text-muted)]">
        New here?{" "}
        <Link href="/signup" className="underline">
          Start a free trial
        </Link>
      </p>
    </div>
  );
}
