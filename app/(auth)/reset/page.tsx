import Link from "next/link";
import { peekToken } from "@/lib/auth/tokens";
import { ResetForm } from "./ResetForm";

export const metadata = { title: "Choose a new password · Ripplewise" };
export const dynamic = "force-dynamic";

export default async function ResetPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  if (!token || !(await peekToken(token, "reset_password")))
    return (
      <div role="alert" className="flex flex-col gap-3" data-testid="reset-expired">
        <h1 className="text-[24px] font-semibold">This link has expired</h1>
        <p className="text-[var(--text-muted)]">
          Reset links work once and expire after an hour. Ask for a new one.
        </p>
        <Link href="/forgot" className="underline">
          Send a new link
        </Link>
      </div>
    );
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-[24px] font-semibold leading-8">Choose a new password</h1>
      <ResetForm token={token} />
    </div>
  );
}
