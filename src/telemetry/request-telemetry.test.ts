import { describe, expect, it } from "vitest";

import {
  REQUEST_TELEMETRY_AUTH_TYPES,
  REQUEST_TELEMETRY_OUTCOMES,
  REQUEST_TELEMETRY_QUERY_KEY_ALLOWLIST,
  REQUEST_TELEMETRY_SOURCES,
  classifyRequestRoute,
  createSanitizedRequestLog,
  sanitizeRequestQueryKeys,
  shouldSkipRequestTelemetry,
} from "./request-telemetry.js";

import type { RequestTelemetrySummary } from "./request-telemetry.js";

describe("request telemetry contract", () => {
  it("exports stable literal unions for serializable request logs", () => {
    expect(REQUEST_TELEMETRY_SOURCES).toEqual(["visualizer-api", "gateway"]);
    expect(REQUEST_TELEMETRY_OUTCOMES).toEqual(["ok", "error", "unauthorized", "blocked", "aborted"]);
    expect(REQUEST_TELEMETRY_AUTH_TYPES).toEqual([
      "none",
      "local",
      "api_key",
      "visualizer_api_key",
      "gateway_api_key",
      "unknown",
    ]);
    expect(REQUEST_TELEMETRY_QUERY_KEY_ALLOWLIST).toEqual(["limit", "offset", "source", "status", "type"]);
  });

  it("supports the plan-required request summary DTO shape", () => {
    const summary: RequestTelemetrySummary = {
      generatedAt: "2026-06-01T00:00:00.000Z",
      total: 3,
      last24h: 2,
      errorRate: 0.333,
      p95LatencyMs: 87,
      recent5xx: [],
      sources: [
        {
          key: "gateway",
          count: 2,
          errorCount: 1,
          unauthorizedCount: 0,
          averageLatencyMs: 42,
        },
      ],
      warnings: [],
    };

    expect(Object.keys(summary)).toEqual([
      "generatedAt",
      "total",
      "last24h",
      "errorRate",
      "p95LatencyMs",
      "recent5xx",
      "sources",
      "warnings",
    ]);
    expect(JSON.parse(JSON.stringify(summary))).toMatchObject({ total: 3, last24h: 2, p95LatencyMs: 87 });
  });
});

describe("request telemetry sanitizer", () => {
  it("stores only pathname and allowlisted query key names", () => {
    const log = createSanitizedRequestLog({
      id: "request:test-1",
      source: "visualizer-api",
      method: "GET",
      path: "/api/search?q=my-secret-password&limit=10&token=secret-token",
      query: "q=my-secret-password&limit=10&token=secret-token",
      statusCode: 200,
      latencyMs: 12.4,
      authType: "visualizer_api_key",
      createdAt: "2026-06-01T00:00:00.000Z",
      headers: { Authorization: "Bearer secret-token", Cookie: "secret-cookie=1" },
      body: { q: "my-secret-password" },
      response_body: { memory: "conversation secret" },
    } as Parameters<typeof createSanitizedRequestLog>[0] & Record<string, unknown>);

    expect(log).toMatchObject({
      path: "/api/search",
      routePattern: "/api/*",
      queryKeys: ["limit"],
      statusCode: 200,
      outcome: "ok",
      latencyMs: 12,
    });

    const serialized = JSON.stringify(log);
    for (const unsafe of [
      "my-secret-password",
      "secret-token",
      "secret-cookie",
      "Authorization",
      "Cookie",
      "Bearer",
      "token=",
      "q=",
      "body",
      "response_body",
      "memory",
      "conversation",
    ]) {
      expect(serialized).not.toContain(unsafe);
    }
  });

  it("filters query keys by the fixed allowlist without preserving values", () => {
    expect(sanitizeRequestQueryKeys("offset=25&source=gateway&status=error&type=POST&api_key=secret")).toEqual([
      "offset",
      "source",
      "status",
      "type",
    ]);
  });

  it("derives allowlisted query keys from path when query metadata is omitted", () => {
    const log = createSanitizedRequestLog({
      id: "request:path-query-only",
      source: "visualizer-api",
      method: "GET",
      path: "/api/search?q=my-secret-password&limit=10&token=secret-token",
      statusCode: 200,
      latencyMs: 8,
      authType: "visualizer_api_key",
      createdAt: "2026-06-01T00:00:00.000Z",
    });

    expect(log).toMatchObject({ path: "/api/search", queryKeys: ["limit"] });
    const serialized = JSON.stringify(log);
    expect(serialized).not.toContain("my-secret-password");
    expect(serialized).not.toContain("secret-token");
    expect(serialized).not.toContain("token=");
    expect(serialized).not.toContain("q=");
  });
});

describe("request telemetry route classifier", () => {
  it("classifies Gateway and Visualizer routes without raw request details", () => {
    expect(classifyRequestRoute("POST", "/recall")).toMatchObject({ kind: "gateway-api", routePattern: "/recall", skip: false });
    expect(classifyRequestRoute("POST", "/capture")).toMatchObject({ kind: "gateway-api", routePattern: "/capture", skip: false });
    expect(classifyRequestRoute("POST", "/search/memories")).toMatchObject({ kind: "gateway-api", routePattern: "/search/memories", skip: false });
    expect(classifyRequestRoute("POST", "/search/conversations")).toMatchObject({ kind: "gateway-api", routePattern: "/search/conversations", skip: false });
    expect(classifyRequestRoute("POST", "/session/end")).toMatchObject({ kind: "gateway-api", routePattern: "/session/end", skip: false });
    expect(classifyRequestRoute("POST", "/seed")).toMatchObject({ kind: "gateway-api", routePattern: "/seed", skip: false });
    expect(classifyRequestRoute("GET", "/visualizer/snapshot?source=local&token=secret")).toMatchObject({ kind: "visualizer-api", routePattern: "/visualizer/*", skip: false });
  });

  it("skips recursive request monitor routes and noisy operational assets", () => {
    const skipped = [
      "/api/requests",
      "/api/requests/summary",
      "/visualizer/requests",
      "/visualizer/requests/summary",
      "/health",
      "/api/health",
      "/favicon.ico",
      "/assets/index.js",
      "/assets/index.css",
      "/assets/index.js.map",
      "/static/logo.svg",
    ];

    for (const path of skipped) {
      expect(shouldSkipRequestTelemetry("GET", path)).toBe(true);
      expect(createSanitizedRequestLog({
        id: `request:${path}`,
        source: path.startsWith("/visualizer") ? "gateway" : "visualizer-api",
        method: "GET",
        path,
        statusCode: 200,
        createdAt: "2026-06-01T00:00:00.000Z",
      })).toBeNull();
    }
  });
});
