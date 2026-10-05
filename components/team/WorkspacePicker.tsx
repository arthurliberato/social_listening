import Link from "next/link";

/** Which workspace a settings page is about. Plain links, so it works without JavaScript. */
export function WorkspacePicker({
  base,
  active,
  current,
}: {
  base: string;
  active: { slug: string; name: string }[];
  current: string;
}) {
  if (active.length <= 1) return null;
  return (
    <nav
      aria-label="Workspace"
      className="mt-3 flex flex-wrap gap-2"
      data-testid="workspace-picker"
    >
      {active.map((w) => (
        <Link
          key={w.slug}
          href={`${base}?ws=${w.slug}`}
          aria-current={w.slug === current ? "page" : undefined}
          className={`inline-flex min-h-8 items-center rounded-full border px-3 text-sm ${w.slug === current ? "border-[var(--primary)] bg-[var(--surface-2)] font-medium" : "border-[var(--border)] hover:bg-[var(--surface-2)]"}`}
          data-testid={`pick-${w.slug}`}
        >
          {w.name}
        </Link>
      ))}
    </nav>
  );
}
