import { desc, eq } from "drizzle-orm";
import { db, emails } from "@/db/client";
import { requireUser } from "@/lib/auth/session";

export const metadata = { title: "Inbox · Ripplewise" };
export const dynamic = "force-dynamic";

/** Simulated mailbox: each user sees only mail addressed to them. Links in bodies are clickable. */
function Linkified({ text }: { text: string }) {
  return text.split(/(https?:\/\/\S+)/g).map((part, i) =>
    /^https?:\/\//.test(part) ? (
      <a key={i} href={part} className="text-[var(--primary)] underline break-all">
        {part}
      </a>
    ) : (
      <span key={i}>{part}</span>
    ),
  );
}

export default async function InboxPage() {
  const user = await requireUser();
  const rows = await db
    .select()
    .from(emails)
    .where(eq(emails.toUserId, user.id))
    .orderBy(desc(emails.createdAt))
    .limit(100);
  return (
    <main id="main" className="mx-auto max-w-2xl p-6">
      <h1 className="text-[30px] font-semibold leading-[38px]">Inbox</h1>
      <p className="mt-1 text-[var(--text-muted)]">Simulated mailbox for {user.email}.</p>
      {rows.length === 0 && <p className="mt-6 text-[var(--text-muted)]">No messages yet.</p>}
      <ul className="mt-6 flex flex-col gap-4" data-testid="inbox-list">
        {rows.map((m) => (
          <li
            key={m.id}
            className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4"
            data-testid="inbox-message"
            data-email-type={m.type}
          >
            <h2 className="font-medium">{m.subject}</h2>
            <p className="text-xs text-[var(--text-muted)]">{m.createdAt.toISOString()}</p>
            <pre className="mt-3 whitespace-pre-wrap font-sans text-sm">
              <Linkified text={m.bodyText} />
            </pre>
          </li>
        ))}
      </ul>
    </main>
  );
}
