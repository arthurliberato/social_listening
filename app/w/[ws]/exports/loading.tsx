export default function Loading() {
  return (
    <div
      className="mx-auto flex max-w-5xl flex-col gap-3"
      role="status"
      aria-label="Loading exports"
    >
      <div className="h-10 w-40 animate-pulse rounded bg-[var(--surface-2)] motion-reduce:animate-none" />
      {Array.from({ length: 4 }, (_, i) => (
        <div
          key={i}
          className="h-20 animate-pulse rounded-lg bg-[var(--surface-2)] motion-reduce:animate-none"
        />
      ))}
    </div>
  );
}
