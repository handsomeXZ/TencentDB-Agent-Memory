import { type Server } from "node:http";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

import { TdaiGateway } from "./server.js";
import {
  REQUEST_TELEMETRY_GATEWAY_FILE,
  REQUEST_TELEMETRY_MAX_FILE_BYTES,
  requestTelemetryFileNameForSource,
} from "../telemetry/request-telemetry-store.js";
import type { RequestTelemetrySource } from "../telemetry/request-telemetry.js";
import type { SanitizedRequestLog } from "../telemetry/request-telemetry.js";

const fixtureRoot = fileURLToPath(new URL("../../apps/memory-visualizer/fixtures/complete-data-dir", import.meta.url));
const apiKey = "gateway-visualizer-test-key";

const gateways: TdaiGateway[] = [];
const tempDirs: string[] = [];
const telemetryEnvKeys = ["TDAI_GATEWAY_TELEMETRY_DIR", "TDAI_TELEMETRY_DIR"] as const;
const originalTelemetryEnv = Object.fromEntries(telemetryEnvKeys.map((key) => [key, process.env[key]])) as Record<typeof telemetryEnvKeys[number], string | undefined>;

afterEach(async () => {
  const pending = gateways.splice(0, gateways.length);
  await Promise.all(pending.map((gateway) => gateway.stop()));
  restoreTelemetryEnv();
  const dirs = tempDirs.splice(0, tempDirs.length);
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("TdaiGateway visualizer API", () => {
  it("serves read-only visualizer DTOs through protected Gateway endpoints", async () => {
    const running = await startGateway();

    const health = await getJson(`${running.baseUrl}/health`);
    const missingAuth = await getJson(`${running.baseUrl}/visualizer/snapshot`);
    const snapshot = await getJson(`${running.baseUrl}/visualizer/snapshot`, authHeaders(apiKey));
    const offload = await getJson(`${running.baseUrl}/visualizer/offload`, authHeaders(apiKey));

    expect(health.status).toBe(200);
    expect(missingAuth.status).toBe(401);
    expect(snapshot.status).toBe(200);
    expect(snapshot.body).toMatchObject({ persona: { profileId: "profile:v1:fixture" } });
    expect(offload.body).toMatchObject({
      canvases: { total: 1, items: [expect.objectContaining({ canvasId: "mmd:001" })] },
      references: { total: 1, items: [expect.objectContaining({ toolCallId: "call-001" })] },
    });
  });

  it("fails closed for visualizer endpoints when Gateway API key is not configured", async () => {
    const running = await startGateway({ apiKey: undefined });

    const snapshot = await getJson(`${running.baseUrl}/visualizer/snapshot`);
    const requests = await getJson(`${running.baseUrl}/visualizer/requests`);
    const summary = await getJson(`${running.baseUrl}/visualizer/requests/summary`);

    expect(snapshot.status).toBe(503);
    expect(snapshot.body).toMatchObject({ error: "Gateway visualizer API requires TDAI_GATEWAY_API_KEY" });
    expect(requests).toMatchObject({ status: 503, body: { error: "Gateway visualizer API requires TDAI_GATEWAY_API_KEY" } });
    expect(summary).toMatchObject({ status: 503, body: { error: "Gateway visualizer API requires TDAI_GATEWAY_API_KEY" } });
  });

  it("serves merged sanitized request telemetry page and summary through protected Gateway endpoints", async () => {
    const telemetryDir = await tempDir("tdai-gateway-visualizer-requests-");
    setTelemetryEnv({ TDAI_GATEWAY_TELEMETRY_DIR: telemetryDir, TDAI_TELEMETRY_DIR: undefined });
    await writeTelemetryFile(telemetryDir, "gateway", [
      unsafeTelemetryRecord({
        id: "gateway-latest",
        source: "gateway",
        path: "/recall",
        routePattern: "/recall",
        statusCode: 500,
        latencyMs: 55,
        authType: "gateway_api_key",
        createdAt: "2026-06-02T00:03:00.000Z",
      }),
      unsafeTelemetryRecord({
        id: "gateway-mid",
        source: "gateway",
        path: "/search/memories",
        routePattern: "/search/memories",
        statusCode: 200,
        latencyMs: 20,
        authType: "gateway_api_key",
        createdAt: "2026-06-02T00:01:00.000Z",
      }),
    ]);
    await writeTelemetryFile(telemetryDir, "visualizer-api", [
      unsafeTelemetryRecord({
        id: "visualizer-newest",
        source: "visualizer-api",
        path: "/api/requests",
        routePattern: "/api/*",
        statusCode: 401,
        latencyMs: null,
        authType: "visualizer_api_key",
        createdAt: "2026-06-02T00:04:00.000Z",
      }),
      unsafeTelemetryRecord({
        id: "visualizer-second",
        source: "visualizer-api",
        path: "/api/snapshot",
        routePattern: "/api/*",
        statusCode: 200,
        latencyMs: 10,
        authType: "visualizer_api_key",
        createdAt: "2026-06-02T00:02:00.000Z",
      }),
    ]);

    const running = await startGateway();
    const missingAuth = await getJson(`${running.baseUrl}/visualizer/requests?limit=2&offset=1`);
    const page = await getJson(`${running.baseUrl}/visualizer/requests?limit=2&offset=1&token=raw-secret`, authHeaders(apiKey));
    const summary = await getJson(`${running.baseUrl}/visualizer/requests/summary`, authHeaders(apiKey));

    expect(missingAuth.status).toBe(401);
    expect(page.status).toBe(200);
    expect(page.body).toMatchObject({ total: 4, offset: 1, limit: 2, warnings: [] });
    expect(page.body.items).toEqual([
      expect.objectContaining({ id: "gateway-latest", source: "gateway", path: "/recall", statusCode: 500 }),
      expect.objectContaining({ id: "visualizer-second", source: "visualizer-api", path: "/api/snapshot", statusCode: 200 }),
    ]);
    expect(summary.status).toBe(200);
    expect(summary.body).toMatchObject({
      total: 4,
      recent5xx: [expect.objectContaining({ id: "gateway-latest" })],
      sources: [
        expect.objectContaining({ key: "visualizer-api", count: 2, unauthorizedCount: 1 }),
        expect.objectContaining({ key: "gateway", count: 2, errorCount: 1 }),
      ],
    });

    const serialized = JSON.stringify({ page: page.body, summary: summary.body });
    for (const forbidden of [
      "token=raw-secret",
      "raw-secret",
      "my-secret-password",
      "secret-token",
      "secret-cookie",
      "Authorization",
      "Cookie",
      "token=",
      telemetryDir,
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("returns sanitized 400 errors for invalid telemetry pagination", async () => {
    const telemetryDir = await tempDir("tdai-gateway-visualizer-requests-invalid-");
    setTelemetryEnv({ TDAI_GATEWAY_TELEMETRY_DIR: telemetryDir, TDAI_TELEMETRY_DIR: undefined });
    const running = await startGateway();

    const badLimit = await getJson(`${running.baseUrl}/visualizer/requests?limit=bad`, authHeaders(apiKey));
    const badOffset = await getJson(`${running.baseUrl}/visualizer/requests?offset=-1`, authHeaders(apiKey));

    expect(badLimit).toMatchObject({ status: 400, body: { error: "Telemetry limit must be a non-negative integer." } });
    expect(badOffset).toMatchObject({ status: 400, body: { error: "Telemetry offset must be a non-negative integer." } });
    expect(JSON.stringify({ badLimit, badOffset })).not.toContain("detail");
  });

  it("redacts telemetry warning details for capped, missing, oversized, corrupt, and unsafe directory cases", async () => {
    const telemetryDir = await tempDir("tdai-gateway-visualizer-requests-warnings-");
    setTelemetryEnv({ TDAI_GATEWAY_TELEMETRY_DIR: telemetryDir, TDAI_TELEMETRY_DIR: undefined });
    await writeLargeCorruptTelemetryFile(telemetryDir, "gateway", unsafeTelemetryRecord({
      id: "gateway-tail",
      source: "gateway",
      path: "/recall",
      routePattern: "/recall",
      createdAt: "2026-06-02T00:05:00.000Z",
      statusCode: 200,
    }));
    const running = await startGateway();

    const page = await getJson(`${running.baseUrl}/visualizer/requests?limit=99999`, authHeaders(apiKey));
    const summary = await getJson(`${running.baseUrl}/visualizer/requests/summary`, authHeaders(apiKey));

    expect(page.status).toBe(200);
    expect(page.body).toMatchObject({ total: 1, offset: 0, limit: 200 });
    expect(page.body.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "telemetry-limit-capped", detail: null }),
      expect.objectContaining({ code: "telemetry-file-too-large", source: "gateway", detail: null }),
      expect.objectContaining({ code: "telemetry-line-corrupt", source: "gateway", detail: null }),
      expect.objectContaining({ code: "telemetry-file-missing", source: "visualizer-api", detail: null }),
    ]));

    expect(summary.status).toBe(200);
    expect(summary.body).toMatchObject({ total: 1 });
    expect(summary.body.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "telemetry-file-too-large", source: "gateway", detail: null }),
      expect.objectContaining({ code: "telemetry-line-corrupt", source: "gateway", detail: null }),
      expect.objectContaining({ code: "telemetry-file-missing", source: "visualizer-api", detail: null }),
    ]));

    const unsafePage = await withTelemetryEnv({ TDAI_GATEWAY_TELEMETRY_DIR: running.dataDir, TDAI_TELEMETRY_DIR: undefined }, async () =>
      getJson(`${running.baseUrl}/visualizer/requests`, authHeaders(apiKey))
    );
    const unsafeSummary = await withTelemetryEnv({ TDAI_GATEWAY_TELEMETRY_DIR: running.dataDir, TDAI_TELEMETRY_DIR: undefined }, async () =>
      getJson(`${running.baseUrl}/visualizer/requests/summary`, authHeaders(apiKey))
    );

    expect(unsafePage).toMatchObject({
      status: 200,
      body: {
        total: 0,
        warnings: [expect.objectContaining({ code: "telemetry-dir-unsafe", source: "gateway", detail: null })],
      },
    });
    expect(unsafeSummary).toMatchObject({
      status: 200,
      body: {
        total: 0,
        warnings: [expect.objectContaining({ code: "telemetry-dir-unsafe", source: "gateway", detail: null })],
      },
    });

    for (const payload of [page.body, summary.body, unsafePage.body, unsafeSummary.body]) {
      const serialized = JSON.stringify(payload);
      expect(serialized).not.toContain(telemetryDir);
      expect(serialized).not.toContain(running.dataDir);
      expect(serialized).not.toContain("filePath");
      expect(serialized).not.toContain("telemetryDir");
      expect(serialized).not.toContain("unsafeRoot");
      expect(serialized).not.toContain("my-secret-password");
      expect(serialized).not.toContain("secret-token");
      expect(serialized).not.toContain("secret-cookie");
      expect(serialized).not.toContain("Authorization");
      expect(serialized).not.toContain("Cookie");
      expect(serialized).not.toContain("token=");
    }
  });
});

