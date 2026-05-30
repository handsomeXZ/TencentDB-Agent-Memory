import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  outputDir: "./test-results",
  timeout: 30_000,
  use: {
    screenshot: "only-on-failure",
  },
});
