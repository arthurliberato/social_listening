import { describe, expect, it } from "vitest";
import {
  MAX_FILE_BYTES,
  checkFile,
  downloadHeaders,
  prettySize,
  safeFileName,
  sniffKind,
} from "./content-files";

const bytes = (...a: (number | string)[]) =>
  Uint8Array.from(
    a.flatMap((x) => (typeof x === "string" ? [...x].map((c) => c.charCodeAt(0)) : [x])),
  );

describe("file types", () => {
  it("are recognised from the first bytes", () => {
    expect(sniffKind(bytes(0xff, 0xd8, 0xff, 0xe0))?.mime).toBe("image/jpeg");
    expect(sniffKind(bytes(0x89, "PNG", 13, 10, 26, 10))?.mime).toBe("image/png");
    expect(sniffKind(bytes("GIF89a", 1, 0))?.mime).toBe("image/gif");
    expect(sniffKind(bytes("RIFF", 1, 2, 3, 4, "WEBPVP8 "))?.mime).toBe("image/webp");
    expect(sniffKind(bytes("%PDF-1.7"))?.mime).toBe("application/pdf");
    expect(sniffKind(bytes(0, 0, 0, 24, "ftypisom"))?.mime).toBe("video/mp4");
    expect(sniffKind(bytes(0, 0, 0, 20, "ftypqt  "))?.mime).toBe("video/quicktime");
  });
  it("refuse anything else, whatever the name says", () => {
    expect(sniffKind(bytes("<svg xmlns='http://www.w3.org/2000/svg'/>"))).toBeNull();
    expect(sniffKind(bytes("<html><script>alert(1)</script>"))).toBeNull();
    expect(sniffKind(bytes("MZ", 0x90, 0))).toBeNull();
    expect(sniffKind(bytes())).toBeNull();
    expect(checkFile("holiday.jpg", bytes("<html>"))).toMatchObject({ ok: false });
  });
  it("only show images and MP4 in the browser; other types are downloads", () => {
    expect(sniffKind(bytes("%PDF-1.7"))?.inline).toBe(false);
    expect(sniffKind(bytes("GIF89a", 1, 0))?.inline).toBe(true);
    expect(sniffKind(bytes(0, 0, 0, 20, "ftypqt  "))?.inline).toBe(false);
  });
});

describe("file checks", () => {
  it("reject empty and oversized files, and accept a good one with a tidy name", () => {
    expect(checkFile("a.png", new Uint8Array())).toMatchObject({ ok: false });
    const big = new Uint8Array(MAX_FILE_BYTES + 1);
    big.set(bytes(0x89, "PNG"));
    expect(checkFile("a.png", big)).toMatchObject({ ok: false });
    expect(checkFile("My Reel.PNG", bytes(0x89, "PNG", 13, 10))).toMatchObject({
      ok: true,
      name: "My Reel.png",
      size: 6,
    });
  });
  it("names lose paths, control characters and the wrong extension", () => {
    const png = sniffKind(bytes(0x89, "PNG"))!;
    expect(safeFileName("C:\\Users\\a\\..\\evil.exe", png)).toBe("evil.png");
    expect(safeFileName('../../etc/pass"wd', png)).toBe("passwd.png");
    expect(safeFileName("", png)).toBe("content.png");
    expect(safeFileName("x".repeat(300) + ".png", png).length).toBeLessThanOrEqual(84);
  });
  it("sizes read well", () => {
    expect(prettySize(900)).toBe("900 B");
    expect(prettySize(2048)).toBe("2 KB");
    expect(prettySize(5.5 * 1024 * 1024)).toBe("5.5 MB");
  });
});

describe("download headers", () => {
  it("forbid sniffing and scripts, and keep the file out of caches", () => {
    const h = downloadHeaders({ name: "é.pdf", mime: "application/pdf", size: 5 }, false);
    expect(h["X-Content-Type-Options"]).toBe("nosniff");
    expect(h["Content-Security-Policy"]).toContain("sandbox");
    expect(h["Content-Disposition"]).toBe('attachment; filename="_.pdf"');
    expect(h["Cache-Control"]).toContain("no-store");
  });
});
