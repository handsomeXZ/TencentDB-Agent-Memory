import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { extname, isAbsolute, join, normalize, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createVisualizerServer, type VisualizerServerOptions } from "./index";

const runtimeRoot = fileURLToPath(new URL("..", import.meta.url));
const distRoot = resolve(process.env.TDAI_VIS_DIST_DIR?.trim() || join(runtimeRoot, "dist"));
const defaultHost = "127.0.0.1";
const defaultPort = 8421;
const genericServerError = "Internal Server Error";

const mimeTypes = new Map<string, string>([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".map", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".txt", "text/plain; charset=utf-8"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
]);

export interface VisualizerProductionServerOptions extends VisualizerServerOptions {
  readonly distRoot?: string;
}

export interface VisualizerListenOptions {
  readonly host: string;
  readonly port: number;
}

export function createProductionVisualizerServer(options: VisualizerProductionServerOptions = {}): Server {
  const apiServer = createVisualizerServer(options);
  const staticRoot = resolve(options.distRoot ?? distRoot);

  return createServer((request, response) => {
    void routeRequest(apiServer, staticRoot, request, response).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      logUnexpectedError(error);
      if (response.headersSent) {
        response.destroy(error instanceof Error ? error : new Error(message));
        return;
      }
      response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      response.end(genericServerError);
    });
  });
}

export function readListenOptions(env: NodeJS.ProcessEnv = process.env): VisualizerListenOptions {
  const host = readHost(env);
  const port = readPort(env);
  return { host, port };
}

async function routeRequest(
  apiServer: Server,
  staticRoot: string,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const requestUrl = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
  const method = request.method?.toUpperCase() ?? "GET";

  if (requestUrl.pathname === "/health" || requestUrl.pathname.startsWith("/api/")) {
    apiServer.emit("request", request, response);
    return;
  }

  if (method !== "GET" && method !== "HEAD") {
    response.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Method Not Allowed");
    return;
  }

  const resolvedPath = await resolveStaticPath(staticRoot, requestUrl.pathname);
  if (resolvedPath === null) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not Found");
    return;
  }

  await sendStaticFile(response, resolvedPath, method === "HEAD");
}

async function resolveStaticPath(staticRoot: string, pathname: string): Promise<string | null> {
  const normalizedPath = pathname === "/" ? "/index.html" : pathname;
  const requestedPath = normalize(join(staticRoot, normalizedPath.slice(1)));

  if (!isPathWithinRoot(requestedPath, staticRoot)) {
    return join(staticRoot, "index.html");
  }

  const requestedFile = await readFileIfPresent(requestedPath);
  if (requestedFile !== null) return requestedFile;

  if (looksLikeStaticAsset(normalizedPath)) return null;

  return readFileIfPresent(join(staticRoot, "index.html"));
}

async function readFileIfPresent(filePath: string): Promise<string | null> {
  try {
    const fileStat = await stat(filePath);
    return fileStat.isFile() ? filePath : null;
  } catch (error) {
    if (isMissingFileError(error)) return null;
    throw error;
  }
}

async function sendStaticFile(response: ServerResponse, filePath: string, headOnly: boolean): Promise<void> {
  const fileStat = await stat(filePath);
  const headers = {
    "Cache-Control": extname(filePath) === ".html" ? "no-store" : "public, max-age=31536000, immutable",
    "Content-Length": fileStat.size,
    "Content-Type": mimeTypes.get(extname(filePath).toLowerCase()) ?? "application/octet-stream",
  };

  response.writeHead(200, headers);
  if (headOnly) {
    response.end();
    return;
  }

  await new Promise<void>((resolveSend, rejectSend) => {
    const stream = createReadStream(filePath);
    stream.on("error", rejectSend);
    response.on("error", rejectSend);
    response.on("finish", resolveSend);
    stream.pipe(response);
  });
}

function looksLikeStaticAsset(pathname: string): boolean {
  const lastSegment = pathname.split("/").at(-1) ?? "";
  return lastSegment.includes(".");
}

function isPathWithinRoot(candidatePath: string, rootPath: string): boolean {
  const relativePath = relative(rootPath, candidatePath);
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function logUnexpectedError(error: unknown): void {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(`Memory Visualizer production request failed: ${message}`);
}

function readHost(env: NodeJS.ProcessEnv): string {
  const host = env.TDAI_VIS_HOST?.trim() || env.HOST?.trim();
  return host && host.length > 0 ? host : defaultHost;
}

function readPort(env: NodeJS.ProcessEnv): number {
  const rawPort = env.TDAI_VIS_PORT?.trim() || env.PORT?.trim();
  if (!rawPort) return defaultPort;
  if (!/^\d+$/.test(rawPort)) throw new Error(`Invalid port: ${rawPort}`);
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error(`Invalid port: ${rawPort}`);
  return port;
}

async function listen(server: Server, options: VisualizerListenOptions): Promise<void> {
  await new Promise<void>((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(options.port, options.host, () => resolveListen());
  });
}

async function main(): Promise<void> {
  const server = createProductionVisualizerServer();
  const options = readListenOptions();
  await listen(server, options);
  process.stdout.write(`Memory Visualizer listening on http://${options.host}:${options.port}\n`);
}

function isDirectExecution(): boolean {
  const entryPath = process.argv[1];
  if (!entryPath) return false;
  return resolve(entryPath) === fileURLToPath(import.meta.url);
}

if (isDirectExecution()) {
  void main().catch((error: unknown) => {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
