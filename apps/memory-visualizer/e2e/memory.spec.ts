import path from "node:path";

import { expect, test } from "@playwright/test";

import { startVisualizerHarness } from "./helpers/visualizer-harness";

test("memory filters narrow persona records and update visible summaries", async ({ page }) => {
  const harness = await startVisualizerHarness();

  try {
    await page.goto(harness.baseUrl);
    await page.getByRole("link", { name: /记忆浏览 Memory Explorer/ }).click();
    await expect(page.locator('select[aria-label="Type 类型"]')).toBeVisible();

    await page.locator('select[aria-label="Type 类型"]').selectOption("persona");
    await page.getByLabel("最低优先级").fill("80");

    await expect(page.getByText("The user prefers deterministic fixtures with explicit IDs.")).toBeVisible();
    await expect(page.getByText("The user values read-only visual debugging surfaces over mutation controls.")).toBeVisible();
    await expect(page.getByText("Visualizer contracts stay app-local.")).toHaveCount(0);
    await expect(page.getByText("Type 分布")).toBeVisible();
    await expect(page.getByText("80-89 高")).toBeVisible();
    await expect(page.getByText("90-100 严重")).toBeVisible();

    await page.screenshot({ path: path.join(harness.repoRoot, ".omo/evidence/task-9-memory-filters.png"), fullPage: true });
  } finally {
    await harness.close();
  }
});

test("memory evidence drill-down warns when source evidence is missing", async ({ page }) => {
  const fixtureRoot = path.resolve("apps/memory-visualizer/fixtures/missing-evidence");
  const harness = await startVisualizerHarness({
    dataDir: fixtureRoot,
    offloadRootPath: path.join(fixtureRoot, "offload"),
  });

  try {
    await page.goto(harness.baseUrl);
    await page.getByRole("link", { name: /证据下钻 Evidence Drill-down/ }).click();

    await expect(page.getByText("缺少源 Evidence")).toBeVisible();
    await expect(page.getByText("l0:message:missing-404").first()).toBeVisible();
    await expect(page.getByText("The user prefers missing-evidence warnings to be explicit and non-fatal.").first()).toBeVisible();

    await page.screenshot({ path: path.join(harness.repoRoot, ".omo/evidence/task-9-missing-evidence.png"), fullPage: true });
  } finally {
    await harness.close();
  }
});
