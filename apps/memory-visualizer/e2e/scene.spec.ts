import path from "node:path";

import { expect, test } from "@playwright/test";

import { startVisualizerHarness } from "./helpers/visualizer-harness";

test("scene map renders summaries, heat, and updated metadata", async ({ page }) => {
  const harness = await startVisualizerHarness();

  try {
    await page.goto(harness.baseUrl);
    await page.getByRole("link", { name: /场景图谱 Scene Map/ }).click();

    await expect(page.getByRole("heading", { name: "场景图谱 Scene Map" })).toBeVisible();
    await expect(page.getByText("Scene 聚焦", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Contract design" }).first()).toBeVisible();
    await expect(page.getByText("热度 0.82").first()).toBeVisible();
    await expect(page.getByText("Contract design scene").first()).toBeVisible();
    await expect(page.getByText("contracts.md").first()).toBeVisible();

    await page.screenshot({ path: path.join(harness.repoRoot, ".omo/evidence/task-8-scene-map.png"), fullPage: true });
  } finally {
    await harness.close();
  }
});

test("scene views degrade gracefully when persona is missing", async ({ page }) => {
  const fixtureRoot = path.resolve("apps/memory-visualizer/fixtures/missing-persona");
  const harness = await startVisualizerHarness({
    dataDir: fixtureRoot,
    offloadRootPath: path.join(fixtureRoot, "offload"),
  });

  try {
    await page.goto(harness.baseUrl);

    await expect(page.getByText("Persona 文件不可用")).toBeVisible();
    await expect(page.getByText(/未解析到数据。|未找到 Persona 文件。/).first()).toBeVisible();

    await page.getByRole("link", { name: /场景图谱 Scene Map/ }).click();
    await expect(page.getByRole("heading", { name: "Persona omitted" }).first()).toBeVisible();
    await expect(page.getByText("关联 Persona 状态")).toBeVisible();
    await expect(page.getByText("缺失", { exact: true }).first()).toBeVisible();

    await page.screenshot({ path: path.join(harness.repoRoot, ".omo/evidence/task-8-missing-persona.png"), fullPage: true });
  } finally {
    await harness.close();
  }
});
