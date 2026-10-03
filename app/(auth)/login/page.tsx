import Link from "next/link";
import { LoginForm } from "./LoginForm";

export const metadata = { title: "Log in · Ripplewise" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; verified?: string }>;
}) {
  const { next, verified } = await searchParams;
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
      <LoginForm next={next} />
      <p className="text-sm text-[var(--text-muted)]">
        New here?{" "}
        <Link href="/signup" className="underline">
          Start a free trial
        </Link>
      </p>
    </div>
  );
}
