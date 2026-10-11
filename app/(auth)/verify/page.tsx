import { eq } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { db, users } from "@/db/client";
import { trackServer } from "@/lib/analytics/server";
import { consumeToken } from "@/lib/auth/tokens";
import { requireUser } from "@/lib/auth/session";
import { ResendButton } from "./ResendButton";
import { simNow } from "@/lib/simclock";

export const metadata = { title: "Verify your email · Ripplewise" };

export default async function VerifyPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  if (token) {
    const userId = await consumeToken(token, "verify_email");
    if (userId) {
      const user = (await db.select().from(users).where(eq(users.id, userId)).limit(1))[0]!;
      if (!user.emailVerifiedAt) {
        await db.update(users).set({ emailVerifiedAt: simNow() }).where(eq(users.id, userId));
        await trackServer(
          "Email Verified",
          { userId },
          { time_to_verify_ms: simNow().getTime() - user.createdAt.getTime() },
        );
      }
      const session = await auth();
      redirect(session?.user?.id === userId ? "/onboarding" : "/login?verified=1");
    }
    return (
      <div role="alert" className="flex flex-col gap-3">
        <h1 className="text-[24px] font-semibold">This link has expired</h1>
        <p className="text-[var(--text-muted)]">
          Verification links work once and expire after 24 hours. Log in and we&apos;ll send you a
          fresh one.
        </p>
        <Link href="/login" className="underline">
          Go to log in
        </Link>
      </div>
    );
  }

  const user = await requireUser();
  if (user.emailVerifiedAt) redirect("/onboarding");
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-[24px] font-semibold leading-8">Check your inbox</h1>
      <p className="text-[var(--text-muted)]">
        We sent a verification link to <strong className="text-[var(--text)]">{user.email}</strong>.
        Mentions start collecting once your email is verified.
      </p>
      <ResendButton />
      <p className="text-sm text-[var(--text-muted)]">
        Trouble finding it? Open your{" "}
        <Link href="/inbox" className="underline">
          simulated inbox
        </Link>
        .
      </p>
    </div>
  );
}
