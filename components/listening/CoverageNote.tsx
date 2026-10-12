import Link from "next/link";

/** A short, static reminder of what the counts cover, with a link to the fuller explanation in Help. */
export function CoverageNote({ ws, className = "" }: { ws: string; className?: string }) {
  return (
    <p className={`text-xs text-[var(--text-muted)] ${className}`} data-testid="coverage-note">
      Counts cover the public posts we can collect. Coverage differs by source and can change.{" "}
      <Link
        href={`/w/${ws}/help?topic=data-coverage`}
        className="text-[var(--primary)] underline underline-offset-2"
        data-testid="coverage-note-link"
      >
        How coverage works
      </Link>
    </p>
  );
}
