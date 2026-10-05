import Link from "next/link";
import { auth } from "@/auth";
import { eq } from "drizzle-orm";
import { db, users } from "@/db/client";
import { quoteValueCents, usd } from "@/lib/sales/pricing";
import { findQuote, isExpired, markViewed, signingAccount } from "@/lib/sales/service";
import { QuotePanel } from "./QuotePanel";

export const metadata = { title: "Your quote · Ripplewise", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function QuotePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const f = /^[0-9a-f]{48}$/.test(token) ? await findQuote(token) : null;
  return (
    <main id="main" className="mx-auto max-w-2xl p-6">
      <Link href="/" className="font-semibold">
        Ripplewise
      </Link>
      {!f ? (
        <div className="mt-8" data-testid="quote-missing">
          <h1 className="text-[30px] font-semibold leading-[38px]">
            We can&apos;t find that quote
          </h1>
          <p className="mt-2 text-[var(--text-muted)]">
            The link may be mistyped or out of date. Reply to the email we sent you, or{" "}
            <Link href="/contact-sales" className="underline">
              ask for a new one
            </Link>
            .
          </p>
        </div>
      ) : (
        <Body token={token} f={f} />
      )}
    </main>
  );
}

async function Body({
  token,
  f,
}: {
  token: string;
  f: NonNullable<Awaited<ReturnType<typeof findQuote>>>;
}) {
  const { quote: q, request: r } = f;
  const expired = isExpired(q);
  if (!expired) await markViewed(q.id);
  const session = await auth();
  const [u] = session?.user?.id
    ? await db.select().from(users).where(eq(users.id, session.user.id))
    : [];
  const canAct = u ? !!(await signingAccount(u.id, r.accountId)) : false;
  const monthly = Math.round(q.valueCents / q.termMonths);
  return (
    <div className="mt-8">
      <h1 className="text-[30px] font-semibold leading-[38px]">Enterprise quote for {r.company}</h1>
      <dl className="mt-5 grid gap-3 sm:grid-cols-3" data-testid="quote-summary">
        {[
          ["Seats", String(q.seats)],
          ["Term", `${q.termMonths} months`],
          ["Total", usd(q.valueCents)],
        ].map(([k, v]) => (
          <div key={k} className="rounded-lg border border-[var(--border)] p-3">
            <dt className="text-xs text-[var(--text-muted)]">{k}</dt>
            <dd className="mt-1 text-xl font-semibold tabular-nums">{v}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 text-sm text-[var(--text-muted)]">
        About {usd(monthly)} a month, invoiced.{" "}
        {quoteValueCents(q.seats, q.termMonths) === q.valueCents
          ? "Includes the multi-year discount for your term."
          : ""}{" "}
        Valid until {q.expiresAt.toISOString().slice(0, 10)}.
      </p>
      <div className="mt-6">
        {expired ? (
          <p
            role="alert"
            className="rounded-lg border border-[var(--warning)] p-4 text-sm"
            data-testid="quote-expired"
          >
            This quote has expired. Reply to our email and we&apos;ll send a fresh one.
          </p>
        ) : (
          <QuotePanel
            token={token}
            valueUsd={Math.round(q.valueCents / 100)}
            status={q.status as "sent" | "viewed" | "accepted" | "signed"}
            user={u?.name ?? null}
            canAct={canAct}
          />
        )}
      </div>
    </div>
  );
}
