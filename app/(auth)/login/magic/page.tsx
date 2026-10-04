import Link from "next/link";
import { safeNext } from "@/lib/auth/recovery";
import { peekToken } from "@/lib/auth/tokens";
import { MagicConfirm } from "./MagicForms";

export const metadata = { title: "Log in · Ripplewise" };
export const dynamic = "force-dynamic";

export default async function MagicPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; next?: string }>;
}) {
  const { token, next } = await searchParams;
  if (!token || !(await peekToken(token, "magic_link")))
    return (
      <div role="alert" className="flex flex-col gap-3" data-testid="magic-expired">
        <h1 className="text-[24px] font-semibold">This link has expired</h1>
        <p className="text-[var(--text-muted)]">
          Login links work once and expire after 15 minutes.
        </p>
        <Link href="/login" className="underline">
          Back to log in
        </Link>
      </div>
    );
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-[24px] font-semibold leading-8">Log in to Ripplewise</h1>
      <p className="text-[var(--text-muted)]">Confirm to finish logging in on this device.</p>
      <MagicConfirm token={token} next={safeNext(next)} />
    </div>
  );
}
