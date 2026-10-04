import Link from "next/link";
import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { accounts, db, memberships, users } from "@/db/client";
import { demoSlots, SALES_ENTRY_POINTS } from "@/lib/sales/service";
import { simNow } from "@/lib/simclock";
import { ContactForm } from "./ContactForm";

export const metadata = { title: "Contact sales · Ripplewise" };
export const dynamic = "force-dynamic";

export default async function ContactSales({
  searchParams,
}: {
  searchParams: Promise<{ entry?: string }>;
}) {
  const { entry } = await searchParams;
  const entryPoint = (SALES_ENTRY_POINTS as readonly string[]).includes(entry ?? "")
    ? entry!
    : "direct";
  const session = await auth();
  let defaults = { name: "", email: "", company: "" };
  if (session?.user?.id) {
    const [u] = await db.select().from(users).where(eq(users.id, session.user.id));
    const [m] = await db
      .select()
      .from(memberships)
      .where(eq(memberships.userId, session.user.id))
      .limit(1);
    const [a] = m ? await db.select().from(accounts).where(eq(accounts.id, m.accountId)) : [];
    defaults = { name: u?.name ?? "", email: u?.email ?? "", company: a?.name ?? "" };
  }
  const slots = demoSlots(simNow()).map((d) => ({
    iso: d.toISOString(),
    label: `${d.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" })}, ${d.getUTCHours()}:00 UTC`,
  }));
  return (
    <main id="main" className="mx-auto max-w-xl p-6">
      <header className="flex items-center gap-4">
        <Link href="/" className="font-semibold">
          Ripplewise
        </Link>
        <Link href="/pricing" className="ml-auto text-sm underline">
          Pricing
        </Link>
      </header>
      <h1 className="mt-8 text-[30px] font-semibold leading-[38px]">Talk to our team</h1>
      <p className="mt-1 mb-6 text-[var(--text-muted)]">
        For larger teams, agencies and custom terms. Tell us a little and we&apos;ll send a quote,
        or book a demo.
      </p>
      <ContactForm entryPoint={entryPoint} slots={slots} defaults={defaults} />
    </main>
  );
}
