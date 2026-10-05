/** Skeleton shaped like the final layout (cards), shown while the first load streams in. */
export default function Loading() {
  return (
    <div
      className="mx-auto flex max-w-[1600px] flex-col gap-3"
      role="status"
      aria-label="Loading mentions"
    >
      <div className="h-10 w-48 animate-pulse rounded bg-[var(--surface-2)] motion-reduce:animate-none" />
      <div className="h-24 animate-pulse rounded-lg bg-[var(--surface-2)] motion-reduce:animate-none" />
      {Array.from({ length: 4 }, (_, i) => (
        <div
          key={i}
          className="h-40 animate-pulse rounded-lg bg-[var(--surface-2)] motion-reduce:animate-none"
        />
      ))}
    </div>
  );
}
