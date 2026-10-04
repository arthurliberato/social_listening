import { safeNext } from "@/lib/auth/recovery";
import { AuthorizeForm } from "./AuthorizeForm";

export const metadata = { title: "Northstar ID (simulated)", robots: { index: false } };

export default async function Authorize({
  searchParams,
}: {
  searchParams: Promise<{ state?: string; next?: string }>;
}) {
  const { state, next } = await searchParams;
  return (
    <main id="main" className="mx-auto max-w-md p-6">
      <p
        role="note"
        className="rounded-md border border-[var(--warning)] p-3 text-sm"
        data-testid="ns-banner"
      >
        <strong>Simulated identity provider.</strong> Northstar ID is a stand-in for a real sign-in
        provider, used for testing. Anyone can pick any username here, so it can only sign in
        accounts created through it, never an existing Ripplewise account.
      </p>
      <h1 className="mt-6 text-[24px] font-semibold leading-8">Sign in with Northstar ID</h1>
      <p className="mt-1 mb-4 text-[var(--text-muted)]">Ripplewise is asking to sign you in.</p>
      <AuthorizeForm state={state ?? ""} next={safeNext(next)} />
    </main>
  );
}
