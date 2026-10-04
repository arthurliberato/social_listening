export default function Loading() {
  return (
    <div
      className="mx-auto flex max-w-3xl flex-col gap-3"
      role="status"
      aria-label="Loading authors"
    >
      <div className="h-10 w-40 animate-pulse rounded bg-[var(--surface-2)] motion-reduce:animate-none" />
      <div className="h-24 animate-pulse rounded-lg bg-[var(--surface-2)] motion-reduce:animate-none" />
      <div className="h-32 animate-pulse rounded-lg bg-[var(--surface-2)] motion-reduce:animate-none" />
    </div>
  );
}
