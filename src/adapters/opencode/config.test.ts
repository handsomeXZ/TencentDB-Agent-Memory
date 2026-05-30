import { describe, expect, it } from "vitest";

import {
  OPEN_CODE_PLUGIN_DEFAULTS,
  OpenCodePluginConfigError,
  parseOpenCodePluginConfig,
  toLoggableOpenCodePluginConfig,
} from "./config.js";

describe("parseOpenCodePluginConfig", () => {
  it("prefers explicit config over env fallback and defaults", () => {
    const config = parseOpenCodePluginConfig(
      {
        gatewayUrl: "http://gateway.internal:8420/",
        apiKey: "config-token",
        timeoutMs: 9000,
        capture: { enabled: false },
        recall: { enabled: false, maxResults: 9, maxTotalChars: 1200 },
        tools: { enabled: false },
        redaction: { enabled: false },
      },
      { TDAI_GATEWAY_API_KEY: "env-token" },
    );

    expect(config).toEqual({
      gatewayUrl: "http://gateway.internal:8420",
      apiKey: "config-token",
      timeoutMs: 9000,
      capture: { enabled: false },
      recall: { enabled: false, maxResults: 9, maxTotalChars: 1200 },
      tools: { enabled: false },
      redaction: { enabled: false },
    });
  });

  it("falls back to env api key and uses defaults for missing fields", () => {
    const config = parseOpenCodePluginConfig(undefined, {
      TDAI_GATEWAY_API_KEY: "env-token",
    });

    expect(config).toEqual({
      gatewayUrl: OPEN_CODE_PLUGIN_DEFAULTS.gatewayUrl,
      apiKey: "env-token",
      timeoutMs: OPEN_CODE_PLUGIN_DEFAULTS.timeoutMs,
      capture: { enabled: OPEN_CODE_PLUGIN_DEFAULTS.captureEnabled },
      recall: {
        enabled: OPEN_CODE_PLUGIN_DEFAULTS.recallEnabled,
        maxResults: OPEN_CODE_PLUGIN_DEFAULTS.recallMaxResults,
        maxTotalChars: OPEN_CODE_PLUGIN_DEFAULTS.recallMaxTotalChars,
      },
      tools: { enabled: OPEN_CODE_PLUGIN_DEFAULTS.toolsEnabled },
      redaction: { enabled: OPEN_CODE_PLUGIN_DEFAULTS.redactionEnabled },
    });
  });

  it("normalizes gateway urls with and without trailing slash", () => {
    expect(
      parseOpenCodePluginConfig({ gatewayUrl: "http://127.0.0.1:8420/", apiKey: "token" }).gatewayUrl,
    ).toBe("http://127.0.0.1:8420");

    expect(
      parseOpenCodePluginConfig({ gatewayUrl: "http://127.0.0.1:8420/api/", apiKey: "token" }).gatewayUrl,
    ).toBe("http://127.0.0.1:8420/api");
  });

  it("never exposes raw api keys in loggable output", () => {
    const config = parseOpenCodePluginConfig(undefined, {
      TDAI_GATEWAY_API_KEY: "env-token",
    });

    expect(config.apiKey).toBe("env-token");
    expect(toLoggableOpenCodePluginConfig(config)).toEqual({
      gatewayUrl: OPEN_CODE_PLUGIN_DEFAULTS.gatewayUrl,
      apiKey: "[redacted]",
      timeoutMs: OPEN_CODE_PLUGIN_DEFAULTS.timeoutMs,
      capture: { enabled: true },
      recall: { enabled: true, maxResults: 5, maxTotalChars: 6000 },
      tools: { enabled: true },
      redaction: { enabled: true },
    });
  });

  it("fails fast on missing empty or whitespace api keys", () => {
    expect(() => parseOpenCodePluginConfig(undefined, {})).toThrow(OpenCodePluginConfigError);
    expect(() => parseOpenCodePluginConfig({ apiKey: "" })).toThrow("apiKey is required");
    expect(() => parseOpenCodePluginConfig({ apiKey: "   " }, { TDAI_GATEWAY_API_KEY: "   " })).toThrow(
      "apiKey is required",
    );
  });
});
