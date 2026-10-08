// What an influencer-marketing agent can do on the platform, each action driving the real screens: filter the
// directory, read the table, shortlist, build a campaign, send invitations. Nothing here reads the database or calls a
// hidden endpoint.
import type { Workspace } from "../workspace";
import { parseRow, type RawRow } from "./parse";
import type { Candidate } from "./types";

export class CreatorsUi {
  constructor(private readonly ws: Workspace) {}
  private get page() {
    return this.ws.page;
  }
  private get base() {
    return `${this.ws.baseUrl}/w/${this.ws.slug}/creators`;
  }
  private async settle() {
    // A production build paints controls before React attaches; clicks in that gap are lost.
    await this.page.waitForLoadState("networkidle");
  }

  /** Open Discover and apply the filters this person knows how to use. */
  async search(f: {
    platform: string | null;
    niche: string | null;
    minAuthenticity?: number;
    brandSafeOnly?: boolean;
  }): Promise<{ matches: number }> {
    await this.page.goto(this.base);
    await this.settle();
    const form = this.page.getByTestId("creator-filters");
    const details = form.locator("details");
    if (!(await details.evaluate((d) => (d as HTMLDetailsElement).open)))
      await form.getByText("More filters").click();
    if (f.platform) await form.getByLabel(f.platform, { exact: true }).check();
    if (f.niche) await form.getByLabel(f.niche, { exact: true }).check();
    if (f.minAuthenticity)
      await form.getByLabel("Min. authenticity").fill(String(f.minAuthenticity));
    if (f.brandSafeOnly) await form.getByLabel("Brand-safe only").check();
    await this.page.getByTestId("creator-apply").click();
    await this.page.waitForURL(/creators\?/);
    await this.settle();
    return { matches: await this.matchCount() };
  }

  async matchCount(): Promise<number> {
    const t = await this.page.getByTestId("creator-count").innerText();
    return Number(/^[\d,]+/.exec(t)?.[0]?.replace(/,/g, "") ?? 0);
  }

  /** The platform and niche names the product offers, read from the filter form like a person would. */
  async filterOptions(): Promise<{ platforms: string[]; niches: string[] }> {
    await this.page.goto(this.base);
    await this.settle();
    const form = this.page.getByTestId("creator-filters");
    if (!(await form.locator("details").evaluate((d) => (d as HTMLDetailsElement).open)))
      await form.getByText("More filters").click();
    const names = async (n: string) =>
      form
        .locator(`input[name="${n}"]`)
        .evaluateAll((els) =>
          els.map((e) => (e as HTMLInputElement).closest("label")?.textContent?.trim() ?? ""),
        );
    return { platforms: await names("platform"), niches: await names("niche") };
  }

  /** The rows on this page as the agent reads them. */
  async readPage(readsAuthenticity: boolean): Promise<Candidate[]> {
    const raw: RawRow[] = await this.page.getByTestId("creator-row").evaluateAll((rows) =>
      rows.map((r) => {
        const link = r.querySelector('[data-testid="creator-link"]') as HTMLAnchorElement;
        const th = r.querySelector("th");
        return {
          href: link?.getAttribute("href") ?? "",
          name: link?.textContent?.trim() ?? "",
          handleLine: th?.querySelector(".text-xs:last-child")?.textContent?.trim() ?? "",
          cells: [...r.querySelectorAll("td")].map((td) => td.textContent?.trim() ?? ""),
        };
      }),
    );
    return raw.map((r) => parseRow(r, readsAuthenticity)).filter((c): c is Candidate => !!c);
  }

  /** Go to the next page of results, if there is one. */
  async nextPage(): Promise<boolean> {
    const next = this.page.getByTestId("creator-next");
    if (!(await next.count())) return false;
    // Open the link's address rather than clicking it: in a headless production build the click on "Next" starts the
    // router's request and then cancels it (see docs/agents.md, known issue), while the address loads normally.
    const href = await next.getAttribute("href");
    if (!href) return false;
    await this.page.goto(new URL(href, this.ws.baseUrl).toString());
    await this.settle();
    return true;
  }

  /** Put creators on a shortlist, made on the first add. Each is added from their own profile, wherever they were listed. */
  async shortlist(ids: number[], listName: string): Promise<number> {
    let added = 0;
    for (const [i, id] of ids.entries()) {
      // The row may be on another page than the one we are on: open the creator's profile and add from there.
      await this.page.goto(`${this.base}/${id}`);
      await this.settle();
      await this.page.getByTestId("add-to-list").click();
      if (i === 0) await this.page.getByTestId("new-list-name").fill(listName);
      else await this.page.getByLabel(listName).check();
      await this.page.getByTestId("add-to-list-confirm").click();
      await this.page.getByTestId("add-to-list-status").waitFor({ state: "attached" });
      await this.page
        .getByTestId("add-to-list-status")
        .filter({ hasText: /Added|already/ })
        .waitFor({ timeout: 15_000 });
      added++;
    }
    return added;
  }

  async createCampaign(name: string, budgetUsd: number, listName: string): Promise<string> {
    await this.page.goto(`${this.base}/campaigns`);
    await this.settle();
    await this.page.getByTestId("campaign-name").fill(name);
    await this.page.getByTestId("campaign-budget").fill(String(budgetUsd));
    await this.page.getByTestId("campaign-create").click();
    await this.page.waitForURL(/campaigns\/[0-9a-f-]{36}/);
    await this.settle();
    // Pick the shortlist by name, since a workspace can hold several lists.
    const select = this.page.getByTestId("add-from-list").locator("select");
    const labels = await select.locator("option").allTextContents();
    const mine = labels.find((l) => l.startsWith(listName));
    if (mine) await select.selectOption({ label: mine });
    await this.page.getByTestId("add-from-list-submit").click();
    await this.page.getByTestId("roster-row").first().waitFor({ timeout: 15_000 });
    return new URL(this.page.url()).pathname.split("/").pop()!;
  }

  /** The roster rows by creator name, so an invitation goes to the creator that was meant. */
  async invite(creatorName: string, offerUsd: number, message?: string): Promise<boolean> {
    const row = this.page.getByTestId("roster-row").filter({ hasText: creatorName }).first();
    await row.getByTestId("invite-open").click();
    await row.getByTestId("invite-offer").fill(String(offerUsd));
    if (message) await row.getByTestId("invite-message").fill(message);
    await row.getByTestId("invite-send").click();
    await row
      .getByTestId("roster-status")
      .filter({ hasText: "Invited" })
      .waitFor({ timeout: 20_000 });
    return true;
  }
}
