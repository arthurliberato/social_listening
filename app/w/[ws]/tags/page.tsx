import Link from "next/link";
import { CategoryForm } from "@/components/categories/CategoryForm";
import { CategoryRow } from "@/components/categories/CategoryRow";
import { requireWorkspace } from "@/lib/auth/session";
import { listCategories, MAX_CATEGORIES, tagCounts } from "@/lib/categories/service";
import { accountPlan, canEdit } from "@/lib/queries";

export const metadata = { title: "Tags & Categories · Ripplewise" };
export const dynamic = "force-dynamic";

export default async function TagsPage({ params }: { params: Promise<{ ws: string }> }) {
  const { ws: slug } = await params;
  const { ws } = await requireWorkspace(slug);
  const { plan } = await accountPlan(ws.id);
  const [cats, tags] = await Promise.all([
    listCategories(ws.id, plan.historyDays),
    tagCounts(ws.id),
  ]);
  const editable = canEdit(ws.role);

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="text-[30px] font-semibold leading-[38px]">Tags &amp; Categories</h1>
      <p className="mt-1 text-[var(--text-muted)]">
        Categories slice your mentions into themes with the same search language as queries. Tags
        are labels your team puts on individual mentions.
      </p>

      <section className="mt-6" aria-labelledby="cats-h">
        <h2 id="cats-h" className="text-lg font-semibold">
          Categories{" "}
          <span className="text-sm font-normal text-[var(--text-muted)]">
            {cats.length} of {MAX_CATEGORIES}
          </span>
        </h2>
        {editable ? (
          <div className="mt-3">
            <CategoryForm ws={slug} />
          </div>
        ) : (
          <p className="mt-2 text-sm text-[var(--text-muted)]" data-testid="categories-readonly">
            Your role can view categories but not change them. Ask an admin for editor access.
          </p>
        )}
        {cats.length === 0 ? (
          <div
            className="mt-4 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-8 text-center"
            data-testid="categories-empty"
          >
            <h3 className="text-base font-semibold">No categories yet</h3>
            <p className="mx-auto mt-1 max-w-md text-sm text-[var(--text-muted)]">
              After reading a sample of mentions, name the themes you see: pricing, delivery,
              service. Each shows how much of the conversation it covers.
            </p>
          </div>
        ) : (
          <div className="mt-4 overflow-x-auto rounded-lg border border-[var(--border)] bg-[var(--surface)]">
            <table className="w-full text-left text-sm" data-testid="category-table">
              <caption className="sr-only">Categories in this workspace, last 30 days</caption>
              <thead className="text-[var(--text-muted)]">
                <tr className="border-b border-[var(--border)]">
                  <th scope="col" className="px-3 py-2 font-medium">
                    Category
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Mentions (30 days)
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Negative
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {cats.map((c) => (
                  <CategoryRow key={c.id} ws={slug} c={c} canEdit={editable} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="mt-8" aria-labelledby="tags-h">
        <h2 id="tags-h" className="text-lg font-semibold">
          Tags
        </h2>
        {tags.length === 0 ? (
          <p className="mt-2 text-sm text-[var(--text-muted)]" data-testid="tags-empty">
            No tags yet. Press <kbd>t</kbd> on a mention in the{" "}
            <Link href={`/w/${slug}/mentions`} className="underline">
              feed
            </Link>{" "}
            to add one.
          </p>
        ) : (
          <ul className="mt-3 flex flex-wrap gap-2" data-testid="tag-list">
            {tags.map((t) => (
              <li key={t.tag}>
                <Link
                  href={`/w/${slug}/mentions?${new URLSearchParams({ tag: t.tag })}`}
                  className="inline-flex min-h-6 items-center gap-1 rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 py-0.5 text-sm"
                >
                  {t.tag}
                  <span className="text-[var(--text-muted)]">{t.n}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
