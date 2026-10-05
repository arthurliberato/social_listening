/** Default first query for a brand: name, hashtag and handles, minus common job-ad noise. */
export function brandQuery(o: { name: string; handles?: string[] }): string {
  const squashed = o.name.toLowerCase().replace(/[^a-z0-9]+/g, "");
  const terms = [
    `"${o.name.trim()}"`,
    ...(squashed ? [`#${squashed}`] : []),
    ...(o.handles ?? []).map((h) => `@${h.replace(/^@/, "")}`),
  ];
  return `(${[...new Set(terms)].join(" OR ")}) NOT (job OR hiring)`;
}
