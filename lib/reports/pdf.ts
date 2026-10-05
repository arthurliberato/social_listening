// Report → PDF with pdfkit: headings, a one-line summary, a small chart where it helps, and the table.
import PDFDocument from "pdfkit";
import type { TableModel } from "@/lib/charts/tables";

export interface PdfSection {
  title: string;
  summary: string;
  table: TableModel | null;
  /** Bars for the small chart (label, value). */
  bars?: { label: string; value: number }[];
  error?: string;
}

const CP1252_EXTRA = new Set("€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ");
const MAP: Record<string, string> = {
  "≥": ">=",
  "≤": "<=",
  "−": "-",
  "→": "->",
  "←": "<-",
  "▾": "v",
  "✓": "ok",
  "⚡": "!",
  "●": "*",
};

/** The built-in PDF fonts only cover Latin-1 and a few extras; anything else becomes "?". */
export function pdfSafe(s: string): string {
  let out = "";
  for (const ch of s) {
    if (MAP[ch]) out += MAP[ch];
    else if (ch.charCodeAt(0) <= 0xff || CP1252_EXTRA.has(ch)) out += ch;
    else out += "?";
  }
  return out;
}

const INK = "#1b2430";
const MUTED = "#5b6472";
const HAIRLINE = "#d9dde3";
const BAR = "#2a78d6";
const MAX_ROWS = 14;

export function renderReportPdf(r: {
  title: string;
  workspace: string;
  period: string;
  generatedAt: Date;
  sections: PdfSection[];
  /** White-label: shown instead of "Ripplewise" in the footer, with an accent bar and optional footer text. */
  brand?: { name: string; accent: string; footer: string; hidePoweredBy: boolean };
}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margin: 48,
      bufferPages: true,
      info: {
        Title: pdfSafe(r.title),
        Author: r.brand?.name || "Ripplewise",
        Creator: r.brand?.name || "Ripplewise",
      },
    });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const left = doc.page.margins.left;
    const width = doc.page.width - left - doc.page.margins.right;
    const bottom = () => doc.page.height - doc.page.margins.bottom - 20;
    const room = (h: number) => {
      if (doc.y + h > bottom()) doc.addPage();
    };

    doc
      .fillColor(INK)
      .font("Helvetica-Bold")
      .fontSize(22)
      .text(pdfSafe(r.title), left, doc.y, { width });
    doc
      .moveDown(0.2)
      .font("Helvetica")
      .fontSize(10)
      .fillColor(MUTED)
      .text(
        pdfSafe(
          `${r.workspace}  ·  ${r.period}  ·  Generated ${r.generatedAt.toISOString().slice(0, 16).replace("T", " ")} UTC`,
        ),
        { width },
      );
    doc.moveDown(1);

    for (const s of r.sections) {
      room(80);
      doc
        .fillColor(INK)
        .font("Helvetica-Bold")
        .fontSize(14)
        .text(pdfSafe(s.title), left, doc.y, { width });
      doc.moveDown(0.2);
      if (s.error || !s.table) {
        doc
          .font("Helvetica")
          .fontSize(10)
          .fillColor(MUTED)
          .text(pdfSafe(s.error ?? "This section could not be loaded."), { width });
        doc.moveDown(1);
        continue;
      }
      if (s.summary)
        doc.font("Helvetica").fontSize(10).fillColor(MUTED).text(pdfSafe(s.summary), { width });
      doc.moveDown(0.4);

      if (s.bars?.length) {
        const bars = s.bars.slice(0, 31);
        const h = 70;
        room(h + 24);
        const top = doc.y;
        const max = Math.max(...bars.map((b) => b.value), 1);
        const gap = 2;
        const bw = Math.max(2, (width - gap * (bars.length - 1)) / bars.length);
        doc.save();
        bars.forEach((b, i) => {
          const bh = Math.max(1, (b.value / max) * h);
          doc.rect(left + i * (bw + gap), top + h - bh, bw, bh).fill(BAR);
        });
        doc.restore();
        doc
          .moveTo(left, top + h)
          .lineTo(left + width, top + h)
          .lineWidth(0.5)
          .strokeColor(HAIRLINE)
          .stroke();
        doc.font("Helvetica").fontSize(8).fillColor(MUTED);
        doc.text(pdfSafe(bars[0]!.label), left, top + h + 3, {
          width: width / 2,
          lineBreak: false,
        });
        doc.text(pdfSafe(bars[bars.length - 1]!.label), left + width / 2, top + h + 3, {
          width: width / 2,
          align: "right",
          lineBreak: false,
        });
        doc.y = top + h + 18;
      }

      const t = s.table;
      const cols = t.columns.length;
      const cw = width / cols;
      const rowH = 16;
      const drawRow = (cells: (string | number)[], head: boolean) => {
        room(rowH + 4);
        const y = doc.y;
        doc
          .font(head ? "Helvetica-Bold" : "Helvetica")
          .fontSize(9)
          .fillColor(head ? INK : INK);
        cells.forEach((c, i) =>
          doc.text(pdfSafe(String(c)), left + i * cw + 2, y + 3, {
            width: cw - 6,
            height: rowH - 4,
            ellipsis: true,
            lineBreak: false,
            align: t.numeric[i] ? "right" : "left",
          }),
        );
        doc
          .moveTo(left, y + rowH)
          .lineTo(left + width, y + rowH)
          .lineWidth(0.5)
          .strokeColor(HAIRLINE)
          .stroke();
        doc.y = y + rowH;
      };
      drawRow(t.columns, true);
      for (const row of t.rows.slice(0, MAX_ROWS)) drawRow(row, false);
      if (t.rows.length > MAX_ROWS) {
        doc
          .moveDown(0.3)
          .font("Helvetica-Oblique")
          .fontSize(8)
          .fillColor(MUTED)
          .text(
            pdfSafe(
              `...and ${t.rows.length - MAX_ROWS} more rows. Export the CSV for the full table.`,
            ),
            left,
            doc.y,
            { width },
          );
      }
      doc.moveDown(1.2);
    }

    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(i);
      doc.font("Helvetica").fontSize(8).fillColor(MUTED);
      doc.text(
        pdfSafe(
          [
            r.brand?.footer,
            r.brand?.hidePoweredBy
              ? r.brand?.name
              : r.brand?.name
                ? `${r.brand.name}  ·  Powered by Ripplewise`
                : "Ripplewise",
          ]
            .filter(Boolean)
            .join("  ·  ") + `  ·  Page ${i + 1} of ${range.count}`,
        ),
        left,
        doc.page.height - 36,
        {
          width,
          align: "center",
          lineBreak: false,
        },
      );
    }
    doc.end();
  });
}
