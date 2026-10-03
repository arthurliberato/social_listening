import { NAV_GROUPS } from "@/components/shell/nav";

export default async function Placeholder({
  params,
}: {
  params: Promise<{ ws: string; section: string[] }>;
}) {
  const { section } = await params;
  const item = NAV_GROUPS.flatMap((g) => g.items).find((i) => i.href === section[0]);
  return (
    <div>
      <h1 className="text-[30px] font-semibold leading-[38px]">{item?.label ?? "Not found"}</h1>
      <p className="mt-2 text-[var(--text-muted)]">This screen arrives in a later milestone.</p>
    </div>
  );
}
