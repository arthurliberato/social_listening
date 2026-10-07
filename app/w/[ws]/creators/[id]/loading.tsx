export default function Loading() {
  return (
    <div
      className="mx-auto flex max-w-7xl flex-col gap-3"
      role="status"
      aria-label="Loading creators"
    >
      <div className="h-10 w-64 animate-pulse rounded bg-[var(--surface-2)] motion-reduce:animate-none" />
      <div className="h-32 animate-pulse rounded-lg bg-[var(--surface-2)] motion-reduce:animate-none" />
      <div className="h-64 animate-pulse rounded-lg bg-[var(--surface-2)] motion-reduce:animate-none" />
    </div>
  );
}
