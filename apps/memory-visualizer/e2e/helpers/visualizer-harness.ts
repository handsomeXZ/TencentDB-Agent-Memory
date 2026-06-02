import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { extname, join, normalize, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createVisualizerServer } from "../../src/server";

import type { GatewayFetch } from "../../src/providers";

const appRoot = fileURLToPath(new URL("../..", import.meta.url));
const repoRoot = fileURLToPath(new URL("../../../..", import.meta.url));
const distRoot = resolve(appRoot, "dist");
const fixturesRoot = resolve(appRoot, "fixtures");
const completeDataDir = resolve(fixturesRoot, "complete-data-dir");
const mimeTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".svg", "image/svg+xml"],
]);

export interface VisualizerHarness {
  readonly baseUrl: string;
  readonly repoRoot: string;
  readonly fixtureRoot: string;
  readonly close: () => Promise<void>;
}

export interface VisualizerHarnessOptions {
  readonly dataDir?: string;
  readonly offloadRootPath?: string;
  readonly gatewayBaseUrl?: string | null;
  readonly gatewayFetch?: GatewayFetch;
  readonly telemetryDir?: string;
  readonly visualizerApiKey?: string;
}

export function resolveVisualizerFixturePath(...paths: string[]): string {
  return resolve(fixturesRoot, ...paths);
}

export async function startVisualizerHarness(options: VisualizerHarnessOptions = {}): Promise<VisualizerHarness> {
  const apiServer = createVisualizerServer({
    appConfig: {
      dataDir: options.dataDir ?? completeDataDir,
      offloadRootPath: options.offloadRootPath ?? join(options.dataDir ?? completeDataDir, "offload"),
      gatewayBaseUrl: options.gatewayBaseUrl ?? null,
    },
    env: {
      ...(options.visualizerApiKey ? { TDAI_VIS_API_KEY: options.visualizerApiKey } : {}),
      ...(options.telemetryDir ? { TDAI_VIS_TELEMETRY_DIR: options.telemetryDir } : {}),
    },
    fetch: options.gatewayFetch,
  });
  await listenServer(apiServer);
  const apiBaseUrl = serverBaseUrl(apiServer);

  const staticServer = createServer((request, response) => {
    void handleStaticRequest(request, response, apiBaseUrl);
  });
  await listenServer(staticServer);

  return {
    baseUrl: serverBaseUrl(staticServer),
    repoRoot,
    fixtureRoot: completeDataDir,
    close: async () => {
      await closeServer(staticServer);
      await closeServer(apiServer);
    },
  };
}

async function handleStaticRequest(request: IncomingMessage, response: ServerResponse, apiBaseUrl: string): Promise<void> {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");

  if (url.pathname === "/health" || url.pathname.startsWith("/api/")) {
    await proxyRequest(request, response, `${apiBaseUrl}${url.pathname}${url.search}`);
    return;
  }

  const filePath = await resolveDistPath(url.pathname);
  if (filePath === null) {
    response.writeHead(404);
    response.end("not found");
    return;
  }

  response.writeHead(200, {
    "content-type": mimeTypes.get(extname(filePath)) ?? "application/octet-stream",
  });
  createReadStream(filePath).pipe(response);
}

async function proxyRequest(request: IncomingMessage, response: ServerResponse, targetUrl: string): Promise<void> {
  const method = request.method ?? "GET";
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const proxied = await fetch(targetUrl, {
    method,
    headers: request.headers as HeadersInit,
    body: method === "GET" || method === "HEAD" ? undefined : Buffer.concat(chunks),
  });
  const body = Buffer.from(await proxied.arrayBuffer());
  response.writeHead(proxied.status, {
    "content-type": proxied.headers.get("content-type") ?? "application/octet-stream",
    "cache-control": proxied.headers.get("cache-control") ?? "no-store",
  });
  response.end(body);
}

async function resolveDistPath(pathname: string): Promise<string | null> {
  const requested = pathname === "/" ? "index.html" : pathname.slice(1);
  const absolutePath = normalize(join(distRoot, requested));
  const safePath = relative(distRoot, absolutePath).startsWith("..") ? join(distRoot, "index.html") : absolutePath;

  try {
    const fileStat = await stat(safePath);
    if (fileStat.isFile()) return safePath;
  } catch {
    // Fall through to SPA index.
  }

  const indexPath = join(distRoot, "index.html");
  try {
    const indexStat = await stat(indexPath);
    return indexStat.isFile() ? indexPath : null;
  } catch {
    return null;
  }
}

async function listenServer(server: Server): Promise<void> {
  await new Promise<void>((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", () => resolveListen());
  });
}

async function closeServer(server: Server): Promise<void> {
  if (!server.listening) return;
  await new Promise<void>((resolveClose, rejectClose) => {
    server.close((error) => (error ? rejectClose(error) : resolveClose()));
  });
}

function serverBaseUrl(server: Server): string {
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Expected TCP server address.");
  return `http://127.0.0.1:${address.port}`;
}
