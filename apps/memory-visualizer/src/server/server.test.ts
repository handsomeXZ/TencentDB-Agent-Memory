import { type Server } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createVisualizerServer } from "./index";
import {
  REQUEST_TELEMETRY_GATEWAY_FILE,
  REQUEST_TELEMETRY_MAX_LIMIT,
  REQUEST_TELEMETRY_VISUALIZER_FILE,
} from "../../../../src/telemetry/request-telemetry-store.js";

import type { GatewayFetch, GatewayFetchResponse, GatewayRequestInit } from "../providers";
import type { SanitizedRequestLog } from "../../../../src/telemetry/request-telemetry.js";

const appRoot = fileURLToPath(new URL("../..", import.meta.url));
const fixtureRoot = path.join(appRoot, "fixtures", "complete-data-dir");
const secret = "sk-test-secret-1234567890";
const dangerousToken = "secret-token";
const dangerousCookie = "secret-cookie";
const visualizerSecret = "vis-test-secret-1234567890";

interface RunningServer {
  readonly server: Server;
  readonly baseUrl: string;
}

const servers: Server[] = [];
const tempDirs: string[] = [];

afterEach(async () => {
  const pending = servers.splice(0, servers.length);
  await Promise.all(pending.map(closeServer));
  const dirs = tempDirs.splice(0, tempDirs.length);
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("visualizer read-only API server", () => {
  it("serves fixture snapshot and read-only page APIs", async () => {
    const running = await startServer();
    const snapshot = await getJson(`${running.baseUrl}/api/snapshot`);
    const scenes = await getJson(`${running.baseUrl}/api/scenes?limit=1`);
    const memories = await getJson(`${running.baseUrl}/api/memories?offset=1&limit=1`);
    const conversations = await getJson(`${running.baseUrl}/api/conversations?limit=2`);
    const offload = await getJson(`${running.baseUrl}/api/offload`);
    const evidence = await getJson(`${running.baseUrl}/api/evidence`);

    expect(snapshot.status).toBe(200);
    expect(snapshot.body).toMatchObject({
      snapshotId: expect.any(String),
      capabilityReport: expect.any(Object),
      persona: { profileId: "profile:v1:fixture" },
    });
    expect(snapshot.body.scenes).toHaveLength(1);
    expect(snapshot.body.structuredMemories).toHaveLength(4);
    expect(snapshot.body.conversationEvidence).toHaveLength(6);
    expect(snapshot.body.offloadCanvases).toHaveLength(1);

    expect(scenes.body).toMatchObject({ total: 1, items: [expect.objectContaining({ sceneId: "scene:contracts" })] });
    expect(memories.body).toMatchObject({ total: 4, offset: 1, limit: 1, items: [expect.objectContaining({ recordId: "l1:memory:2" })] });
    expect(conversations.body).toMatchObject({ total: 6, limit: 2 });
    expect(offload.body).toMatchObject({
      canvases: { total: 1, items: [expect.objectContaining({ canvasId: "mmd:001" })] },
      references: { total: 1, items: [expect.objectContaining({ toolCallId: "call-001" })] },
    });
    expect(evidence.body.total).toBe(4);
    expect(evidence.body.items).toEqual(expect.arrayContaining([expect.objectContaining({ memoryRecordId: "l1:memory:1" })]));
  });

  it("rejects path traversal and outside-root path input", async () => {
    const running = await startServer();
    const traversal = await getJson(`${running.baseUrl}/api/snapshot?dataDir=../../`);
    const outside = await getJson(`${running.baseUrl}/api/snapshot?offloadRootPath=${encodeURIComponent(path.dirname(fixtureRoot))}`);

    expect(traversal.status).toBe(400);
    expect(traversal.body).toMatchObject({ code: "data-dir-traversal" });
    expect(outside.status).toBe(400);
    expect(outside.body).toMatchObject({ code: "offload-root-outside-root" });
  });

  it("requires the configured visualizer Bearer token for API routes while leaving health open", async () => {
    const running = await startServer(undefined, 50, visualizerSecret);

    const health = await getJson(`${running.baseUrl}/health`);
    const missing = await getJson(`${running.baseUrl}/api/snapshot`);
    const wrong = await getJson(`${running.baseUrl}/api/snapshot`, authHeaders("wrong-token"));
    const valid = await getJson(`${running.baseUrl}/api/snapshot`, authHeaders(visualizerSecret));

    expect(health.status).toBe(200);
    expect(health.body).toMatchObject({ ok: true, readOnly: true });
    expect(missing.status).toBe(401);
    expect(missing.body).toMatchObject({ code: "unauthorized" });
    expect(wrong.status).toBe(401);
    expect(wrong.body).toMatchObject({ code: "unauthorized" });
    expect(valid.status).toBe(200);
    expect(valid.body).toMatchObject({ persona: { profileId: "profile:v1:fixture" } });
  });

  it("fails closed for production API routes when the visualizer token is missing", async () => {
    const running = await startServer(undefined, 50, undefined, { NODE_ENV: "production" });

    const health = await getJson(`${running.baseUrl}/health`);
    const snapshot = await getJson(`${running.baseUrl}/api/snapshot`);

    expect(health.status).toBe(200);
    expect(snapshot.status).toBe(503);
    expect(snapshot.body).toMatchObject({ code: "auth-not-configured" });
  });

  it("routes only safe Gateway debug calls and preserves raw formatted search strings", async () => {
    const calls: { readonly url: string; readonly method: string; readonly body: string }[] = [];
    const gatewayFetch: GatewayFetch = async (input, init) => {
      const url = input.toString();
      calls.push({ url, method: init?.method ?? "GET", body: readBody(init) });
      const pathname = new URL(url).pathname;
      if (pathname === "/health") {
        return jsonResponse(200, { status: "ok", version: "test", uptime: 7, stores: { vectorStore: true, embeddingService: false } });
      }
      if (pathname === "/recall") {
        return jsonResponse(200, { context: "remember alpha", strategy: "hybrid", memory_count: 1 });
      }
      if (pathname === "/search/memories") {
        return jsonResponse(200, { results: "# Raw memory result\n- keep formatting", total: 1, strategy: "bm25" });
      }
      if (pathname === "/search/conversations") {
        return jsonResponse(200, { results: "user: exact raw transcript", total: 1 });
      }
      return jsonResponse(500, { error: "unexpected endpoint" });
    };
    const running = await startServer(gatewayFetch);

    const health = await getJson(`${running.baseUrl}/api/gateway/health`);
    const recall = await postJson(`${running.baseUrl}/api/gateway/recall-debug`, { query: "alpha", session_key: "session-alpha" });
    const memories = await postJson(`${running.baseUrl}/api/gateway/search-memories-debug`, { query: "alpha", limit: 2 });
    const conversations = await postJson(`${running.baseUrl}/api/gateway/search-conversations-debug`, { query: "alpha", session_key: "session-alpha" });
    const dangerous = await postJson(`${running.baseUrl}/api/gateway/capture`, { query: "nope" });

    expect(health.body).toMatchObject({ ok: true, endpoint: "/health", data: { status: "ok" } });
    expect(recall.body).toMatchObject({ ok: true, endpoint: "/recall", data: { context: "remember alpha" } });
    expect(memories.body).toMatchObject({ ok: true, endpoint: "/search/memories", data: { results: "# Raw memory result\n- keep formatting" } });
    expect(conversations.body).toMatchObject({ ok: true, endpoint: "/search/conversations", data: { results: "user: exact raw transcript" } });
    expect(dangerous.status).toBe(404);
    expect(calls.map((call) => new URL(call.url).pathname)).toEqual([
      "/health",
      "/recall",
      "/search/memories",
      "/search/conversations",
    ]);
    expect(calls.every((call) => !call.url.includes("capture") && !call.url.includes("seed"))).toBe(true);
  });

  it("uses Gateway visualizer APIs as the dashboard data source without a local data directory", async () => {
    const calls: { readonly url: string; readonly authorization: string | null }[] = [];
    const gatewayFetch: GatewayFetch = async (input, init) => {
      const url = input.toString();
      const headers = new Headers(init?.headers);
      calls.push({ url, authorization: headers.get("authorization") });
      const pathname = new URL(url).pathname;

      if (pathname === "/base/visualizer/snapshot") {
        return jsonResponse(200, {
          snapshotId: "remote:snapshot",
          generatedAt: "2026-05-31T00:00:00.000Z",
          dataSource: {
            sourceLabel: "gateway-memory",
            memoryRootPath: "",
            profilesPath: "",
            scenesPath: "",
            l1DatabasePath: "",
            l0DatabasePath: "",
            offloadRootPath: "",
            gatewayBaseUrl: "http://gateway.test/base",
            gatewayApiKeyEnv: "TDAI_VIS_GATEWAY_API_KEY",
            readOnly: true,
            environmentInputs: ["TDAI_VIS_GATEWAY_URL", "TDAI_VIS_GATEWAY_API_KEY"],
          },
          capabilityReport: {},
          persona: { profileId: "remote-persona" },
          scenes: [{ sceneId: "remote-scene" }],
          structuredMemories: [],
          conversationEvidence: [],
          offloadCanvases: [],
          gateway: { baseUrl: "http://gateway.test/base" },
          warnings: [],
        });
      }

      if (pathname === "/base/visualizer/memories") {
        return jsonResponse(200, { items: [{ recordId: "remote-memory" }], total: 1, offset: 0, limit: 50 });
      }

      if (pathname === "/base/visualizer/requests") {
        return jsonResponse(200, {
          items: [{
            id: "remote-request-2",
            source: "gateway",
            method: "GET",
            path: "/recall",
            routePattern: "/recall",
            statusCode: 200,
            outcome: "ok",
            latencyMs: 12,
            authType: "gateway_api_key",
            createdAt: "2026-06-02T12:00:00.000Z",
            queryKeys: ["limit"],
            warningCodes: [],
          }],
          total: 3,
          offset: 1,
          limit: 2,
          warnings: [{ code: "telemetry-file-missing", message: "hidden gateway detail", source: "gateway", detail: { path: "Z:/secret-telemetry" } }],
        });
      }

      if (pathname === "/base/visualizer/requests/summary") {
        return jsonResponse(200, {
          generatedAt: "2026-06-02T12:01:00.000Z",
          total: 3,
          last24h: 3,
          errorRate: 0,
          p95LatencyMs: 12,
          recent5xx: [],
          sources: [{ key: "gateway", count: 3, errorCount: 0, unauthorizedCount: 0, averageLatencyMs: 12 }],
          warnings: [{ code: "telemetry-file-missing", message: "hidden summary detail", source: "visualizer-api", detail: { file: "Z:/summary-secret" } }],
        });
      }

      return jsonResponse(404, { error: `unexpected endpoint: ${pathname}` });
    };
    const running = await startServer(gatewayFetch, 50, visualizerSecret, {
      TDAI_VIS_DATA_SOURCE: "gateway",
      TDAI_VIS_GATEWAY_URL: "http://gateway.test/base",
      TDAI_VIS_DATA_DIR: "Z:/missing-local-memory-dir",
    });

    const snapshot = await getJson(`${running.baseUrl}/api/snapshot?dataDir=../../local-should-be-ignored`, authHeaders(visualizerSecret));
    const memories = await getJson(`${running.baseUrl}/api/memories`, authHeaders(visualizerSecret));
    const requests = await getJson(`${running.baseUrl}/api/requests?limit=2&offset=1`, authHeaders(visualizerSecret));
    const requestsSummary = await getJson(`${running.baseUrl}/api/requests/summary`, authHeaders(visualizerSecret));

    expect(snapshot.status).toBe(200);
    expect(snapshot.body).toMatchObject({ snapshotId: "remote:snapshot", persona: { profileId: "remote-persona" } });
    expect(memories.status).toBe(200);
    expect(memories.body).toMatchObject({ total: 1, items: [expect.objectContaining({ recordId: "remote-memory" })] });
    expect(requests.status).toBe(200);
    expect(requests.body).toMatchObject({ total: 3, offset: 1, limit: 2, items: [expect.objectContaining({ id: "remote-request-2" })] });
    expect(requests.body.warnings).toEqual([
      expect.objectContaining({ code: "telemetry-file-missing", source: "gateway", detail: null }),
    ]);
    expect(requestsSummary.status).toBe(200);
    expect(requestsSummary.body).toMatchObject({ total: 3, sources: [expect.objectContaining({ key: "gateway", count: 3 })] });
    expect(requestsSummary.body.warnings).toEqual([
      expect.objectContaining({ code: "telemetry-file-missing", source: "visualizer-api", detail: null }),
    ]);
    expect(calls.map((call) => new URL(call.url).pathname)).toEqual([
      "/base/visualizer/snapshot",
      "/base/visualizer/memories",
      "/base/visualizer/requests",
      "/base/visualizer/requests/summary",
    ]);
    expect(new URL(calls[2]?.url ?? "http://missing.test").search).toBe("?offset=1&limit=2");
    expect(calls.every((call) => call.authorization === `Bearer ${secret}`)).toBe(true);
  });

  it("returns controlled Gateway warnings for timeout, non-JSON, and 500 responses without leaking API keys", async () => {
    const gatewayFetch: GatewayFetch = async (input, init) => {
      const pathname = new URL(input.toString()).pathname;
      if (pathname === "/health") return waitForAbort(init?.signal ?? null);
      if (pathname === "/search/memories") return textResponse(200, `Bearer ${secret} TDAI_GATEWAY_API_KEY=${secret}`);
      if (pathname === "/search/conversations") return jsonResponse(500, { error: `TDAI_GATEWAY_API_KEY=${secret}` });
      return jsonResponse(200, { context: "ok" });
    };
    const running = await startServer(gatewayFetch, 5);

    const timeout = await getJson(`${running.baseUrl}/api/gateway/health`);
    const nonJson = await postJson(`${running.baseUrl}/api/gateway/search-memories-debug`, { query: "alpha" });
    const gateway500 = await postJson(`${running.baseUrl}/api/gateway/search-conversations-debug`, { query: "alpha" });

    expect(timeout.status).toBe(200);
    expect(timeout.body).toMatchObject({ ok: false, endpoint: "/health", httpStatus: null, data: null });
    expect(timeout.body.warning).toContain("aborted");
    expect(nonJson.body).toMatchObject({ ok: false, endpoint: "/search/memories", httpStatus: 200, data: null });
    expect(nonJson.body.warning).not.toContain(secret);
    expect(nonJson.body.warning).toContain("[redacted");
    expect(gateway500.body).toMatchObject({ ok: false, endpoint: "/search/conversations", httpStatus: 500, data: null });
    expect(JSON.stringify(gateway500.body)).not.toContain(secret);
  });

  it("returns controlled 400 for malformed JSON request bodies", async () => {
    const running = await startServer();
    const response = await fetch(`${running.baseUrl}/api/gateway/recall-debug`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{not-json",
    });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toMatchObject({ code: "malformed-json" });
  });

  it("records sanitized Visualizer API telemetry for reads, auth failures, debug proxy calls, malformed JSON, and 404", async () => {
    const telemetryDir = await tempDir("tdai-visualizer-telemetry-");
    const gatewayFetch: GatewayFetch = async (input) => {
      const pathname = new URL(input.toString()).pathname;
      if (pathname === "/recall") return jsonResponse(200, { context: "remember alpha", strategy: "hybrid", memory_count: 1 });
      if (pathname === "/search/memories") return jsonResponse(500, { error: "gateway failed" });
      return jsonResponse(404, { error: "unexpected endpoint" });
    };
    const running = await startServer(gatewayFetch, 50, visualizerSecret, { TDAI_VIS_TELEMETRY_DIR: telemetryDir });

    const unauthorized = await getJson(`${running.baseUrl}/api/snapshot`);
    const snapshot = await getJson(`${running.baseUrl}/api/snapshot?limit=1&token=secret-token&sourceLabel=fixture-secret`, authHeaders(visualizerSecret));
    const memories = await getJson(`${running.baseUrl}/api/memories?offset=1&limit=1&source=client-secret-source`, authHeaders(visualizerSecret));
    const recall = await postJson(`${running.baseUrl}/api/gateway/recall-debug`, {
      query: "my-secret-password",
      session_key: "session-alpha",
    }, { ...authHeaders(visualizerSecret), Cookie: `${dangerousCookie}=1` });
    const gatewayFailure = await postJson(`${running.baseUrl}/api/gateway/search-memories-debug`, {
      query: "gateway failure secret",
    }, authHeaders(visualizerSecret));
    const malformed = await fetch(`${running.baseUrl}/api/gateway/recall-debug`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders(visualizerSecret) },
      body: "{not-json",
    });
    const missing = await getJson(`${running.baseUrl}/api/missing-route?status=raw-status-value`, authHeaders(visualizerSecret));
    const production = await startServer(undefined, 50, undefined, { NODE_ENV: "production", TDAI_VIS_TELEMETRY_DIR: telemetryDir });
    const authNotConfigured = await getJson(`${production.baseUrl}/api/snapshot`);

    expect(unauthorized).toMatchObject({ status: 401 });
    expect(snapshot).toMatchObject({ status: 200 });
    expect(memories).toMatchObject({ status: 200 });
    expect(recall.body).toMatchObject({ ok: true, endpoint: "/recall" });
    expect(gatewayFailure.body).toMatchObject({ ok: false, endpoint: "/search/memories", httpStatus: 500 });
    expect(malformed.status).toBe(400);
    expect(missing).toMatchObject({ status: 404 });
    expect(authNotConfigured).toMatchObject({ status: 503 });

    const records = await waitForVisualizerRecords(telemetryDir, 8);
    expect(records).toHaveLength(8);
    expect(records.every((record) => record.source === "visualizer-api")).toBe(true);
    expect(records).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: "/api/snapshot", statusCode: 401, outcome: "unauthorized", routePattern: "/api/*", authType: "visualizer_api_key" }),
      expect.objectContaining({ path: "/api/snapshot", statusCode: 200, outcome: "ok", routePattern: "/api/*", authType: "visualizer_api_key" }),
      expect.objectContaining({ path: "/api/memories", statusCode: 200, outcome: "ok", routePattern: "/api/*" }),
      expect.objectContaining({ path: "/api/gateway/recall-debug", statusCode: 200, routePattern: "/api/*" }),
      expect.objectContaining({ path: "/api/gateway/search-memories-debug", statusCode: 200, routePattern: "/api/*" }),
      expect.objectContaining({ path: "/api/gateway/recall-debug", statusCode: 400, routePattern: "/api/*" }),
      expect.objectContaining({ path: "/api/missing-route", statusCode: 404, routePattern: "/api/*" }),
      expect.objectContaining({ path: "/api/snapshot", statusCode: 503, outcome: "error", routePattern: "/api/*", authType: "visualizer_api_key" }),
    ]));
    expect(findVisualizerRecord(records, "/api/snapshot", 200).queryKeys).toEqual(["limit"]);
    expect(findVisualizerRecord(records, "/api/memories", 200).queryKeys).toEqual(["limit", "offset", "source"]);
    expect(findVisualizerRecord(records, "/api/missing-route", 404).queryKeys).toEqual(["status"]);

    const serialized = JSON.stringify(records);
    for (const forbidden of [
      "my-secret-password",
      "session-alpha",
      "gateway failure secret",
      dangerousToken,
      dangerousCookie,
      "fixture-secret",
      "client-secret-source",
      "raw-status-value",
      visualizerSecret,
      "Authorization",
      "Cookie",
      "Bearer",
      "token=",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("records body-too-large as sanitized Visualizer telemetry without persisting the body", async () => {
    const telemetryDir = await tempDir("tdai-visualizer-telemetry-large-");
    const running = await startServer(undefined, 50, visualizerSecret, { TDAI_VIS_TELEMETRY_DIR: telemetryDir }, 12);

    const response = await fetch(`${running.baseUrl}/api/gateway/recall-debug`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders(visualizerSecret) },
      body: JSON.stringify({ query: "my-secret-password", session_key: "session-alpha" }),
    });
    const body = await response.json();

    expect(response.status).toBe(413);
    expect(body).toMatchObject({ code: "body-too-large" });
    const records = await waitForVisualizerRecords(telemetryDir, 1);
    expect(records).toEqual([expect.objectContaining({ path: "/api/gateway/recall-debug", statusCode: 413, source: "visualizer-api" })]);
    expect(JSON.stringify(records)).not.toContain("my-secret-password");
    expect(JSON.stringify(records)).not.toContain("session-alpha");
  });

  it("serves merged request telemetry pagination with capped limit and offset after merge", async () => {
    const telemetryDir = await tempDir("tdai-visualizer-requests-page-");
    await seedRequestTelemetryLogs(telemetryDir, createMergedTelemetryFixtures());
    const running = await startServer(undefined, 50, visualizerSecret, { TDAI_VIS_TELEMETRY_DIR: telemetryDir });

    const page = await getJson(`${running.baseUrl}/api/requests?limit=20`, authHeaders(visualizerSecret));
    const capped = await getJson(`${running.baseUrl}/api/requests?limit=99999`, authHeaders(visualizerSecret));
    const offset = await getJson(`${running.baseUrl}/api/requests?offset=10`, authHeaders(visualizerSecret));

    expect(page.status).toBe(200);
    expect(page.body).toMatchObject({ total: 14, offset: 0, limit: 20 });
    expect((page.body.items as readonly Record<string, unknown>[]).slice(0, 3).map((item) => item.id)).toEqual([
      "visualizer-01",
      "gateway-01",
      "visualizer-02",
    ]);

    expect(capped.status).toBe(200);
    expect(capped.body).toMatchObject({ total: 14, offset: 0, limit: REQUEST_TELEMETRY_MAX_LIMIT });
    expect(capped.body.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "telemetry-limit-capped", detail: null }),
    ]));

    expect(offset.status).toBe(200);
    expect(offset.body).toMatchObject({ total: 14, offset: 10, limit: 50 });
    expect((offset.body.items as readonly Record<string, unknown>[]).map((item) => item.id)).toEqual([
      "visualizer-06",
      "gateway-06",
      "visualizer-07",
      "gateway-07",
    ]);
  });

  it("returns sanitized 400 for invalid request telemetry pagination", async () => {
    const telemetryDir = await tempDir("tdai-visualizer-requests-invalid-");
    await seedRequestTelemetryLogs(telemetryDir, createMergedTelemetryFixtures());
    const running = await startServer(undefined, 50, visualizerSecret, { TDAI_VIS_TELEMETRY_DIR: telemetryDir });

    const invalidLimit = await getJson(`${running.baseUrl}/api/requests?limit=abc`, authHeaders(visualizerSecret));
    const negativeLimit = await getJson(`${running.baseUrl}/api/requests?limit=-1`, authHeaders(visualizerSecret));
    const negativeOffset = await getJson(`${running.baseUrl}/api/requests?offset=-3`, authHeaders(visualizerSecret));

    for (const response of [invalidLimit, negativeLimit, negativeOffset]) {
      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({ code: "invalid-telemetry-pagination" });
      expect(JSON.stringify(response.body)).not.toContain(telemetryDir);
    }
  });

  it("returns empty merged telemetry pages with warnings when telemetry files are missing", async () => {
    const telemetryDir = await tempDir("tdai-visualizer-requests-empty-");
    const running = await startServer(undefined, 50, visualizerSecret, { TDAI_VIS_TELEMETRY_DIR: telemetryDir });

    const page = await getJson(`${running.baseUrl}/api/requests`, authHeaders(visualizerSecret));
    const summary = await getJson(`${running.baseUrl}/api/requests/summary`, authHeaders(visualizerSecret));

    expect(page.status).toBe(200);
    expect(page.body).toMatchObject({ items: [], total: 0, offset: 0, limit: 50 });
    expect(page.body.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "telemetry-file-missing", source: "gateway", detail: null }),
      expect.objectContaining({ code: "telemetry-file-missing", source: "visualizer-api", detail: null }),
    ]));
    expect(JSON.stringify(page.body)).not.toContain(telemetryDir);

    expect(summary.status).toBe(200);
    expect(summary.body).toMatchObject({
      total: 0,
      last24h: 0,
      errorRate: 0,
      p95LatencyMs: null,
      recent5xx: [],
      sources: [],
    });
    expect(summary.body.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "telemetry-file-missing", source: "gateway", detail: null }),
      expect.objectContaining({ code: "telemetry-file-missing", source: "visualizer-api", detail: null }),
    ]));
  });

  it("requires visualizer auth for request telemetry routes", async () => {
    const telemetryDir = await tempDir("tdai-visualizer-requests-auth-");
    await seedRequestTelemetryLogs(telemetryDir, createMergedTelemetryFixtures());
    const running = await startServer(undefined, 50, visualizerSecret, { TDAI_VIS_TELEMETRY_DIR: telemetryDir });

    const missing = await getJson(`${running.baseUrl}/api/requests`);
    const wrong = await getJson(`${running.baseUrl}/api/requests/summary`, authHeaders("wrong-token"));
    const valid = await getJson(`${running.baseUrl}/api/requests`, authHeaders(visualizerSecret));

    expect(missing).toMatchObject({ status: 401, body: { code: "unauthorized" } });
    expect(wrong).toMatchObject({ status: 401, body: { code: "unauthorized" } });
    expect(valid).toMatchObject({ status: 200, body: { total: 14 } });
  });

  it("serves request telemetry summary fields from merged gateway and visualizer logs", async () => {
    const telemetryDir = await tempDir("tdai-visualizer-requests-summary-");
    await seedRequestTelemetryLogs(telemetryDir, createMergedTelemetryFixtures());
    const running = await startServer(undefined, 50, visualizerSecret, { TDAI_VIS_TELEMETRY_DIR: telemetryDir });

    const summary = await getJson(`${running.baseUrl}/api/requests/summary`, authHeaders(visualizerSecret));

    expect(summary.status).toBe(200);
    expect(summary.body).toMatchObject({
      total: 14,
      last24h: 13,
      errorRate: 0.214,
      p95LatencyMs: 950,
      sources: [
        expect.objectContaining({ key: "visualizer-api", count: 7, errorCount: 1, unauthorizedCount: 1, averageLatencyMs: 313 }),
        expect.objectContaining({ key: "gateway", count: 7, errorCount: 2, unauthorizedCount: 1, averageLatencyMs: 509 }),
      ],
    });
    expect(summary.body.recent5xx).toEqual([
      expect.objectContaining({ id: "gateway-03", statusCode: 500, source: "gateway" }),
      expect.objectContaining({ id: "gateway-05", statusCode: 502, source: "gateway" }),
      expect.objectContaining({ id: "visualizer-06", statusCode: 503, source: "visualizer-api" }),
    ]);
    expect(summary.body.warnings).toEqual([]);
    expect(JSON.stringify(summary.body)).not.toContain(telemetryDir);
  });

  it("skips request monitor, health, and static asset routes", async () => {
    const telemetryDir = await tempDir("tdai-visualizer-telemetry-skip-");
    const running = await startServer(undefined, 50, visualizerSecret, { TDAI_VIS_TELEMETRY_DIR: telemetryDir });

    expect(await getJson(`${running.baseUrl}/health`)).toMatchObject({ status: 200 });
    expect(await getJson(`${running.baseUrl}/api/requests`, authHeaders(visualizerSecret))).toMatchObject({ status: 200 });
    expect(await getJson(`${running.baseUrl}/api/requests/summary`, authHeaders(visualizerSecret))).toMatchObject({ status: 200 });
    expect(await getJson(`${running.baseUrl}/assets/app.js`, authHeaders(visualizerSecret))).toMatchObject({ status: 404 });

    await waitForTelemetryIdle();
    expect(await readVisualizerRecords(telemetryDir)).toEqual([]);
  });

  it("resolves Visualizer telemetry env before shared telemetry env and disables telemetry when unset", async () => {
    const visualizerTelemetryDir = await tempDir("tdai-visualizer-telemetry-specific-");
    const sharedTelemetryDir = await tempDir("tdai-visualizer-telemetry-shared-");
    const running = await startServer(undefined, 50, undefined, {
      TDAI_VIS_TELEMETRY_DIR: visualizerTelemetryDir,
      TDAI_TELEMETRY_DIR: sharedTelemetryDir,
    });

    expect(await getJson(`${running.baseUrl}/api/snapshot`)).toMatchObject({ status: 200 });
    expect(await waitForVisualizerRecords(visualizerTelemetryDir, 1)).toHaveLength(1);
    expect(await readVisualizerRecords(sharedTelemetryDir)).toEqual([]);

    const disabled = await startServer();
    expect(await getJson(`${disabled.baseUrl}/api/snapshot`)).toMatchObject({ status: 200 });
    await waitForTelemetryIdle();
    expect(await readVisualizerRecords(visualizerTelemetryDir)).toHaveLength(1);
    expect(await readVisualizerRecords(sharedTelemetryDir)).toEqual([]);
  });

  it("fails open when Visualizer telemetry storage cannot append", async () => {
    const root = await tempDir("tdai-visualizer-telemetry-failopen-");
    const telemetryFilePath = path.join(root, "not-a-directory");
    await writeFile(telemetryFilePath, "occupied", "utf-8");
    const running = await startServer(undefined, 50, undefined, { TDAI_VIS_TELEMETRY_DIR: telemetryFilePath });

    const response = await getJson(`${running.baseUrl}/api/snapshot`);

    expect(response).toMatchObject({ status: 200, body: { persona: { profileId: "profile:v1:fixture" } } });
    await waitForTelemetryIdle();
    await expect(readFile(telemetryFilePath, "utf-8")).resolves.toBe("occupied");
  });

  it("redacts unexpected internal API errors from clients while logging server details", async () => {
    const internalMessage = "secret provider failure from test";
    const logger = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const server = createVisualizerServer({
      appConfig: { dataDir: fixtureRoot, offloadRootPath: path.join(fixtureRoot, "offload") },
      now: () => {
        throw new Error(internalMessage);
      },
    });
    servers.push(server);
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => resolve());
    });
    const address = server.address();
    if (typeof address !== "object" || address === null) throw new Error("Expected TCP server address.");

    try {
      const response = await getJson(`http://127.0.0.1:${address.port}/api/snapshot`);
      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: "Internal Server Error", code: "internal-error" });
      expect(JSON.stringify(response.body)).not.toContain(internalMessage);
      expect(logger).toHaveBeenCalledWith(expect.stringContaining(internalMessage));
    } finally {
      logger.mockRestore();
    }
  });
});

