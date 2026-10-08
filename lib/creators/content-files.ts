// What a creator may upload as their content, kept free of the database so it can be tested directly.
// The type of a file is decided from its first bytes, never from its name or the type the browser claims.

export const MAX_FILE_BYTES = 25 * 1024 * 1024;

export interface FileKind {
  mime: string;
  ext: string;
  label: string;
  /** Shown in the browser (inline) or only offered as a download. */
  inline: boolean;
  preview: "image" | "video" | null;
}

const KINDS = {
  jpeg: { mime: "image/jpeg", ext: "jpg", label: "JPEG image", inline: true, preview: "image" },
  png: { mime: "image/png", ext: "png", label: "PNG image", inline: true, preview: "image" },
  gif: { mime: "image/gif", ext: "gif", label: "GIF image", inline: true, preview: "image" },
  webp: { mime: "image/webp", ext: "webp", label: "WebP image", inline: true, preview: "image" },
  mp4: { mime: "video/mp4", ext: "mp4", label: "MP4 video", inline: true, preview: "video" },
  mov: {
    mime: "video/quicktime",
    ext: "mov",
    label: "QuickTime video",
    inline: false,
    preview: null,
  },
  pdf: { mime: "application/pdf", ext: "pdf", label: "PDF document", inline: false, preview: null },
} as const satisfies Record<string, FileKind>;

export const ACCEPTED_LABEL = "JPG, PNG, GIF, WebP, MP4, MOV or PDF, up to 25 MB";
/** For the file input's `accept`; the server still checks the bytes. */
export const ACCEPT_ATTR = ".jpg,.jpeg,.png,.gif,.webp,.mp4,.mov,.pdf";

const ascii = (b: Uint8Array, at: number, s: string) =>
  s.length + at <= b.length && [...s].every((c, i) => b[at + i] === c.charCodeAt(0));

/** What a file really is, from its leading bytes, or null when it isn't one of the accepted types. */
export function sniffKind(b: Uint8Array): FileKind | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return KINDS.jpeg;
  if (ascii(b, 1, "PNG") && b[0] === 0x89) return KINDS.png;
  if (ascii(b, 0, "GIF87a") || ascii(b, 0, "GIF89a")) return KINDS.gif;
  if (ascii(b, 0, "RIFF") && ascii(b, 8, "WEBP")) return KINDS.webp;
  if (ascii(b, 0, "%PDF-")) return KINDS.pdf;
  if (ascii(b, 4, "ftyp")) {
    // QuickTime movies announce themselves with the brand "qt  "; every other MP4 family brand is treated as MP4.
    return ascii(b, 8, "qt  ") ? KINDS.mov : KINDS.mp4;
  }
  return null;
}

/** A name that is safe to show and to put in a header: no path, no control characters, not too long, right extension. */
export function safeFileName(raw: string, kind: FileKind): string {
  const base = (raw.split(/[\\/]/).pop() ?? "")
    .replace(/[\u0000-\u001f\u007f"<>:|?*]/g, "")
    .trim();
  const stem = base.replace(/\.[^.]*$/, "").trim() || "content";
  return `${stem.slice(0, 80).trim()}.${kind.ext}`;
}

export function prettySize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export type FileCheck =
  { ok: true; kind: FileKind; name: string; size: number } | { ok: false; reason: string };

export function checkFile(name: string, bytes: Uint8Array): FileCheck {
  if (bytes.length === 0) return { ok: false, reason: "That file is empty." };
  if (bytes.length > MAX_FILE_BYTES)
    return {
      ok: false,
      reason: `That file is too large. The limit is ${prettySize(MAX_FILE_BYTES)}.`,
    };
  const kind = sniffKind(bytes);
  if (!kind)
    return { ok: false, reason: `We can't accept that kind of file. Use ${ACCEPTED_LABEL}.` };
  return { ok: true, kind, name: safeFileName(name, kind), size: bytes.length };
}

/** Headers that make a stored file safe to serve: its true type, no sniffing, no scripts, never cached or indexed. */
export function downloadHeaders(f: { name: string; mime: string; size: number }, inline: boolean) {
  return {
    "Content-Type": f.mime,
    "Content-Length": String(f.size),
    "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${f.name.replace(/[^\x20-\x7e]/g, "_")}"`,
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy":
      "sandbox; default-src 'none'; img-src 'self' data:; media-src 'self'",
    "Cache-Control": "private, no-store",
    "X-Robots-Tag": "noindex, nofollow",
  };
}
