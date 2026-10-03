import { findInvite } from "@/lib/auth/signup";
import { SignupForm } from "./SignupForm";

export const metadata = { title: "Sign up · Ripplewise" };

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ invite?: string }>;
}) {
  const { invite } = await searchParams;
  const found = invite ? await findInvite(invite) : null;
  if (invite && !found) {
    return (
      <div role="alert">
        <h1 className="text-[24px] font-semibold">This invitation isn&apos;t valid</h1>
        <p className="mt-2 text-[var(--text-muted)]">
          The link may have expired or already been used. Ask your teammate to send a new one.
        </p>
      </div>
    );
  }
  return <SignupForm invite={invite} inviteEmail={found?.email} />;
}
