import path from "node:path";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";

import { expect, test } from "@playwright/test";

import { startVisualizerHarness } from "./helpers/visualizer-harness";

test("requests monitor renders metrics, row drawer, and screenshot evidence", async ({ page }) => {
  const telemetryDir = await seedTelemetryFixture();
  const harness = await startVisualizerHarness({ telemetryDir });

  try {
    await page.goto(harness.baseUrl);
    await page.getByRole("link", { name: /请求监视 Requests Monitor/ }).click();

    await expect(page.getByRole("heading", { name: "请求监视 Requests Monitor", exact: true })).toBeVisible();
    await expect(page.getByText("紧凑请求表")).toBeVisible();
    await expect(page.locator('[data-request-id="gateway-01"]')).toBeVisible();
    await expect(page.locator('[data-request-id="visualizer-01"]')).toBeVisible();
    await expect(page.getByText("/recall").first()).toBeVisible();
    await expect(page.getByText("/api/memories").first()).toBeVisible();

    await page.locator('[data-request-id="gateway-01"]').click();

    await expect(page.getByText("请求详情")).toBeVisible();
    await expect(page.getByText("Query Keys")).toBeVisible();
    await expect(page.getByText("server-error")).toBeVisible();
    await expect(page.getByText("raw-secret-token")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /retry|replay|delete|export|edit|capture|seed|session-end|session\/end/i })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /retry|replay|delete|export|edit|capture|seed|session-end|session\/end/i })).toHaveCount(0);

    await page.screenshot({ path: path.join(harness.repoRoot, ".omo/evidence/task-10-requests-monitor.png"), fullPage: true });
  } finally {
    await harness.close();
  }
});

test("requests monitor renders empty telemetry warnings", async ({ page }) => {
  const telemetryDir = await seedEmptyTelemetryFixture();
  const harness = await startVisualizerHarness({ telemetryDir });

  try {
    await page.goto(`${harness.baseUrl}/requests-monitor`);

    await expect(page.getByText("当前窗口没有请求记录")).toBeVisible();
    await expect(page.getByText("telemetry-file-missing").first()).toBeVisible();
    await expect(page.getByText("当前汇总窗口还没有足够的安全请求样本")).toBeVisible();
  } finally {
    await harness.close();
  }
});

test("requests monitor renders corrupt telemetry warnings without unsafe fields", async ({ page }) => {
  const telemetryDir = await seedCorruptTelemetryFixture();
  const harness = await startVisualizerHarness({ telemetryDir });

  try {
    await page.goto(`${harness.baseUrl}/requests-monitor`);

    await expect(page.getByText("telemetry-line-corrupt")).toBeVisible();
    await expect(page.locator('[data-request-id="gateway-corrupt-tail"]')).toBeVisible();
    await page.locator('[data-request-id="gateway-corrupt-tail"]').click();
    await expect(page.getByText("secret-token")).toHaveCount(0);
    await expect(page.getByText("secret-cookie")).toHaveCount(0);
    await expect(page.getByText("my-secret-password")).toHaveCount(0);
  } finally {
    await harness.close();
  }
});

async function seedTelemetryFixture(): Promise<string> {
  const telemetryDir = await mkdtemp(path.join(tmpdir(), "tdai-requests-monitor-"));
  await mkdir(telemetryDir, { recursive: true });

  const gatewayLogs = [
    createLog({
      id: "gateway-01",
      source: "gateway",
      method: "POST",
      path: "/recall",
      routePattern: "/recall",
      statusCode: 500,
      outcome: "error",
      latencyMs: 882,
      authType: "gateway_api_key",
      createdAt: "2026-05-30T12:00:00.000Z",
      queryKeys: ["limit", "source"],
      warningCodes: ["server-error"],
    }),
    createLog({
      id: "gateway-02",
      source: "gateway",
      method: "POST",
      path: "/search/memories",
      routePattern: "/search/memories",
      statusCode: 200,
      outcome: "ok",
      latencyMs: 420,
      authType: "gateway_api_key",
      createdAt: "2026-05-30T11:58:00.000Z",
      queryKeys: ["type"],
      warningCodes: [],
    }),
  ];
  const visualizerLogs = [
    createLog({
      id: "visualizer-01",
      source: "visualizer-api",
      method: "GET",
      path: "/api/memories",
      routePattern: "/api/*",
      statusCode: 200,
      outcome: "ok",
      latencyMs: 144,
      authType: "visualizer_api_key",
      createdAt: "2026-05-30T11:59:00.000Z",
      queryKeys: ["offset"],
      warningCodes: [],
    }),
    createLog({
      id: "visualizer-02",
      source: "visualizer-api",
      method: "GET",
      path: "/api/requests",
      routePattern: "/api/*",
      statusCode: 401,
      outcome: "unauthorized",
      latencyMs: 101,
      authType: "visualizer_api_key",
      createdAt: "2026-05-30T11:57:00.000Z",
      queryKeys: ["limit"],
      warningCodes: [],
    }),
  ];

  await writeFile(path.join(telemetryDir, "request-logs.gateway.jsonl"), `${gatewayLogs.join("\n")}\n`, "utf-8");
  await writeFile(path.join(telemetryDir, "request-logs.visualizer.jsonl"), `${visualizerLogs.join("\n")}\n`, "utf-8");
  return telemetryDir;
}

async function seedEmptyTelemetryFixture(): Promise<string> {
  const telemetryDir = await mkdtemp(path.join(tmpdir(), "tdai-requests-monitor-empty-"));
  await mkdir(telemetryDir, { recursive: true });
  return telemetryDir;
}

async function seedCorruptTelemetryFixture(): Promise<string> {
  const telemetryDir = await mkdtemp(path.join(tmpdir(), "tdai-requests-monitor-corrupt-"));
  await mkdir(telemetryDir, { recursive: true });
  const validTail = createLog({
    id: "gateway-corrupt-tail",
    source: "gateway",
    method: "POST",
    path: "/recall",
    routePattern: "/recall",
    statusCode: 500,
    outcome: "error",
    latencyMs: 905,
    authType: "gateway_api_key",
    createdAt: "2026-05-30T12:01:00.000Z",
    queryKeys: ["limit"],
    warningCodes: ["server-error"],
  });
  const unsafeCorruptLine = JSON.stringify({
    source: "gateway",
    query: "token=secret-token",
    headers: { Authorization: "Bearer secret-token", Cookie: "secret-cookie=1" },
    body: "my-secret-password",
  });

  await writeFile(path.join(telemetryDir, "request-logs.gateway.jsonl"), `{not-json\n${unsafeCorruptLine}\n${validTail}\n`, "utf-8");
  return telemetryDir;
}

function createLog(overrides: Record<string, unknown>): string {
  return JSON.stringify(overrides);
}
