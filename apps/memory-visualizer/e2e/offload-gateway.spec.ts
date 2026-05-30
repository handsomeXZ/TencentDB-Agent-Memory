import path from "node:path";

import { expect, test } from "@playwright/test";

import { startVisualizerHarness } from "./helpers/visualizer-harness";

test("offload invalid Mermaid falls back safely in browser", async ({ page }) => {
  const fixtureRoot = path.resolve("apps/memory-visualizer/fixtures/offload-invalid-mermaid");
  const harness = await startVisualizerHarness({
    dataDir: fixtureRoot,
    offloadRootPath: path.join(fixtureRoot, "offload"),
  });

  try {
    await page.goto(harness.baseUrl);
    await page.getByRole("link", { name: /任务画布 Offload Task Canvas/ }).click();
    await expect(page.getByRole("heading", { name: "画布渲染与回退" })).toBeVisible();
    await expect(page.getByText("Mermaid 回退内容无效")).toBeVisible();
    await expect(page.getByText("原始回退预览")).toBeVisible();
    await expect(page.locator(".json-hint").filter({ hasText: "this is not mermaid syntax node without graph header" }).last()).toBeVisible();
    await page.screenshot({ path: path.join(harness.repoRoot, ".omo/evidence/task-10-invalid-mermaid.png"), fullPage: true });
  } finally {
    await harness.close();
  }
});

test("gateway debug shows raw search string and safe endpoints only", async ({ page }) => {
  const gatewayCalls: string[] = [];
  const harness = await startVisualizerHarness({
    gatewayBaseUrl: "http://gateway.test",
    gatewayFetch: async (input) => {
      const url = new URL(input.toString());
      gatewayCalls.push(url.pathname);
      if (url.pathname === "/health") {
        return {
          ok: true,
          status: 200,
          statusText: "200",
          headers: new Headers({ "content-type": "application/json" }),
          text: async () => JSON.stringify({ status: "ok", version: "playwright", uptime: 11, stores: { vectorStore: true, embeddingService: false } }),
        };
      }
      if (url.pathname === "/search/memories") {
        return {
          ok: true,
          status: 200,
          statusText: "200",
          headers: new Headers({ "content-type": "application/json" }),
          text: async () => JSON.stringify({ results: "# Raw memory result\n- workspace", total: 1, strategy: "hybrid" }),
        };
      }
      if (url.pathname === "/recall") {
        return {
          ok: true,
          status: 200,
          statusText: "200",
          headers: new Headers({ "content-type": "application/json" }),
          text: async () => JSON.stringify({ context: "remember workspace", strategy: "hybrid", memory_count: 1 }),
        };
      }
      if (url.pathname === "/search/conversations") {
        return {
          ok: true,
          status: 200,
          statusText: "200",
          headers: new Headers({ "content-type": "application/json" }),
          text: async () => JSON.stringify({ results: "user: workspace", total: 1 }),
        };
      }
      return {
        ok: false,
        status: 404,
        statusText: "404",
        headers: new Headers({ "content-type": "application/json" }),
        text: async () => JSON.stringify({ error: "unexpected endpoint" }),
      };
    },
  });

  try {
    await page.goto(harness.baseUrl);
    await page.getByRole("link", { name: /调试 Search\/Recall Debug/ }).click();
    await expect(page.getByRole("heading", { name: "健康状态与安全端点范围" })).toBeVisible();
    await page.getByLabel("Memory 搜索查询").fill("workspace");
    await page.getByRole("button", { name: "运行 Memory 搜索" }).click();
    await expect(page.getByText("`/search/*` 主响应保持原样")).toBeVisible();
    await expect(page.locator(".json-hint").filter({ hasText: "# Raw memory result" }).last()).toBeVisible();
    expect(gatewayCalls.every((pathname) => ["/health", "/search/memories", "/recall", "/search/conversations"].includes(pathname))).toBeTruthy();
    expect(gatewayCalls.some((pathname) => pathname === "/search/memories")).toBeTruthy();
    await page.screenshot({ path: path.join(harness.repoRoot, ".omo/evidence/task-10-search-debug.png"), fullPage: true });
  } finally {
    await harness.close();
  }
});
