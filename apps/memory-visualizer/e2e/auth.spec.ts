import { expect, test } from "@playwright/test";

import { startVisualizerHarness } from "./helpers/visualizer-harness";

test("browser login gates protected API calls and logout returns to the login shell", async ({ page }) => {
  const secret = "vis-test-secret-1234567890";
  const harness = await startVisualizerHarness({ visualizerApiKey: secret });
  const authHeaders: string[] = [];

  try {
    page.on("request", (request) => {
      if (request.url().includes("/api/")) authHeaders.push(request.headers()["authorization"] ?? "");
    });

    await page.goto(harness.baseUrl);
    await expect(page.getByRole("heading", { name: "输入共享访问密钥" })).toBeVisible();

    await page.getByLabel("共享访问密钥").fill("wrong-token");
    await page.getByRole("button", { name: "登录并验证" }).click();
    await expect(page.getByText("共享访问密钥无效，请检查后重试。")).toBeVisible();

    await page.getByLabel("共享访问密钥").fill(secret);
    await page.getByRole("button", { name: "登录并验证" }).click();

    await expect(page.getByRole("heading", { name: "TencentDB Agent Memory Visualizer" })).toBeVisible();
    await expect(page.getByText("共享密钥已验证")).toBeVisible();
    await expect(page.getByRole("heading", { name: "总览" })).toBeVisible();
    await expect(page.getByLabel("只读模式横幅")).toBeVisible();

    expect(authHeaders.some((value) => value === `Bearer ${secret}`)).toBe(true);

    await page.getByRole("button", { name: "退出登录" }).click();
    await expect(page.getByRole("heading", { name: "输入共享访问密钥" })).toBeVisible();
  } finally {
    await harness.close();
  }
});
