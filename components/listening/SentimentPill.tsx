const META = {
  positive: { icon: "▲", label: "Positive", color: "var(--sentiment-positive)" },
  neutral: { icon: "●", label: "Neutral", color: "var(--sentiment-neutral)" },
  negative: { icon: "▼", label: "Negative", color: "var(--sentiment-negative)" },
  mixed: { icon: "◆", label: "Mixed", color: "var(--sentiment-mixed)" },
} as const;

/** Sentiment is never encoded by colour alone: icon + label + colour. */
export function SentimentPill({ sentiment }: { sentiment: string }) {
  const m = META[sentiment as keyof typeof META] ?? META.neutral;
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full border border-[var(--border)] px-2 py-0.5 text-xs"
      data-sentiment={sentiment}
    >
      <span aria-hidden style={{ color: m.color }}>
        {m.icon}
      </span>
      {m.label}
    </span>
  );
}