describe("TdaiGateway request telemetry", () => {
  it("records sanitized Gateway request telemetry for success, unauthorized, not-found, thrown 500, and classified routes", async () => {
    const telemetryDir = await tempDir("tdai-gateway-telemetry-");
    setTelemetryEnv({ TDAI_GATEWAY_TELEMETRY_DIR: telemetryDir, TDAI_TELEMETRY_DIR: undefined });
    const running = await startGateway();
    mockGatewayCore(running.gateway);

    const recall = await postJson(`${running.baseUrl}/recall?limit=5&token=raw-query-secret`, {
      query: "recall secret should not persist",
      session_key: "session-secret",
    }, authHeaders(apiKey));
    const unauthorized = await postJson(`${running.baseUrl}/recall`, { query: "blocked", session_key: "s1" });
    const missing = await getJson(`${running.baseUrl}/missing-route`, authHeaders(apiKey));
    const thrown = await getJson(`${running.baseUrl}/visualizer/scenes?limit=bad`, authHeaders(apiKey));
    const snapshot = await getJson(`${running.baseUrl}/visualizer/snapshot?source=fixture-source&token=visualizer-secret`, authHeaders(apiKey));

    expect(recall).toMatchObject({ status: 200, body: { strategy: "hybrid", memory_count: 1 } });
    expect(unauthorized).toMatchObject({ status: 401 });
    expect(missing).toMatchObject({ status: 404 });
    expect(thrown).toMatchObject({ status: 500 });
    expect(snapshot).toMatchObject({ status: 200 });

    const records = await waitForGatewayRecords(telemetryDir, 5);
    expect(records.map((record) => ({ path: record.path, statusCode: record.statusCode, outcome: record.outcome, routePattern: record.routePattern }))).toEqual([
      { path: "/recall", statusCode: 200, outcome: "ok", routePattern: "/recall" },
      { path: "/recall", statusCode: 401, outcome: "unauthorized", routePattern: "/recall" },
      { path: "/missing-route", statusCode: 404, outcome: "ok", routePattern: "GET unknown" },
      { path: "/visualizer/scenes", statusCode: 500, outcome: "error", routePattern: "/visualizer/*" },
      { path: "/visualizer/snapshot", statusCode: 200, outcome: "ok", routePattern: "/visualizer/*" },
    ]);
    expect(records[0].queryKeys).toEqual(["limit"]);
    expect(records.every((record) => record.source === "gateway" && record.authType === "gateway_api_key")).toBe(true);

    const serialized = JSON.stringify(records);
    for (const forbidden of ["raw-query-secret", "recall secret", "session-secret", apiKey, "fixture-source", "visualizer-secret", "token="]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("records /search/memories without persisting request body, query values, or header secrets", async () => {
    const telemetryDir = await tempDir("tdai-gateway-telemetry-safe-");
    setTelemetryEnv({ TDAI_GATEWAY_TELEMETRY_DIR: telemetryDir, TDAI_TELEMETRY_DIR: undefined });
    const running = await startGateway();
    mockGatewayCore(running.gateway);

    const response = await postJson(`${running.baseUrl}/search/memories?limit=7&source=client-secret-source&api_key=query-api-secret`, {
      query: "prompt memory content secret",
      type: "episodic-secret",
      scene: "scene-secret",
    }, {
      ...authHeaders(apiKey),
      Cookie: "session_cookie_secret=1",
      "X-Api-Key": "header-api-secret",
    });

    expect(response).toMatchObject({ status: 200, body: { total: 1, strategy: "hybrid" } });
    const records = await waitForGatewayRecords(telemetryDir, 1);
    expect(records[0]).toMatchObject({ path: "/search/memories", routePattern: "/search/memories", queryKeys: ["limit", "source"], statusCode: 200 });

    const serialized = JSON.stringify(records);
    for (const forbidden of [
      "prompt memory content secret",
      "episodic-secret",
      "scene-secret",
      "client-secret-source",
      "query-api-secret",
      "session_cookie_secret",
      "header-api-secret",
      "Authorization",
      "Cookie",
      "Bearer",
      "X-Api-Key",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("skips /health and request monitor DTO endpoints", async () => {
    const telemetryDir = await tempDir("tdai-gateway-telemetry-skip-");
    setTelemetryEnv({ TDAI_GATEWAY_TELEMETRY_DIR: telemetryDir, TDAI_TELEMETRY_DIR: undefined });
    await writeTelemetryFile(telemetryDir, "gateway", [
      unsafeTelemetryRecord({ id: "existing-gateway", source: "gateway", path: "/recall", routePattern: "/recall", createdAt: "2026-06-02T00:00:00.000Z" }),
    ]);
    const running = await startGateway();

    expect(await getJson(`${running.baseUrl}/health`)).toMatchObject({ status: 200 });
    expect(await getJson(`${running.baseUrl}/visualizer/requests`, authHeaders(apiKey))).toMatchObject({
      status: 200,
      body: { total: 1, items: [expect.objectContaining({ id: "existing-gateway" })] },
    });
    expect(await getJson(`${running.baseUrl}/visualizer/requests/summary`, authHeaders(apiKey))).toMatchObject({
      status: 200,
      body: { total: 1 },
    });

    await waitForTelemetryIdle();
    expect(await readGatewayRecords(telemetryDir)).toEqual([
      expect.objectContaining({ id: "existing-gateway" }),
    ]);
  });

  it("resolves Gateway telemetry env before shared telemetry env and disables telemetry when both are unset", async () => {
    const gatewayTelemetryDir = await tempDir("tdai-gateway-telemetry-specific-");
    const sharedTelemetryDir = await tempDir("tdai-gateway-telemetry-shared-");
    setTelemetryEnv({ TDAI_GATEWAY_TELEMETRY_DIR: gatewayTelemetryDir, TDAI_TELEMETRY_DIR: sharedTelemetryDir });
    const running = await startGateway();
    mockGatewayCore(running.gateway);

    expect(await postJson(`${running.baseUrl}/recall`, { query: "q", session_key: "s1" }, authHeaders(apiKey))).toMatchObject({ status: 200 });
    expect(await waitForGatewayRecords(gatewayTelemetryDir, 1)).toHaveLength(1);
    expect(await readGatewayRecords(sharedTelemetryDir)).toEqual([]);

    const disabled = await startGateway();
    mockGatewayCore(disabled.gateway);
    setTelemetryEnv({ TDAI_GATEWAY_TELEMETRY_DIR: undefined, TDAI_TELEMETRY_DIR: undefined });
    expect(await postJson(`${disabled.baseUrl}/recall`, { query: "disabled", session_key: "s1" }, authHeaders(apiKey))).toMatchObject({ status: 200 });
    await waitForTelemetryIdle();
    expect(await readGatewayRecords(gatewayTelemetryDir)).toHaveLength(1);
    expect(await readGatewayRecords(sharedTelemetryDir)).toEqual([]);
  });

  it("fails open when telemetry append storage is unwritable", async () => {
    const root = await tempDir("tdai-gateway-telemetry-failopen-");
    const telemetryFilePath = path.join(root, "not-a-directory");
    await writeFile(telemetryFilePath, "occupied", "utf-8");
    setTelemetryEnv({ TDAI_GATEWAY_TELEMETRY_DIR: telemetryFilePath, TDAI_TELEMETRY_DIR: undefined });
    const running = await startGateway();
    mockGatewayCore(running.gateway);

    const response = await postJson(`${running.baseUrl}/recall`, { query: "q", session_key: "s1" }, authHeaders(apiKey));

    expect(response).toMatchObject({ status: 200, body: { strategy: "hybrid" } });
    await waitForTelemetryIdle();
    await expect(readFile(telemetryFilePath, "utf-8")).resolves.toBe("occupied");
  });
});

async function startGateway(options: { readonly apiKey?: string } = { apiKey }): Promise<{ readonly gateway: TdaiGateway; readonly baseUrl: string; readonly dataDir: string }> {
  const dataDir = await copyFixtureToTempDir();
  const gateway = new TdaiGateway({
    server: { host: "127.0.0.1", port: 0, apiKey: options.apiKey, corsOrigins: [] },
    data: { baseDir: dataDir },
    llm: { baseUrl: "http://llm.test/v1", apiKey: "llm-test-key", model: "test-model", maxTokens: 1024, timeoutMs: 1_000 },
  });
  gateways.push(gateway);
  await gateway.start();

  const server = (gateway as unknown as { readonly server: Server | null }).server;
  const address = server?.address();
  if (typeof address !== "object" || address === null) throw new Error("Expected TCP server address.");
  return { gateway, baseUrl: `http://127.0.0.1:${address.port}`, dataDir };
}

async function copyFixtureToTempDir(): Promise<string> {
  const dataDir = await tempDir("tdai-gateway-visualizer-");
  await cp(fixtureRoot, dataDir, { recursive: true });
  return dataDir;
}

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function getJson(url: string, headers?: HeadersInit): Promise<{ readonly status: number; readonly body: Record<string, unknown> }> {
  const response = await fetch(url, { headers });
  return { status: response.status, body: await response.json() };
}

async function postJson(url: string, body: unknown, headers?: HeadersInit): Promise<{ readonly status: number; readonly body: Record<string, unknown> }> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(headers ?? {}) },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

function authHeaders(token: string): HeadersInit {
  return { Authorization: `Bearer ${token}` };
}

function mockGatewayCore(gateway: TdaiGateway): void {
  const core = (gateway as unknown as { readonly core: {
    handleBeforeRecall: unknown;
    searchMemories: unknown;
  } }).core;
  core.handleBeforeRecall = vi.fn(async () => ({
    appendSystemContext: "safe context",
    recallStrategy: "hybrid",
    recalledL1Memories: [{ content: "safe memory", score: 1, type: "episodic" }],
  }));
  core.searchMemories = vi.fn(async () => ({ text: "safe results", total: 1, strategy: "hybrid" }));
}

async function waitForGatewayRecords(telemetryDir: string, count: number): Promise<readonly SanitizedRequestLog[]> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const records = await readGatewayRecords(telemetryDir);
    if (records.length >= count) return records;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return readGatewayRecords(telemetryDir);
}

async function readGatewayRecords(telemetryDir: string): Promise<readonly SanitizedRequestLog[]> {
  try {
    const content = await readFile(path.join(telemetryDir, REQUEST_TELEMETRY_GATEWAY_FILE), "utf-8");
    return content.trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as SanitizedRequestLog);
  } catch {
    return [];
  }
}

async function waitForTelemetryIdle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 80));
}

function setTelemetryEnv(values: Partial<Record<typeof telemetryEnvKeys[number], string | undefined>>): void {
  for (const key of telemetryEnvKeys) {
    const value = values[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function restoreTelemetryEnv(): void {
  for (const key of telemetryEnvKeys) {
    const value = originalTelemetryEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function unsafeTelemetryRecord(overrides: {
  readonly id: string;
  readonly source: RequestTelemetrySource;
  readonly createdAt: string;
  readonly path: string;
  readonly routePattern: string;
  readonly statusCode?: number | null;
  readonly latencyMs?: number | null;
  readonly authType?: SanitizedRequestLog["authType"];
}): SanitizedRequestLog & Record<string, unknown> {
  return {
    id: overrides.id,
    source: overrides.source,
    method: "GET",
    path: overrides.path,
    routePattern: overrides.routePattern,
    statusCode: overrides.statusCode ?? 200,
    outcome: (overrides.statusCode ?? 200) >= 500 ? "error" : (overrides.statusCode ?? 200) === 401 ? "unauthorized" : "ok",
    latencyMs: overrides.latencyMs ?? 12,
    authType: overrides.authType ?? "none",
    createdAt: overrides.createdAt,
    queryKeys: ["limit"],
    warningCodes: [],
    query: "limit=1&token=secret-token",
    body: "my-secret-password",
    headers: { Authorization: "Bearer secret-token", Cookie: "secret-cookie=1" },
    response: "secret-token response",
    memory: "secret-cookie memory",
    localPath: "D:/secret/local/path",
  };
}

async function writeTelemetryFile(
  telemetryDir: string,
  source: RequestTelemetrySource,
  lines: readonly (Record<string, unknown> | SanitizedRequestLog)[],
): Promise<void> {
  const content = lines.map((line) => JSON.stringify(line)).join("\n") + "\n";
  await writeFile(path.join(telemetryDir, requestTelemetryFileNameForSource(source)), content, "utf-8");
}

async function writeLargeCorruptTelemetryFile(
  telemetryDir: string,
  source: RequestTelemetrySource,
  tailRecord: Record<string, unknown>,
): Promise<void> {
  const largePrefix = "x".repeat(REQUEST_TELEMETRY_MAX_FILE_BYTES + 64);
  const content = `${largePrefix}\nnot-json\n${JSON.stringify(tailRecord)}\n`;
  await writeFile(path.join(telemetryDir, requestTelemetryFileNameForSource(source)), content, "utf-8");
}

async function withTelemetryEnv<T>(
  values: Partial<Record<typeof telemetryEnvKeys[number], string | undefined>>,
  run: () => Promise<T>,
): Promise<T> {
  const previous = Object.fromEntries(telemetryEnvKeys.map((key) => [key, process.env[key]])) as Record<typeof telemetryEnvKeys[number], string | undefined>;
  setTelemetryEnv(values);
  try {
    return await run();
  } finally {
    setTelemetryEnv(previous);
  }
}
