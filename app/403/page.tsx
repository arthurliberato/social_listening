import Link from "next/link";

export const metadata = { title: "No access · Ripplewise" };

export default function Forbidden() {
  return (
    <main id="main" className="mx-auto max-w-md p-8">
      <h1 className="text-[30px] font-semibold leading-[38px]">You don&apos;t have access</h1>
      <p className="mt-2 text-[var(--text-muted)]">
        You&apos;re not a member of this workspace. Ask an admin to invite you, or switch to one of
        your own workspaces.
      </p>
      <Link href="/" className="mt-4 inline-block underline">
        Back to my workspace
      </Link>
    </main>
  );
}
