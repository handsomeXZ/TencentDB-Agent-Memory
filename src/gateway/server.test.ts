import { type Server } from "node:http";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { TdaiGateway } from "./server.js";

const fixtureRoot = fileURLToPath(new URL("../../apps/memory-visualizer/fixtures/complete-data-dir", import.meta.url));
const apiKey = "gateway-visualizer-test-key";

const gateways: TdaiGateway[] = [];
const tempDirs: string[] = [];

afterEach(async () => {
  const pending = gateways.splice(0, gateways.length);
  await Promise.all(pending.map((gateway) => gateway.stop()));
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

    expect(snapshot.status).toBe(503);
    expect(snapshot.body).toMatchObject({ error: "Gateway visualizer API requires TDAI_GATEWAY_API_KEY" });
  });
});

async function startGateway(options: { readonly apiKey?: string } = { apiKey }): Promise<{ readonly gateway: TdaiGateway; readonly baseUrl: string }> {
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
  return { gateway, baseUrl: `http://127.0.0.1:${address.port}` };
}

async function copyFixtureToTempDir(): Promise<string> {
  const dataDir = await mkdtemp(path.join(tmpdir(), "tdai-gateway-visualizer-"));
  tempDirs.push(dataDir);
  await cp(fixtureRoot, dataDir, { recursive: true });
  return dataDir;
}

async function getJson(url: string, headers?: HeadersInit): Promise<{ readonly status: number; readonly body: Record<string, unknown> }> {
  const response = await fetch(url, { headers });
  return { status: response.status, body: await response.json() };
}

function authHeaders(token: string): HeadersInit {
  return { Authorization: `Bearer ${token}` };
}
