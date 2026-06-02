import path from "node:path";

import { expect, test } from "@playwright/test";

import { resolveVisualizerFixturePath, startVisualizerHarness } from "./helpers/visualizer-harness";

test("shell loads all routes and keeps the read-only banner visible", async ({ page }) => {
  const harness = await startVisualizerHarness();

  try {
    const consoleErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });

    await page.goto(harness.baseUrl);
    await expect(page.getByRole("heading", { name: "TencentDB Agent Memory Visualizer" })).toBeVisible();
    await expect(page.getByLabel("只读模式横幅")).toBeVisible();

    for (const routeLabel of [
      "总览",
      "请求监视 Requests Monitor",
      "场景图谱 Scene Map",
      "记忆浏览 Memory Explorer",
      "证据下钻 Evidence Drill-down",
      "任务画布 Offload Task Canvas",
      "调试 Search/Recall Debug",
      "设置 / 状态",
    ]) {
      await page.getByRole("link", { name: new RegExp(routeLabel) }).click();
      await expect(page.getByRole("heading", { name: routeLabel, exact: true })).toBeVisible();
      await expect(page.getByLabel("只读模式横幅")).toBeVisible();
    }

    expect(consoleErrors.some((message) => message.includes("Unhandled"))).toBe(false);
    await page.screenshot({ path: path.join(harness.repoRoot, ".omo/evidence/task-7-ui-shell.png"), fullPage: true });
  } finally {
    await harness.close();
  }
});

test("shell shows missing-data warnings without losing navigation", async ({ page }) => {
  const harness = await startVisualizerHarness({
    dataDir: path.join(harnesslessFixtureRoot(), "does-not-exist"),
    offloadRootPath: path.join(harnesslessFixtureRoot(), "does-not-exist", "offload"),
  });

  try {
    await page.goto(harness.baseUrl);
    await expect(page.getByRole("heading", { name: "总览" })).toBeVisible();
    await expect(page.getByText("检测到能力降级")).toBeVisible();
    await expect(page.getByText("data-dir-missing", { exact: true }).first()).toBeVisible();

    await page.getByRole("link", { name: /场景图谱 Scene Map/ }).click();
    await expect(page.getByText("没有可用的 Scene Map")).toBeVisible();
    await expect(page.getByLabel("只读模式横幅")).toBeVisible();

    await page.screenshot({ path: path.join(harness.repoRoot, ".omo/evidence/task-7-missing-data.png"), fullPage: true });
  } finally {
    await harness.close();
  }
});

function harnesslessFixtureRoot(): string {
  return resolveVisualizerFixturePath("complete-data-dir");
}
