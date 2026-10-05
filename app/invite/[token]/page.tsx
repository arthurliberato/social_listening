import { eq, sql } from "drizzle-orm";
import Link from "next/link";
import { auth } from "@/auth";
import { db, invitations, users, workspaces } from "@/db/client";
import { AcceptInvite } from "@/components/team/AcceptInvite";
import { LogoutButton } from "@/components/team/LogoutButton";
import { hashToken } from "@/lib/auth/tokens";
import { ROLE_LABEL, type Role } from "@/lib/permissions";

export const metadata = {
  title: "Invitation · Ripplewise",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";

const Card = ({ children, testId }: { children: React.ReactNode; testId: string }) => (
  <main
    id="main"
    className="mx-auto mt-16 max-w-md rounded-lg border border-[var(--border)] bg-[var(--surface)] p-8"
    data-testid={testId}
  >
    {children}
  </main>
);

/** Where an emailed invitation lands: sign in, sign up, or accept, depending on who you are. */
export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const [inv] = /^[A-Za-z0-9_-]{20,64}$/.test(token)
    ? await db
        .select()
        .from(invitations)
        .where(eq(invitations.tokenHash, hashToken(token)))
    : [];
  if (!inv || inv.acceptedAt || inv.expiresAt <= new Date())
    return (
      <Card testId="invite-unavailable">
        <h1 className="text-[24px] font-semibold">This invitation isn&apos;t available</h1>
        <p className="mt-2 text-[var(--text-muted)]">
          It may have expired, been used already, or been cancelled. Ask whoever invited you to send
          a new one.
        </p>
        <Link href="/login" className="mt-4 inline-block underline">
          Log in
        </Link>
      </Card>
    );
  const [ws] = await db
    .select({ name: workspaces.name })
    .from(workspaces)
    .where(eq(workspaces.id, inv.workspaceId));
  const [inviter] = await db
    .select({ name: users.name })
    .from(users)
    .where(eq(users.id, inv.invitedBy));
  const role = ROLE_LABEL[inv.role as Role] ?? inv.role;
  const session = await auth();
  const me = session?.user?.id
    ? (await db.select().from(users).where(eq(users.id, session.user.id)))[0]
    : undefined;
  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(sql`lower(${users.email}) = ${inv.email.toLowerCase()}`);
  const heading = (
    <>
      <h1 className="text-[24px] font-semibold">Join {ws?.name}</h1>
      <p className="mt-2 text-[var(--text-muted)]">
        {inviter?.name} invited <strong>{inv.email}</strong> to join as{" "}
        {inv.role === "client_viewer"
          ? "a client viewer (dashboards and reports)"
          : `${/^[aeiou]/i.test(role) ? "an" : "a"} ${role.toLowerCase()}`}
        .
      </p>
    </>
  );

  if (me && me.email.toLowerCase() === inv.email.toLowerCase())
    return (
      <Card testId="invite-accept">
        {heading}
        <div className="mt-6">
          <AcceptInvite token={token} workspace={ws?.name ?? "the workspace"} />
        </div>
      </Card>
    );
  if (me)
    return (
      <Card testId="invite-wrong-account">
        {heading}
        <p className="mt-4 text-sm" role="status">
          You&apos;re signed in as a different account. Log out, then open this link again with the
          address the invitation was sent to.
        </p>
        <div className="mt-4">
          <LogoutButton next={`/invite/${token}`} />
        </div>
      </Card>
    );
  return (
    <Card testId="invite-signed-out">
      {heading}
      <div className="mt-6 flex flex-wrap gap-3">
        {existing ? (
          <Link
            href={`/login?next=${encodeURIComponent(`/invite/${token}`)}`}
            className="inline-flex min-h-10 items-center rounded-md bg-[var(--primary)] px-5 text-sm font-medium text-[var(--primary-contrast)]"
            data-testid="invite-login"
          >
            Log in to join
          </Link>
        ) : (
          <Link
            href={`/signup?invite=${token}`}
            className="inline-flex min-h-10 items-center rounded-md bg-[var(--primary)] px-5 text-sm font-medium text-[var(--primary-contrast)]"
            data-testid="invite-signup"
          >
            Create your account
          </Link>
        )}
      </div>
    </Card>
  );
}
