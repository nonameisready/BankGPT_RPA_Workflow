import type { Frame, FrameLocator, Locator, Page } from "playwright";
import type { LocatorStrategy, Target } from "../actions/action-schema.js";

type Source = Page | Frame | FrameLocator;

export interface LocatorResolution {
  locator: Locator;
  targetId: string;
  strategyIndex: number;
  strategyKind: LocatorStrategy["kind"];
}

function sourcesFor(page: Page, target: Target): Source[] {
  if (!target.frame) return [page, ...page.frames().filter((frame) => frame !== page.mainFrame())];
  const frameTitle = JSON.stringify(target.frame);
  return [page.frameLocator(`iframe[title=${frameTitle}], iframe[name=${frameTitle}]`)];
}

async function candidate(source: Source, strategy: LocatorStrategy): Promise<Locator | null> {
  switch (strategy.kind) {
    case "role":
      return source.getByRole(strategy.role as Parameters<Page["getByRole"]>[0], { ...(strategy.name ? { name: strategy.name } : {}), ...(strategy.exact === undefined ? {} : { exact: strategy.exact }) });
    case "label":
      return source.getByLabel(strategy.value, strategy.exact === undefined ? {} : { exact: strategy.exact });
    case "text":
      return source.getByText(strategy.value, strategy.exact === undefined ? {} : { exact: strategy.exact });
    case "css":
      return source.locator(strategy.value);
    case "name":
      return source.locator(`[name=${JSON.stringify(strategy.value)}]`);
    case "placeholder":
      return source.getByPlaceholder(strategy.value, strategy.exact === undefined ? {} : { exact: strategy.exact });
    case "text_near": {
      const anchor = source.getByText(strategy.text, { exact: true });
      const selector = strategy.selector ?? "input, button, select, textarea, a";
      if (strategy.relation === "within") return anchor.locator(selector);
      return anchor.locator(`xpath=${strategy.relation === "after" ? "following" : "preceding"}::${selector.split(",")[0]?.trim() ?? "input"}[1]`);
    }
    case "table_cell": {
      const tables = source.getByRole("table");
      const count = await tables.count();
      for (let tableIndex = 0; tableIndex < count; tableIndex++) {
        const table = tables.nth(tableIndex);
        const headers = (await table.getByRole("columnheader").allTextContents()).map((value) => value.trim());
        const columnIndex = headers.findIndex((value) => value === strategy.column_header);
        if (columnIndex < 0) continue;
        const row = table.getByRole("row").filter({ hasText: strategy.row_text });
        if (await row.count() !== 1) continue;
        return row.getByRole("cell").nth(columnIndex);
      }
      return null;
    }
  }
}

/** Tries strategies in artifact order. Ambiguous matches never silently pick the first. */
export async function resolveLocator(page: Page, target: Target, timeoutMs = 2_000): Promise<LocatorResolution | null> {
  const sources = sourcesFor(page, target);
  for (const [strategyIndex, strategy] of target.strategies.entries()) {
    const matches: Locator[] = [];
    for (const source of sources) {
      try {
        const locator = await candidate(source, strategy);
        if (!locator) continue;
        await locator.waitFor({ state: "visible", timeout: timeoutMs });
        if (await locator.count() === 1) matches.push(locator);
      } catch {
        // Search the next frame or explicit strategy, never silently choose.
      }
    }
    if (matches.length === 1) return { locator: matches[0]!, targetId: target.id, strategyIndex, strategyKind: strategy.kind };
  }
  return null;
}
