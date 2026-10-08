import { HelpTopics } from "@/components/help/HelpTopics";
import { SupportForm } from "@/components/help/SupportForm";
import { requireWorkspace } from "@/lib/auth/session";

export const metadata = { title: "Help · Ripplewise" };
export const dynamic = "force-dynamic";

export default async function HelpPage({ params }: { params: Promise<{ ws: string }> }) {
  const { ws: slug } = await params;
  await requireWorkspace(slug);
  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="text-[30px] font-semibold leading-[38px]">Help</h1>
      <p className="mt-1 text-[var(--text-muted)]">
        Short answers for the things people ask most. Keyboard shortcuts are in the dialog behind
        the
        <kbd className="mx-1 rounded border border-[var(--border)] px-1.5 text-xs">?</kbd>
        key.
      </p>
      <section className="mt-6" aria-labelledby="topics-h">
        <h2 id="topics-h" className="sr-only">
          Help topics
        </h2>
        <HelpTopics ws={slug} />
      </section>
      <section className="mt-10" aria-labelledby="ask-h">
        <h2 id="ask-h" className="text-lg font-semibold">
          Still stuck? Ask us
        </h2>
        <p className="mb-3 mt-1 text-sm text-[var(--text-muted)]">
          A person reads every question and replies by email.
        </p>
        <SupportForm ws={slug} />
      </section>
    </div>
  );
}