async function startServer(
  gatewayFetch?: GatewayFetch,
  gatewayTimeoutMs = 50,
  visualizerApiKey?: string,
  extraEnv: NodeJS.ProcessEnv = {},
  maxBodyBytes?: number,
): Promise<RunningServer> {
  const server = createVisualizerServer({
    appConfig: {
      dataDir: fixtureRoot,
      offloadRootPath: path.join(fixtureRoot, "offload"),
      gatewayBaseUrl: "http://gateway.test",
      gatewayApiKeyEnv: "TDAI_VIS_GATEWAY_API_KEY",
    },
    env: {
      TDAI_VIS_GATEWAY_API_KEY: secret,
      ...(visualizerApiKey ? { TDAI_VIS_API_KEY: visualizerApiKey } : {}),
      ...extraEnv,
    },
    fetch: gatewayFetch,
    gatewayTimeoutMs,
    maxBodyBytes,
  });
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (typeof address !== "object" || address === null) throw new Error("Expected TCP server address.");
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

async function closeServer(server: Server): Promise<void> {
  if (!server.listening) return;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function getJson(url: string, headers?: HeadersInit): Promise<{ readonly status: number; readonly body: Record<string, unknown> }> {
  const response = await fetch(url, { headers });
  return { status: response.status, body: await response.json() };
}

async function postJson(url: string, body: Record<string, unknown>, headers?: HeadersInit): Promise<{ readonly status: number; readonly body: Record<string, unknown> }> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(headers ?? {}) },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function seedRequestTelemetryLogs(
  telemetryDir: string,
  fixtures: { readonly gateway: readonly SanitizedRequestLog[]; readonly visualizer: readonly SanitizedRequestLog[] },
): Promise<void> {
  await writeFile(
    path.join(telemetryDir, REQUEST_TELEMETRY_GATEWAY_FILE),
    `${fixtures.gateway.map((record) => JSON.stringify(record)).join("\n")}\n`,
    "utf-8",
  );
  await writeFile(
    path.join(telemetryDir, REQUEST_TELEMETRY_VISUALIZER_FILE),
    `${fixtures.visualizer.map((record) => JSON.stringify(record)).join("\n")}\n`,
    "utf-8",
  );
}

function createMergedTelemetryFixtures(): {
  readonly gateway: readonly SanitizedRequestLog[];
  readonly visualizer: readonly SanitizedRequestLog[];
} {
  return {
    gateway: [
      telemetryRecord("gateway", 1, { createdAt: "2026-06-02T11:59:00.000Z", latencyMs: 120 }),
      telemetryRecord("gateway", 2, { createdAt: "2026-06-02T11:57:00.000Z", latencyMs: 210 }),
      telemetryRecord("gateway", 3, { createdAt: "2026-06-02T11:55:00.000Z", latencyMs: 450, statusCode: 500, outcome: "error" }),
      telemetryRecord("gateway", 4, { createdAt: "2026-06-02T11:53:00.000Z", latencyMs: 300, statusCode: 401, outcome: "unauthorized" }),
      telemetryRecord("gateway", 5, { createdAt: "2026-06-02T11:51:00.000Z", latencyMs: 720, statusCode: 502, outcome: "error" }),
      telemetryRecord("gateway", 6, { createdAt: "2026-06-02T11:49:00.000Z", latencyMs: 810 }),
      telemetryRecord("gateway", 7, { createdAt: "2026-05-31T10:00:00.000Z", latencyMs: 950 }),
    ],
    visualizer: [
      telemetryRecord("visualizer", 1, { createdAt: "2026-06-02T12:00:00.000Z", latencyMs: 90 }),
      telemetryRecord("visualizer", 2, { createdAt: "2026-06-02T11:58:00.000Z", latencyMs: 110 }),
      telemetryRecord("visualizer", 3, { createdAt: "2026-06-02T11:56:00.000Z", latencyMs: 130 }),
      telemetryRecord("visualizer", 4, { createdAt: "2026-06-02T11:54:00.000Z", latencyMs: 170 }),
      telemetryRecord("visualizer", 5, { createdAt: "2026-06-02T11:52:00.000Z", latencyMs: 240 }),
      telemetryRecord("visualizer", 6, { createdAt: "2026-06-02T11:50:00.000Z", latencyMs: 900, statusCode: 503, outcome: "error" }),
      telemetryRecord("visualizer", 7, { createdAt: "2026-06-01T10:00:00.000Z", latencyMs: 550, statusCode: 401, outcome: "unauthorized" }),
    ],
  };
}

function telemetryRecord(
  source: "gateway" | "visualizer",
  index: number,
  overrides: Partial<SanitizedRequestLog> & Pick<SanitizedRequestLog, "createdAt">,
): SanitizedRequestLog {
  const isGateway = source === "gateway";
  const { createdAt, ...rest } = overrides;
  return {
    id: `${source}-${String(index).padStart(2, "0")}`,
    source: isGateway ? "gateway" : "visualizer-api",
    method: "GET",
    path: isGateway ? "/recall" : "/api/snapshot",
    routePattern: isGateway ? "/recall" : "/api/*",
    statusCode: 200,
    outcome: "ok",
    latencyMs: 100,
    authType: isGateway ? "gateway_api_key" : "visualizer_api_key",
    createdAt,
    queryKeys: [],
    warningCodes: [],
    ...rest,
  };
}

async function waitForVisualizerRecords(telemetryDir: string, count: number): Promise<readonly SanitizedRequestLog[]> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const records = await readVisualizerRecords(telemetryDir);
    if (records.length >= count) return records;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return readVisualizerRecords(telemetryDir);
}

