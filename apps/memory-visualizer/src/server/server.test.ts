import { type Server } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createVisualizerServer } from "./index";

import type { GatewayFetch, GatewayFetchResponse, GatewayRequestInit } from "../providers";

const appRoot = fileURLToPath(new URL("../..", import.meta.url));
const fixtureRoot = path.join(appRoot, "fixtures", "complete-data-dir");
const secret = "sk-test-secret-1234567890";

interface RunningServer {
  readonly server: Server;
  readonly baseUrl: string;
}

const servers: Server[] = [];

afterEach(async () => {
  const pending = servers.splice(0, servers.length);
  await Promise.all(pending.map(closeServer));
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

async function startServer(gatewayFetch?: GatewayFetch, gatewayTimeoutMs = 50): Promise<RunningServer> {
  const server = createVisualizerServer({
    appConfig: {
      dataDir: fixtureRoot,
      offloadRootPath: path.join(fixtureRoot, "offload"),
      gatewayBaseUrl: "http://gateway.test",
      gatewayApiKeyEnv: "TDAI_VIS_GATEWAY_API_KEY",
    },
    env: { TDAI_VIS_GATEWAY_API_KEY: secret },
    fetch: gatewayFetch,
    gatewayTimeoutMs,
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

async function getJson(url: string): Promise<{ readonly status: number; readonly body: Record<string, unknown> }> {
  const response = await fetch(url);
  return { status: response.status, body: await response.json() };
}

async function postJson(url: string, body: Record<string, unknown>): Promise<{ readonly status: number; readonly body: Record<string, unknown> }> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
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

function waitForAbort(signal: AbortSignal | null): Promise<GatewayFetchResponse> {
  return new Promise((_, reject) => {
    if (signal?.aborted) {
      reject(new Error("aborted"));
      return;
    }
    signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
  });
}
