import { type Server } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createProductionVisualizerServer, readListenOptions } from "./production";

const appRoot = fileURLToPath(new URL("../..", import.meta.url));
const fixtureRoot = path.join(appRoot, "fixtures", "complete-data-dir");
const staticRoot = fileURLToPath(new URL("./fixtures/dist", import.meta.url));
const visualizerSecret = "vis-test-secret-1234567890";

const servers: Server[] = [];

afterEach(async () => {
  const pending = servers.splice(0, servers.length);
  await Promise.all(pending.map(closeServer));
});

describe("production visualizer server", () => {
  it("serves read-only API routes, SPA fallback, and static asset 404s", async () => {
    const server = createProductionVisualizerServer({
      appConfig: {
        dataDir: fixtureRoot,
        offloadRootPath: path.join(fixtureRoot, "offload"),
        gatewayBaseUrl: null,
      },
      distRoot: staticRoot,
    });
    const baseUrl = await listenServer(server);

    const [health, snapshot, unknownApi, root, spa, asset, missing] = await Promise.all([
      fetchJson(`${baseUrl}/health`),
      fetchJson(`${baseUrl}/api/snapshot`),
      fetchJson(`${baseUrl}/api/gateway/capture`),
      fetchText(`${baseUrl}/`),
      fetchText(`${baseUrl}/memories`),
      fetchText(`${baseUrl}/assets/app.css`),
      fetchText(`${baseUrl}/assets/missing.css`),
    ]);

    expect(health.status).toBe(200);
    expect(health.body).toMatchObject({ ok: true, readOnly: true });
    expect(snapshot.status).toBe(200);
    expect(snapshot.body).toMatchObject({ persona: { profileId: "profile:v1:fixture" } });
    expect(unknownApi.status).toBe(404);
    expect(unknownApi.body).toMatchObject({ code: "route-not-found" });

    expect(root.status).toBe(200);
    expect(root.contentType).toContain("text/html");
    expect(root.body).toContain("Memory Visualizer Fixture");

    expect(spa.status).toBe(200);
    expect(spa.contentType).toContain("text/html");
    expect(spa.body).toContain("Memory Visualizer Fixture");

    expect(asset.status).toBe(200);
    expect(asset.contentType).toContain("text/css");
    expect(asset.body).toContain("font-family");

    expect(missing.status).toBe(404);
  });

  it("requires the configured visualizer Bearer token for API routes while leaving static SPA pages open", async () => {
    const server = createProductionVisualizerServer({
      appConfig: {
        dataDir: fixtureRoot,
        offloadRootPath: path.join(fixtureRoot, "offload"),
        gatewayBaseUrl: null,
      },
      distRoot: staticRoot,
      env: { TDAI_VIS_API_KEY: visualizerSecret },
    });
    const baseUrl = await listenServer(server);

    const health = await fetchJson(`${baseUrl}/health`);
    const missingApi = await fetchJson(`${baseUrl}/api/snapshot`);
    const wrongApi = await fetchJson(`${baseUrl}/api/snapshot`, authHeaders("wrong-token"));
    const validApi = await fetchJson(`${baseUrl}/api/snapshot`, authHeaders(visualizerSecret));
    const root = await fetchText(`${baseUrl}/`);
    const spa = await fetchText(`${baseUrl}/memories`);
    const asset = await fetchText(`${baseUrl}/assets/app.css`);

    expect(health.status).toBe(200);
    expect(health.body).toMatchObject({ ok: true, readOnly: true });
    expect(missingApi.status).toBe(401);
    expect(missingApi.body).toMatchObject({ code: "unauthorized" });
    expect(wrongApi.status).toBe(401);
    expect(wrongApi.body).toMatchObject({ code: "unauthorized" });
    expect(validApi.status).toBe(200);
    expect(validApi.body).toMatchObject({ persona: { profileId: "profile:v1:fixture" } });
    expect(root.status).toBe(200);
    expect(root.body).toContain("Memory Visualizer Fixture");
    expect(spa.status).toBe(200);
    expect(spa.body).toContain("Memory Visualizer Fixture");
    expect(asset.status).toBe(200);
    expect(asset.body).toContain("font-family");
  });

  it("reads listen options from TDAI_VIS_* first, then HOST/PORT, then defaults", () => {
    expect(readListenOptions({})).toEqual({ host: "127.0.0.1", port: 8421 });
    expect(readListenOptions({ HOST: "127.0.0.1", PORT: "9000" })).toEqual({ host: "127.0.0.1", port: 9000 });
    expect(readListenOptions({ TDAI_VIS_HOST: "192.168.0.5", TDAI_VIS_PORT: "7777", HOST: "127.0.0.1", PORT: "9000" })).toEqual({
      host: "192.168.0.5",
      port: 7777,
    });
  });

  it("redacts unexpected production errors from clients while logging server details", async () => {
    const internalPath = "index.html";
    const logger = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const server = createProductionVisualizerServer({ distRoot: `${path.join(staticRoot, internalPath)}\0` });
    const baseUrl = await listenServer(server);

    try {
      const response = await fetchText(`${baseUrl}/`);
      expect(response.status).toBe(500);
      expect(response.body).toBe("Internal Server Error");
      expect(response.body).not.toContain(internalPath);
      expect(logger).toHaveBeenCalledWith(expect.stringContaining(internalPath));
    } finally {
      logger.mockRestore();
    }
  });
});

async function listenServer(server: Server): Promise<string> {
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Expected TCP server address.");
  return `http://127.0.0.1:${address.port}`;
}

async function closeServer(server: Server): Promise<void> {
  if (!server.listening) return;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function fetchJson(url: string, headers?: HeadersInit): Promise<{ readonly status: number; readonly body: Record<string, unknown> }> {
  const response = await fetch(url, { headers });
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}

async function fetchText(url: string, headers?: HeadersInit): Promise<{ readonly status: number; readonly contentType: string; readonly body: string }> {
  const response = await fetch(url, { headers });
  return {
    status: response.status,
    contentType: response.headers.get("content-type") ?? "",
    body: await response.text(),
  };
}

function authHeaders(token: string): HeadersInit {
  return { Authorization: `Bearer ${token}` };
}