async function readVisualizerRecords(telemetryDir: string): Promise<readonly SanitizedRequestLog[]> {
  try {
    const content = await readFile(path.join(telemetryDir, REQUEST_TELEMETRY_VISUALIZER_FILE), "utf-8");
    return content.trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as SanitizedRequestLog);
  } catch {
    return [];
  }
}

async function waitForTelemetryIdle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 80));
}

function findVisualizerRecord(records: readonly SanitizedRequestLog[], pathName: string, statusCode: number): SanitizedRequestLog {
  const record = records.find((candidate) => candidate.path === pathName && candidate.statusCode === statusCode);
  if (!record) throw new Error(`Missing telemetry record for ${pathName} ${statusCode}.`);
  return record;
}

function jsonResponse(status: number, body: Record<string, unknown>): GatewayFetchResponse {
  return createResponse(status, "application/json", JSON.stringify(body));
}

function textResponse(status: number, body: string): GatewayFetchResponse {
  return createResponse(status, "text/plain", body);
}

function createResponse(status: number, contentType: string, body: string): GatewayFetchResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    headers: new Headers({ "content-type": contentType }),
    text: async () => body,
  };
}

function readBody(init: GatewayRequestInit | undefined): string {
  return typeof init?.body === "string" ? init.body : "";
}

function authHeaders(token: string): HeadersInit {
  return { Authorization: `Bearer ${token}` };
}

function waitForAbort(signal: AbortSignal | null): Promise<GatewayFetchResponse> {
  return new Promise((_, reject) => {
    if (signal?.aborted) {
      reject(new Error("aborted"));
      return;
    }
    signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
  });
}
