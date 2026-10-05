// COPY-text (tab-separated) serialisation, so shards load with `\copy ... FROM STDIN`.
import { createWriteStream, mkdirSync } from "node:fs";
import { once } from "node:events";
import { dirname } from "node:path";
import { createGzip } from "node:zlib";
import type { Author } from "./authors";
import type { MentionRow } from "./generate";

export const MENTION_COLUMNS = [
  "id",
  "source_id",
  "author_id",
  "brand_id",
  "parent_id",
  "content_type",
  "title",
  "text",
  "lang",
  "country",
  "region",
  "city",
  "published_at",
  "url",
  "has_media",
  "media_alt",
  "detected_logos",
  "likes",
  "shares",
  "comments",
  "views",
  "reach_est",
  "sentiment_true",
  "sentiment_pred",
  "sentiment_conf",
  "emotion_pred",
  "topics",
  "entities",
  "is_spam",
  "is_sarcastic",
  "story_id",
  "crisis_id",
] as const;

export const AUTHOR_COLUMNS = [
  "id",
  "source_id",
  "handle",
  "display_name",
  "followers",
  "following",
  "verified",
  "country",
  "language",
  "author_type",
  "bot_score",
  "bio",
  "avatar_seed",
  "created_at",
] as const;

const esc = (v: string) =>
  v.replace(/\\/g, "\\\\").replace(/\t/g, "\\t").replace(/\n/g, "\\n").replace(/\r/g, "\\r");
const N = "\\N";
const s = (v: string | null) => (v === null ? N : esc(v));
const n = (v: number | null) => (v === null ? N : String(v));
const b = (v: boolean) => (v ? "t" : "f");
const iso = (ms: number) => new Date(ms).toISOString();
const arr = (a: string[]) =>
  a.length ? `{${a.map((x) => `"${esc(x).replace(/"/g, '\\\\"')}"`).join(",")}}` : "{}";

export function mentionLine(m: MentionRow): string {
  return [
    m.id,
    m.sourceId,
    m.authorId,
    n(m.brandId),
    n(m.parentId),
    m.contentType,
    s(m.title),
    esc(m.text),
    m.lang,
    m.country,
    m.region,
    m.city,
    iso(m.publishedAt),
    m.url,
    b(m.hasMedia),
    s(m.mediaAlt),
    arr(m.detectedLogos),
    m.likes,
    m.shares,
    m.comments,
    m.views,
    m.reachEst,
    m.sentimentTrue,
    m.sentimentPred,
    m.sentimentConf,
    m.emotionPred,
    arr(m.topics),
    arr(m.entities),
    b(m.isSpam),
    b(m.isSarcastic),
    n(m.storyId),
    n(m.crisisId),
  ].join("\t");
}

export function authorLine(a: Author): string {
  return [
    a.id,
    a.sourceId,
    esc(a.handle),
    esc(a.displayName),
    a.followers,
    a.following,
    b(a.verified),
    a.country,
    a.language,
    a.type,
    a.botScore.toFixed(3),
    esc(a.bio),
    a.avatarSeed,
    iso(a.createdAt),
  ].join("\t");
}

export class GzTsv {
  private gz = createGzip({ level: 3 });
  private out;
  private buf: string[] = [];
  private size = 0;
  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.out = createWriteStream(path);
    this.gz.pipe(this.out);
  }
  async line(l: string): Promise<void> {
    this.buf.push(l);
    this.size += l.length;
    if (this.size > 1 << 20) await this.flush();
  }
  private async flush() {
    if (!this.buf.length) return;
    const chunk = this.buf.join("\n") + "\n";
    this.buf = [];
    this.size = 0;
    if (!this.gz.write(chunk)) await once(this.gz, "drain");
  }
  async close(): Promise<void> {
    await this.flush();
    this.gz.end();
    await once(this.out, "close");
  }
}
