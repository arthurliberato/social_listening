// Initials on a colour derived from the creator's seed: no images, nothing fetched, and every avatar is decorative.
const HUES = [212, 18, 156, 42, 330, 120, 252, 2];

export function Avatar({ name, seed, size = 36 }: { name: string; seed: number; size?: number }) {
  const hue = HUES[seed % HUES.length]!;
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
  return (
    <span
      aria-hidden
      className="inline-flex shrink-0 items-center justify-center rounded-full font-semibold"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.38,
        background: `hsl(${hue} 55% 88%)`,
        color: `hsl(${hue} 60% 22%)`,
      }}
    >
      {initials}
    </span>
  );
}
