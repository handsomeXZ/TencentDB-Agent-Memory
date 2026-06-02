import { appendFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createSanitizedRequestLog } from "./request-telemetry.js";
import {
  REQUEST_TELEMETRY_GATEWAY_FILE,
  REQUEST_TELEMETRY_MAX_FILE_BYTES,
  REQUEST_TELEMETRY_VISUALIZER_FILE,
  appendRequestTelemetryLog,
  readRequestTelemetryPage,
  readRequestTelemetrySummary,
  requestTelemetryFileNameForSource,
  resolveRequestTelemetryDirectory,
} from "./request-telemetry-store.js";

import type { RequestTelemetryFileSystem } from "./request-telemetry-store.js";
import type { RequestTelemetrySource, SanitizedRequestLog } from "./request-telemetry.js";

const tempDirs: string[] = [];

afterEach(async () => {
  const dirs = tempDirs.splice(0, tempDirs.length);
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("request telemetry storage directory resolution", () => {
  it("resolves Gateway, Visualizer, and generic telemetry directory inputs without reading process.env", async () => {
    const root = await tempDir("tdai-telemetry-env-");
    const gatewayDir = path.join(root, "gateway");
    const visualizerDir = path.join(root, "visualizer");
    const genericDir = path.join(root, "generic");
    const env = {
      TDAI_GATEWAY_TELEMETRY_DIR: gatewayDir,
      TDAI_VIS_TELEMETRY_DIR: visualizerDir,
      TDAI_TELEMETRY_DIR: genericDir,
    };

    expect(resolveRequestTelemetryDirectory({ source: "gateway", env })).toMatchObject({ ok: true, dir: path.resolve(gatewayDir), envKey: "TDAI_GATEWAY_TELEMETRY_DIR" });
    expect(resolveRequestTelemetryDirectory({ source: "visualizer-api", env })).toMatchObject({ ok: true, dir: path.resolve(visualizerDir), envKey: "TDAI_VIS_TELEMETRY_DIR" });
    expect(resolveRequestTelemetryDirectory({ source: "shared", env })).toMatchObject({ ok: true, dir: path.resolve(genericDir), envKey: "TDAI_TELEMETRY_DIR" });
    expect(resolveRequestTelemetryDirectory({ source: "gateway", env: { TDAI_TELEMETRY_DIR: genericDir } })).toMatchObject({ ok: true, dir: path.resolve(genericDir), envKey: "TDAI_TELEMETRY_DIR" });
  });

  it("flags telemetry directories inside protected memory roots as unsafe", async () => {
    const root = await tempDir("tdai-telemetry-unsafe-");
    const memoryRoot = path.join(root, "memory-root");
    const telemetryDir = path.join(memoryRoot, "telemetry");

    const result = resolveRequestTelemetryDirectory({ telemetryDir, unsafeRootDirs: [memoryRoot] });

    expect(result.ok).toBe(false);
    expect(result.dir).toBe(path.resolve(telemetryDir));
    expect(result.warnings).toEqual([expect.objectContaining({ code: "telemetry-dir-unsafe", source: "shared" })]);
  });
});

describe("request telemetry append-only writer", () => {
  it("appends Gateway and Visualizer records into separate JSONL files without rewriting existing content", async () => {
    const telemetryDir = await tempDir("tdai-telemetry-write-");
    await mkdir(telemetryDir, { recursive: true });
    const gatewayPath = path.join(telemetryDir, REQUEST_TELEMETRY_GATEWAY_FILE);
    await writeFile(gatewayPath, `${JSON.stringify(log({ id: "old-gateway", source: "gateway", createdAt: "2026-06-01T00:00:00.000Z" }))}\n`, "utf-8");
    const beforeSize = (await stat(gatewayPath)).size;

    const gatewayWrite = await appendRequestTelemetryLog(log({ id: "new-gateway", source: "gateway", createdAt: "2026-06-01T00:01:00.000Z" }), { source: "gateway", telemetryDir });
    const visualizerWrite = await appendRequestTelemetryLog(log({ id: "new-visualizer", source: "visualizer-api", createdAt: "2026-06-01T00:02:00.000Z" }), { source: "visualizer-api", telemetryDir });

    expect(gatewayWrite).toMatchObject({ ok: true, filePath: gatewayPath, warnings: [] });
    expect(visualizerWrite).toMatchObject({ ok: true, filePath: path.join(telemetryDir, REQUEST_TELEMETRY_VISUALIZER_FILE), warnings: [] });
    expect((await stat(gatewayPath)).size).toBeGreaterThan(beforeSize);
    expect(await readJsonlIds(gatewayPath)).toEqual(["old-gateway", "new-gateway"]);
    expect(await readJsonlIds(path.join(telemetryDir, REQUEST_TELEMETRY_VISUALIZER_FILE))).toEqual(["new-visualizer"]);
    expect(requestTelemetryFileNameForSource("gateway")).toBe("request-logs.gateway.jsonl");
    expect(requestTelemetryFileNameForSource("visualizer-api")).toBe("request-logs.visualizer.jsonl");
  });

  it("fails open and returns a warning when append storage is unwritable", async () => {
    const telemetryDir = await tempDir("tdai-telemetry-unwritable-");
    const throwingFs: RequestTelemetryFileSystem = {
      mkdir,
      readFile,
      stat,
      appendFile: async () => {
        throw new Error("simulated unwritable telemetry directory");
      },
    };

    const result = await appendRequestTelemetryLog(log({ id: "write-fails", source: "gateway" }), { source: "gateway", telemetryDir, fileSystem: throwingFs });

    expect(result.ok).toBe(false);
    expect(result.filePath).toBe(path.join(telemetryDir, REQUEST_TELEMETRY_GATEWAY_FILE));
    expect(result.warnings).toEqual([expect.objectContaining({ code: "telemetry-write-failed", source: "gateway" })]);
  });
});

describe("request telemetry bounded JSONL reader", () => {
  it("returns empty pages with warnings for missing telemetry directories and missing source files", async () => {
    const root = await tempDir("tdai-telemetry-missing-");
    const missingDir = path.join(root, "missing");
    const missingDirResult = await readRequestTelemetryPage({ telemetryDir: missingDir });

    expect(missingDirResult.ok).toBe(true);
    expect(missingDirResult.ok && missingDirResult.page.items).toEqual([]);
    expect(missingDirResult.ok && warningCodes(missingDirResult.page.warnings)).toContain("telemetry-dir-missing");

    const existingDir = path.join(root, "existing");
    await mkdir(existingDir, { recursive: true });
    const missingFileResult = await readRequestTelemetryPage({ telemetryDir: existingDir, sources: ["gateway"] });

    expect(missingFileResult.ok).toBe(true);
    expect(missingFileResult.ok && missingFileResult.page.items).toEqual([]);
    expect(missingFileResult.ok && warningCodes(missingFileResult.page.warnings)).toContain("telemetry-file-missing");
  });

  it("skips corrupt JSONL lines and reports the corrupt line count", async () => {
    const telemetryDir = await tempDir("tdai-telemetry-corrupt-");
    await writeTelemetryFile(telemetryDir, "gateway", [
      log({ id: "valid-1", source: "gateway", createdAt: "2026-06-01T00:00:00.000Z" }),
      "{not-json",
      { unsafe: "shape" },
      log({ id: "valid-2", source: "gateway", createdAt: "2026-06-01T00:02:00.000Z" }),
    ]);

    const result = await readRequestTelemetryPage({ telemetryDir, sources: ["gateway"] });

    expect(result.ok).toBe(true);
    expect(result.ok && result.page.items.map((item) => item.id)).toEqual(["valid-2", "valid-1"]);
    expect(result.ok && result.page.warnings).toEqual([expect.objectContaining({
      code: "telemetry-line-corrupt",
      detail: expect.objectContaining({ corruptLines: 2 }),
    })]);
  });

  it("warns on oversized files while returning newest readable records from the bounded tail", async () => {
    const telemetryDir = await tempDir("tdai-telemetry-oversized-");
    await mkdir(telemetryDir, { recursive: true });
    const filePath = path.join(telemetryDir, REQUEST_TELEMETRY_GATEWAY_FILE);
    const newest = log({ id: "tail-record", source: "gateway", createdAt: "2026-06-01T00:00:00.000Z" });
    await writeFile(filePath, Buffer.concat([
      Buffer.alloc(REQUEST_TELEMETRY_MAX_FILE_BYTES + 1, "x"),
      Buffer.from(`\n${JSON.stringify(newest)}\n`, "utf-8"),
    ]));

    const result = await readRequestTelemetryPage({ telemetryDir, sources: ["gateway"] });

    expect(result.ok).toBe(true);
    expect(result.ok && result.page.items.map((item) => item.id)).toEqual(["tail-record"]);
    expect(result.ok && warningCodes(result.page.warnings)).toContain("telemetry-file-too-large");
  });

  it("keeps only the newest 10000 valid records per file, merges sources newest-first, and caps page limits", async () => {
    const telemetryDir = await tempDir("tdai-telemetry-merge-");
    const gatewayRecords = Array.from({ length: 10_002 }, (_, index) => log({
      id: `gateway-${String(index).padStart(5, "0")}`,
      source: "gateway",
      createdAt: minute(index),
    }));
    await writeTelemetryFile(telemetryDir, "gateway", gatewayRecords);
    await writeTelemetryFile(telemetryDir, "visualizer-api", [
      log({ id: "visualizer-newest", source: "visualizer-api", createdAt: minute(20_000) }),
      log({ id: "visualizer-second", source: "visualizer-api", createdAt: minute(19_999) }),
    ]);

    const result = await readRequestTelemetryPage({ telemetryDir, limit: 500, offset: 0 });

    expect(result.ok).toBe(true);
    expect(result.ok && result.page.limit).toBe(200);
    expect(result.ok && result.page.total).toBe(10_002);
    expect(result.ok && result.page.items.slice(0, 4).map((item) => item.id)).toEqual([
      "visualizer-newest",
      "visualizer-second",
      "gateway-10001",
      "gateway-10000",
    ]);
    expect(result.ok && result.page.items.some((item) => item.id === "gateway-00000")).toBe(false);
    expect(result.ok && warningCodes(result.page.warnings)).toContain("telemetry-limit-capped");
  });

  it("returns typed validation errors for invalid limit and offset inputs", async () => {
    const telemetryDir = await tempDir("tdai-telemetry-validation-");

    await expect(readRequestTelemetryPage({ telemetryDir, limit: "not-a-number" })).resolves.toEqual({
      ok: false,
      error: expect.objectContaining({ code: "invalid-telemetry-pagination", field: "limit" }),
      warnings: [],
    });
    await expect(readRequestTelemetryPage({ telemetryDir, limit: 1.5 })).resolves.toEqual({
      ok: false,
      error: expect.objectContaining({ code: "invalid-telemetry-pagination", field: "limit" }),
      warnings: [],
    });
    await expect(readRequestTelemetryPage({ telemetryDir, offset: -1 })).resolves.toEqual({
      ok: false,
      error: expect.objectContaining({ code: "invalid-telemetry-pagination", field: "offset" }),
      warnings: [],
    });
  });
});

describe("request telemetry summary", () => {
  it("calculates total, last24h, error rate, p95 latency, recent 5xx, and source buckets", async () => {
    const telemetryDir = await tempDir("tdai-telemetry-summary-");
    await writeTelemetryFile(telemetryDir, "gateway", [
      log({ id: "gateway-ok", source: "gateway", createdAt: "2026-06-01T23:30:00.000Z", statusCode: 200, latencyMs: 10 }),
      log({ id: "gateway-5xx", source: "gateway", createdAt: "2026-06-01T23:40:00.000Z", statusCode: 503, latencyMs: 20 }),
      log({ id: "gateway-old", source: "gateway", createdAt: "2026-05-30T00:00:00.000Z", statusCode: 200, latencyMs: 30 }),
    ]);
    await writeTelemetryFile(telemetryDir, "visualizer-api", [
      log({ id: "visualizer-5xx", source: "visualizer-api", createdAt: "2026-06-01T23:50:00.000Z", statusCode: 500, latencyMs: 100 }),
      log({ id: "visualizer-401", source: "visualizer-api", createdAt: "2026-06-01T23:55:00.000Z", statusCode: 401, latencyMs: null }),
    ]);

    const summary = await readRequestTelemetrySummary({ telemetryDir, now: new Date("2026-06-02T00:00:00.000Z") });

    expect(summary).toMatchObject({
      generatedAt: "2026-06-02T00:00:00.000Z",
      total: 5,
      last24h: 4,
      errorRate: 0.4,
      p95LatencyMs: 100,
      recent5xx: [expect.objectContaining({ id: "visualizer-5xx" }), expect.objectContaining({ id: "gateway-5xx" })],
      warnings: [],
    });
    expect(summary.sources).toEqual([
      { key: "visualizer-api", count: 2, errorCount: 1, unauthorizedCount: 1, averageLatencyMs: 100 },
      { key: "gateway", count: 3, errorCount: 1, unauthorizedCount: 0, averageLatencyMs: 20 },
    ]);
  });
});

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function log(overrides: Partial<SanitizedRequestLog> & { readonly source: RequestTelemetrySource; readonly id?: string }): SanitizedRequestLog {
  const source = overrides.source;
  const record = createSanitizedRequestLog({
    id: overrides.id ?? `request:${source}:${overrides.createdAt ?? "default"}`,
    source,
    method: overrides.method ?? "GET",
    path: overrides.path ?? (source === "gateway" ? "/recall" : "/api/search"),
    statusCode: overrides.statusCode ?? 200,
    latencyMs: overrides.latencyMs ?? 12,
    authType: overrides.authType ?? "none",
    createdAt: overrides.createdAt ?? "2026-06-01T00:00:00.000Z",
    warningCodes: overrides.warningCodes ?? [],
  });
  if (!record) throw new Error("Expected telemetry test record to be stored.");
  return { ...record, ...overrides };
}

async function writeTelemetryFile(
  telemetryDir: string,
  source: RequestTelemetrySource,
  lines: readonly (SanitizedRequestLog | string | Record<string, unknown>)[],
): Promise<void> {
  await mkdir(telemetryDir, { recursive: true });
  const content = lines.map((line) => typeof line === "string" ? line : JSON.stringify(line)).join("\n") + "\n";
  await writeFile(path.join(telemetryDir, requestTelemetryFileNameForSource(source)), content, "utf-8");
}

async function readJsonlIds(filePath: string): Promise<readonly string[]> {
  const content = await readFile(filePath, "utf-8");
  return content.trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line).id as string);
}

function minute(index: number): string {
  return new Date(Date.UTC(2026, 5, 1, 0, index, 0)).toISOString();
}

function warningCodes(warnings: readonly { readonly code: string }[]): readonly string[] {
  return warnings.map((warning) => warning.code);
}
