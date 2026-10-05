// The action layer: what an agent can do on the platform, each action driving the real UI (spec 5). Nothing here
// reads the database or calls a hidden endpoint; an agent sees only what a person at the screen would.
import type { BrowserContext, Page } from "@playwright/test";
import type { SampleMention } from "./types";

const num = (s: string) => Number(s.replace(/[^0-9]/g, ""));

export class Workspace {
  constructor(
    readonly page: Page,
    readonly baseUrl: string,
    private slug = "",
  ) {}

  static async open(context: BrowserContext, baseUrl: string) {
    return new Workspace(await context.newPage(), baseUrl);
  }

  private async go(path: string) {
    await this.page.goto(`${this.baseUrl}${path}`);
    // A production build paints buttons before React attaches; clicks in that gap are lost.
    await this.page.waitForLoadState("networkidle");
  }

  async login(email: string, password: string): Promise<{ slug: string }> {
    await this.go("/login");
    await this.page.getByTestId("login-email").fill(email);
    await this.page.getByTestId("login-password").fill(password);
    await this.page.getByTestId("login-submit").click();
    await this.page.waitForURL(/\/w\/[^/]+\//, { timeout: 30_000 });
    this.slug = new URL(this.page.url()).pathname.split("/")[2]!;
    await this.page.waitForLoadState("networkidle");
    return { slug: this.slug };
  }

  /** create_query: the advanced editor, because that is where Boolean text goes. */
  async createQuery(
    name: string,
    text: string,
    onPreview?: () => Promise<void>,
  ): Promise<{ queryId: string; previewCount: number; noise: string }> {
    await this.go(`/w/${this.slug}/queries/new`);
    await this.page.getByTestId("mode-advanced").click();
    const editor = this.page.getByTestId("advanced-editor-content");
    await editor.click();
    await this.page.keyboard.type(text);
    await this.page.getByTestId("query-name").fill(name);
    const preview = await this.readPreview();
    await onPreview?.();
    await this.page.getByTestId("save-query").click();
    await this.page.waitForURL(/\/queries\?saved=/, { timeout: 30_000 });
    const href = await this.page
      .getByTestId("query-row")
      .filter({ hasText: name })
      .first()
      .locator("a")
      .first()
      .getAttribute("href");
    return { queryId: href!.split("/").pop()!, ...preview };
  }

  /** What is on screen right now, as a JPEG: the agent's eyes (spec 6, a vision-enabled agent). */
  async screenshot(): Promise<Buffer> {
    await this.page.waitForTimeout(300); // let charts and transitions settle
    return this.page.screenshot({ type: "jpeg", quality: 70 });
  }

  /** The tags and categories page, for looking at. */
  async openTags(): Promise<void> {
    await this.go(`/w/${this.slug}/tags`);
  }

  /** preview_query: the live count and noise estimate beside the editor. */
  private async readPreview() {
    await this.page.getByTestId("preview-count").waitFor({ timeout: 15_000 });
    await this.page.waitForTimeout(600); // the preview is debounced
    const previewCount = num(await this.page.getByTestId("preview-count").innerText());
    const noise = (
      await this.page
        .getByTestId("preview-noise")
        .innerText()
        .catch(() => "")
    ).trim();
    return { previewCount, noise };
  }

  /** edit_query: replace the text of an existing query and save it. */
  async editQuery(queryId: string, text: string): Promise<{ previewCount: number; noise: string }> {
    await this.go(`/w/${this.slug}/queries/${queryId}`);
    const editor = this.page.getByTestId("advanced-editor-content");
    await editor.click();
    await this.page.keyboard.press("Control+a");
    await this.page.keyboard.type(text);
    const preview = await this.readPreview();
    await this.page.getByTestId("save-query").click();
    await this.page.waitForURL(/\/queries\?saved=/, { timeout: 30_000 });
    return preview;
  }

  async waitCollected(name: string): Promise<void> {
    const row = () => this.page.getByTestId("query-row").filter({ hasText: name }).first();
    for (let i = 0; i < 60; i++) {
      await this.go(`/w/${this.slug}/queries`);
      const status = (
        await row()
          .getByTestId("query-backfill")
          .innerText()
          .catch(() => "")
      ).trim();
      if (/Up to date|limit reached/.test(status)) return;
      await this.page.waitForTimeout(1500);
    }
    throw new Error(`query "${name}" did not finish collecting`);
  }

  /** open_mentions: the feed for one query, newest first; reads what is on screen, up to `n` cards. */
  async openMentions(
    queryId: string,
    o: { windowDays: number; sentiment?: string; n?: number } = { windowDays: 30 },
  ): Promise<{ total: number; sample: SampleMention[] }> {
    const p = new URLSearchParams({ q: queryId, range: `${o.windowDays}d` });
    if (o.sentiment) p.set("sentiment", o.sentiment);
    await this.go(`/w/${this.slug}/mentions?${p}`);
    await this.page
      .waitForFunction(
        () =>
          document.querySelector('[data-testid="mention-card"]') ||
          document.querySelector('[data-testid="feed-empty"]'),
        null,
        { timeout: 30_000 },
      )
      .catch(() => {});
    const total = num(await this.page.getByTestId("result-count").innerText());
    const cards = await this.page.getByTestId("mention-card").evaluateAll((els) =>
      els.map((e) => ({
        id: Number(e.getAttribute("data-id")),
        text:
          (e.querySelector('[data-testid="mention-text"]') as HTMLElement | null)?.innerText ?? "",
        sentiment: e.querySelector("[data-sentiment]")?.getAttribute("data-sentiment") ?? "",
      })),
    );
    return { total, sample: cards.slice(0, o.n ?? 50) };
  }

  /** override_sentiment: select the card, then s + n/p/u, the same keys a person would press. */
  async overrideSentiment(id: number, label: "positive" | "negative" | "neutral"): Promise<void> {
    const card = this.page.locator(`[data-testid="mention-card"][data-id="${id}"]`);
    await card.getByTestId("select-mention").check();
    await this.page.keyboard.press("s");
    await this.page.keyboard.press({ positive: "p", negative: "n", neutral: "u" }[label]);
    await this.page.waitForTimeout(400);
    await card
      .getByTestId("select-mention")
      .uncheck()
      .catch(() => {});
  }

  /** create_category: a named search on Tags & Categories; returns how many mentions it covers. */
  async createCategory(name: string, search: string): Promise<number | null> {
    await this.go(`/w/${this.slug}/tags`);
    await this.page.getByTestId("category-name").fill(name);
    await this.page.getByTestId("category-text").fill(search);
    await this.page.getByTestId("category-save").click();
    const row = this.page.getByTestId("category-row").filter({ hasText: name });
    await row.waitFor({ timeout: 15_000 }).catch(() => {});
    if (!(await row.count())) return null;
    return num(await row.getByTestId("category-total").innerText());
  }
}
