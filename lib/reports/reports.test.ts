import { describe, expect, it } from "vitest";
import { reportCsv } from "./csv";
import { pdfSafe, renderReportPdf } from "./pdf";
import { describeSchedule, nextRun, type When } from "./schedule";
import { REPORT_TEMPLATES } from "./templates";
import { SectionsSchema } from "./types";

const d = (s: string) => new Date(s);
const base: When = { frequency: "weekly", weekday: 1, dayOfMonth: 1, hourUtc: 8 };

describe("nextRun", () => {
  it("daily: later today if the hour is ahead, otherwise tomorrow", () => {
    const w = { ...base, frequency: "daily" as const };
    expect(nextRun(d("2026-10-03T06:00:00Z"), w).toISOString()).toBe("2026-10-03T08:00:00.000Z");
    expect(nextRun(d("2026-10-03T08:00:00Z"), w).toISOString()).toBe("2026-10-04T08:00:00.000Z"); // strictly after
    expect(nextRun(d("2026-10-03T23:59:00Z"), w).toISOString()).toBe("2026-10-04T08:00:00.000Z");
  });
  it("weekly: the next requested weekday, a full week later when it is already past", () => {
    // 2026-10-03 is a Saturday.
    expect(nextRun(d("2026-10-03T12:00:00Z"), base).toISOString()).toBe("2026-10-05T08:00:00.000Z"); // Monday
    expect(nextRun(d("2026-10-05T07:00:00Z"), base).toISOString()).toBe("2026-10-05T08:00:00.000Z"); // same day, ahead
    expect(nextRun(d("2026-10-05T09:00:00Z"), base).toISOString()).toBe("2026-10-12T08:00:00.000Z"); // same day, past
    expect(nextRun(d("2026-10-03T12:00:00Z"), { ...base, weekday: 6 }).toISOString()).toBe(
      "2026-10-10T08:00:00.000Z",
    );
  });
  it("monthly: this month if ahead, rolls over the year end", () => {
    const w = { ...base, frequency: "monthly" as const, dayOfMonth: 15 };
    expect(nextRun(d("2026-10-03T00:00:00Z"), w).toISOString()).toBe("2026-10-15T08:00:00.000Z");
    expect(nextRun(d("2026-12-20T00:00:00Z"), w).toISOString()).toBe("2027-01-15T08:00:00.000Z");
  });
  it("describes schedules in words", () => {
    expect(describeSchedule(base)).toBe("Every Monday at 08:00 UTC");
    expect(describeSchedule({ ...base, frequency: "monthly", dayOfMonth: 22, hourUtc: 17 })).toBe(
      "On the 22nd of every month at 17:00 UTC",
    );
    expect(describeSchedule({ ...base, frequency: "daily", hourUtc: 6 })).toBe(
      "Every day at 06:00 UTC",
    );
  });
});

describe("templates", () => {
  it("every template's sections are valid", () => {
    for (const t of REPORT_TEMPLATES) {
      const r = SectionsSchema.safeParse(t.sections.map((s, i) => ({ ...s, id: `s${i}` })));
      expect(r.success, t.id).toBe(true);
    }
  });
});

describe("csv", () => {
  it("stacks sections, escapes quotes and neutralises formulas", () => {
    const csv = reportCsv("Weekly", "2026-09-26 to 2026-10-03", [
      {
        title: "Top authors",
        table: {
          caption: "",
          columns: ["Author", "Mentions"],
          rows: [['=cmd|"x"', 3]],
          numeric: [false, true],
        },
      },
      { title: "Broken", table: null },
    ]);
    expect(csv).toContain('"Report","Weekly"');
    expect(csv).toContain(`"'=cmd|""x""","3"`);
    expect(csv).toContain("could not be loaded");
  });
});

describe("pdf", () => {
  it("renders a valid multi-page PDF, even with non-Latin text", async () => {
    const rows = Array.from({ length: 40 }, (_, i) => [`Author ${i} ≥ 5 → “quoted” 日本`, i * 100]);
    const buf = await renderReportPdf({
      title: "Weekly brand summary",
      workspace: "Acme",
      period: "Last 7 days",
      generatedAt: d("2026-10-03T12:00:00Z"),
      sections: Array.from({ length: 6 }, (_, i) => ({
        title: `Section ${i}`,
        summary: "Mentions per day: 1,204 total.",
        bars: Array.from({ length: 30 }, (_, k) => ({ label: `d${k}`, value: (k * 7) % 11 })),
        table: { caption: "", columns: ["Author", "Mentions"], rows, numeric: [false, true] },
      })),
    });
    expect(buf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(buf.subarray(-6).toString()).toContain("%%EOF");
    expect(buf.length).toBeGreaterThan(5_000);
    expect((buf.toString("latin1").match(/\/Type \/Page\b/g) ?? []).length).toBeGreaterThan(1);
  });
  it("maps unsupported characters instead of crashing", () => {
    expect(pdfSafe("≥ 5 → ok 日本")).toBe(">= 5 -> ok ??");
  });
});
