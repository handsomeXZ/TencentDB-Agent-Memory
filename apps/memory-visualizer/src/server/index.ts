import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { URL } from "node:url";

import { REQUEST_TELEMETRY_QUERY_KEY_ALLOWLIST, createSanitizedRequestLog } from "../../../../src/telemetry/request-telemetry.js";
import {
  appendRequestTelemetryLog,
  readRequestTelemetryPage,
  readRequestTelemetrySummary,
} from "../../../../src/telemetry/request-telemetry-store.js";
import { GatewayDebugAdapter } from "../providers/gateway-debug-adapter";
import { LocalDashboardDataProvider } from "../providers/local-dashboard-data-provider";
import { RemoteDashboardDataProvider } from "../providers/remote-dashboard-data-provider";
import { checkVisualizerAuth, readVisualizerAuthConfig } from "./auth";

import type {
  ConversationEvidence,
  DataSourceConfig,
  JsonValue,
  OffloadCanvas,
  SceneBlockSummary,
} from "../contracts/dashboard";
import type { DashboardPage, LocalDashboardProviderConfig, LocalDashboardRequestConfig } from "../providers/local-dashboard-data-provider";
import type { GatewayFetch, GatewayRequestInit } from "../providers/gateway-debug-adapter";
import type {
  RequestTelemetryAuthType,
  RequestTelemetryPage,
  RequestTelemetrySummary,
  RequestTelemetryWarning,
  SanitizedRequestLog,
} from "../../../../src/telemetry/request-telemetry.js";

export interface VisualizerServerOptions {
  readonly appConfig?: LocalDashboardProviderConfig;
  readonly env?: NodeJS.ProcessEnv;
  readonly now?: () => Date;
  readonly fetch?: GatewayFetch;
  readonly gatewayTimeoutMs?: number;
  readonly maxBodyBytes?: number;
}

interface JsonErrorBody {
  readonly error: string;
  readonly code: string;
}

class HttpError extends Error {
  public readonly status: number;
  public readonly code: string;
  public readonly expose: boolean;

  public constructor(status: number, code: string, message: string, expose = true) {
    super(message);
    this.status = status;
    this.code = code;
    this.expose = expose;
  }
}

const DEFAULT_BODY_LIMIT_BYTES = 16 * 1024;
const DEFAULT_PAGE_LIMIT = 50;
const MAX_PAGE_LIMIT = 500;
const GATEWAY_DATA_SOURCE = "gateway";

type DashboardProvider = LocalDashboardDataProvider | RemoteDashboardDataProvider;

export function createVisualizerServer(options: VisualizerServerOptions = {}): Server {
  const env = options.env ?? process.env;
  const provider = createDashboardProvider(options, env);
  const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_BODY_LIMIT_BYTES;
  const authConfig = readVisualizerAuthConfig(env);

  return createServer(async (request: IncomingMessage, response: ServerResponse) => {
    const requestUrl = createRequestUrl(request);
    const method = request.method?.toUpperCase() ?? "GET";
    const routeKey = `${method} ${requestUrl.pathname}`;
    const telemetryStartedAt = Date.now();

    try {
      response.setHeader("Cache-Control", "no-store");

      switch (routeKey) {
        case "GET /health":
          return sendJson(response, 200, { ok: true, readOnly: true });
      }

      if (!checkVisualizerAuth(request, response, authConfig)) return;

      switch (routeKey) {
        case "GET /api/snapshot":
          return sendJson(response, 200, await provider.getSnapshot(resolveRequestConfig(provider, requestUrl)));
        case "GET /api/scenes": {
          const snapshot = await provider.getSnapshot(resolveRequestConfig(provider, requestUrl));
          return sendJson(response, 200, paginate(snapshot.scenes, requestUrl));
        }
        case "GET /api/memories":
          return sendJson(response, 200, await provider.getStructuredMemoriesPage(resolveRequestConfig(provider, requestUrl), readPage(requestUrl)));
        case "GET /api/conversations":
          return sendJson(response, 200, await provider.getConversationEvidencePage(resolveRequestConfig(provider, requestUrl), readPage(requestUrl)));
        case "GET /api/requests":
          return sendJson(response, 200, await readRequestsPage(env, provider, requestUrl));
        case "GET /api/requests/summary":
          return sendJson(response, 200, await readRequestsSummary(env, provider));
        case "GET /api/offload":
          return sendJson(response, 200, await readOffload(provider, requestUrl));
        case "GET /api/evidence":
          return sendJson(response, 200, paginate(await provider.getEvidenceLinkIndex(resolveRequestConfig(provider, requestUrl)), requestUrl));
        case "GET /api/gateway/health":
          return sendJson(response, 200, await createGatewayAdapter(provider, requestUrl, env, options).health());
        case "POST /api/gateway/recall-debug":
          return sendJson(response, 200, await createGatewayAdapter(provider, requestUrl, env, options).recall(await readJsonBody(request, maxBodyBytes)));
        case "POST /api/gateway/search-memories-debug":
          return sendJson(response, 200, await createGatewayAdapter(provider, requestUrl, env, options).searchMemories(await readJsonBody(request, maxBodyBytes)));
        case "POST /api/gateway/search-conversations-debug":
          return sendJson(response, 200, await createGatewayAdapter(provider, requestUrl, env, options).searchConversations(await readJsonBody(request, maxBodyBytes)));
        default:
          return sendJson(response, 404, { error: "Route not found", code: "route-not-found" } satisfies JsonErrorBody);
      }
    } catch (error) {
      const httpError = toHttpError(error);
      if (!httpError.expose) logUnexpectedError(error);
      return sendJson(response, httpError.status, { error: httpError.message, code: httpError.code } satisfies JsonErrorBody);
    } finally {
      await recordVisualizerRequestTelemetry({
        authType: visualizerTelemetryAuthType(authConfig),
        env,
        method,
        provider,
        requestUrl,
        startedAt: telemetryStartedAt,
        statusCode: response.statusCode,
      });
    }
  });
}

async function recordVisualizerRequestTelemetry(input: {
  readonly authType: RequestTelemetryAuthType;
  readonly env: NodeJS.ProcessEnv;
  readonly method: string;
  readonly provider: DashboardProvider;
  readonly requestUrl: URL;
  readonly startedAt: number;
  readonly statusCode: number;
}): Promise<void> {
  const log = createSanitizedRequestLog({
    id: `request:${randomUUID()}`,
    source: "visualizer-api",
    method: input.method,
    path: input.requestUrl.pathname,
    query: visualizerTelemetryQueryKeys(input.requestUrl),
    statusCode: input.statusCode,
    latencyMs: Date.now() - input.startedAt,
    authType: input.authType,
    createdAt: new Date().toISOString(),
  });
  if (!log) return;

  try {
    const result = await appendRequestTelemetryLog(log, {
      source: "visualizer-api",
      env: input.env,
      unsafeRootDirs: visualizerTelemetryUnsafeRoots(input.provider),
    });
    logTelemetryWarnings(result.warnings, log);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`Memory Visualizer request telemetry append failed open: ${message}`);
  }
}

function visualizerTelemetryAuthType(authConfig: ReturnType<typeof readVisualizerAuthConfig>): RequestTelemetryAuthType {
  return authConfig.required ? "visualizer_api_key" : "none";
}

function visualizerTelemetryQueryKeys(requestUrl: URL): URLSearchParams {
  const query = new URLSearchParams();
  for (const key of REQUEST_TELEMETRY_QUERY_KEY_ALLOWLIST) {
    if (requestUrl.searchParams.has(key)) query.set(key, "");
  }
  return query;
}

function visualizerTelemetryUnsafeRoots(provider: DashboardProvider): readonly string[] {
  try {
    const config = provider.resolveConfig();
    return [config.memoryRootPath, config.offloadRootPath].filter((value) => value.trim().length > 0);
  } catch {
    return [];
  }
}

function logTelemetryWarnings(warnings: readonly { readonly code: string }[], log: SanitizedRequestLog): void {
  for (const warning of warnings) {
    if (warning.code === "telemetry-dir-unconfigured") continue;
    console.warn(`Memory Visualizer request telemetry warning [${log.method} ${log.path}]: ${warning.code}`);
  }
}

async function readOffload(provider: DashboardProvider, requestUrl: URL): Promise<{
  readonly canvases: DashboardPage<OffloadCanvas>;
  readonly references: DashboardPage<OffloadCanvas["refs"][number]>;
}> {
  const config = resolveRequestConfig(provider, requestUrl);
  const page = readPage(requestUrl);
  const [canvases, references] = await Promise.all([
    provider.getOffloadCanvasesPage(config, page),
    provider.getOffloadReferencesPage(config, page),
  ]);
  return { canvases, references };
}

async function readRequestsPage(
  env: NodeJS.ProcessEnv,
  provider: DashboardProvider,
  requestUrl: URL,
): Promise<RequestTelemetryPage> {
  if (provider instanceof RemoteDashboardDataProvider) {
    return sanitizeTelemetryPage(await provider.getRequestTelemetryPage(resolveRequestConfig(provider, requestUrl), readPage(requestUrl)));
  }

  const result = await readRequestTelemetryPage({
    env,
    telemetryDir: configuredVisualizerTelemetryDir(env),
    unsafeRootDirs: visualizerTelemetryUnsafeRoots(provider),
    limit: requestUrl.searchParams.get("limit") ?? undefined,
    offset: requestUrl.searchParams.get("offset") ?? undefined,
  });
  if (!result.ok) throw new HttpError(400, result.error.code, result.error.message);
  return sanitizeTelemetryPage(result.page);
}

async function readRequestsSummary(
  env: NodeJS.ProcessEnv,
  provider: DashboardProvider,
): Promise<RequestTelemetrySummary> {
  if (provider instanceof RemoteDashboardDataProvider) {
    return sanitizeTelemetrySummary(await provider.getRequestTelemetrySummary());
  }

  return sanitizeTelemetrySummary(await readRequestTelemetrySummary({
    env,
    telemetryDir: configuredVisualizerTelemetryDir(env),
    unsafeRootDirs: visualizerTelemetryUnsafeRoots(provider),
  }));
}

function createGatewayAdapter(
  provider: DashboardProvider,
  requestUrl: URL,
  env: NodeJS.ProcessEnv,
  options: VisualizerServerOptions,
): GatewayDebugAdapter {
  const config = provider.resolveConfig(resolveRequestConfig(provider, requestUrl));
  return new GatewayDebugAdapter({
    baseUrl: config.gatewayBaseUrl,
    apiKey: config.gatewayApiKeyEnv ? env[config.gatewayApiKeyEnv] : undefined,
    fetch: options.fetch,
    timeoutMs: options.gatewayTimeoutMs,
  });
}

function createDashboardProvider(options: VisualizerServerOptions, env: NodeJS.ProcessEnv): DashboardProvider {
  if (env.TDAI_VIS_DATA_SOURCE?.trim().toLowerCase() === GATEWAY_DATA_SOURCE) {
    return new RemoteDashboardDataProvider({
      env,
      fetch: options.fetch,
      timeoutMs: options.gatewayTimeoutMs,
    });
  }

  return new LocalDashboardDataProvider({
    appConfig: options.appConfig,
    env,
    now: options.now,
  });
}

function resolveRequestConfig(provider: DashboardProvider, requestUrl: URL): LocalDashboardRequestConfig {
  const baseline = provider.resolveConfig();
  if (provider instanceof RemoteDashboardDataProvider) {
    return {
      dataDir: baseline.memoryRootPath,
      offloadRootPath: baseline.offloadRootPath,
      sourceLabel: readOptionalTextParam(requestUrl, "sourceLabel", 80) ?? baseline.sourceLabel,
      gatewayBaseUrl: baseline.gatewayBaseUrl,
      gatewayApiKeyEnv: baseline.gatewayApiKeyEnv,
    };
  }

  const dataDir = readSafePathParam(requestUrl, "dataDir", baseline.memoryRootPath, "data-dir");
  const offloadRootPath = readSafePathParam(requestUrl, "offloadRootPath", baseline.offloadRootPath, "offload-root");
  const sourceLabel = readOptionalTextParam(requestUrl, "sourceLabel", 80);

  return {
    dataDir: dataDir ?? baseline.memoryRootPath,
    offloadRootPath: offloadRootPath ?? baseline.offloadRootPath,
    sourceLabel: sourceLabel ?? baseline.sourceLabel,
    gatewayBaseUrl: baseline.gatewayBaseUrl,
    gatewayApiKeyEnv: baseline.gatewayApiKeyEnv,
  };
}

function readSafePathParam(requestUrl: URL, key: string, allowedRoot: string, code: string): string | undefined {
  const raw = requestUrl.searchParams.get(key);
  if (raw === null) return undefined;

  if (raw.trim() === "") throw new HttpError(400, `${code}-empty`, `${key} must not be empty.`);
  if (hasTraversalSegment(raw)) throw new HttpError(400, `${code}-traversal`, `${key} must not contain traversal segments.`);
  if (allowedRoot.trim() === "") throw new HttpError(400, `${code}-unconfigured`, `${key} cannot be overridden without a configured root.`);

  const root = path.resolve(allowedRoot);
  const candidate = path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(root, raw);
  if (!pathIsWithin(candidate, root)) throw new HttpError(400, `${code}-outside-root`, `${key} is outside the configured root.`);
  return candidate;
}

function readOptionalTextParam(requestUrl: URL, key: string, maxLength: number): string | undefined {
  const raw = requestUrl.searchParams.get(key);
  if (raw === null) return undefined;
  const value = raw.trim();
  if (value.length === 0) return undefined;
  if (value.length > maxLength) throw new HttpError(400, `${key}-too-long`, `${key} is too long.`);
  return value;
}

function hasTraversalSegment(input: string): boolean {
  return input.split(/[\\/]+/).some((segment) => segment === "..");
}

function pathIsWithin(candidate: string, root: string): boolean {
  const normalizedCandidate = path.resolve(candidate).toLowerCase();
  const normalizedRoot = path.resolve(root).toLowerCase();
  return normalizedCandidate === normalizedRoot || normalizedCandidate.startsWith(`${normalizedRoot.toLowerCase()}${path.sep}`);
}

function readPage(requestUrl: URL): Pick<DashboardPage<unknown>, "offset" | "limit"> {
  return {
    offset: readNonNegativeInteger(requestUrl, "offset", 0, Number.MAX_SAFE_INTEGER),
    limit: readNonNegativeInteger(requestUrl, "limit", DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT),
  };
}

function readNonNegativeInteger(requestUrl: URL, key: string, fallback: number, max: number): number {
  const raw = requestUrl.searchParams.get(key);
  if (raw === null || raw.trim() === "") return fallback;
  if (!/^\d+$/.test(raw)) throw new HttpError(400, `${key}-invalid`, `${key} must be a non-negative integer.`);
  return Math.min(Number(raw), max);
}

function paginate<T>(items: readonly T[], requestUrl: URL): DashboardPage<T> {
  const page = readPage(requestUrl);
  return {
    items: items.slice(page.offset, page.offset + page.limit),
    total: items.length,
    offset: page.offset,
    limit: page.limit,
  };
}

function sanitizeTelemetryPage(page: RequestTelemetryPage): RequestTelemetryPage {
  return {
    ...page,
    warnings: sanitizeTelemetryWarnings(page.warnings),
  };
}

function sanitizeTelemetrySummary(summary: RequestTelemetrySummary): RequestTelemetrySummary {
  return {
    ...summary,
    warnings: sanitizeTelemetryWarnings(summary.warnings),
  };
}

function sanitizeTelemetryWarnings(warnings: readonly RequestTelemetryWarning[]): readonly RequestTelemetryWarning[] {
  return warnings.map((warning) => ({
    code: warning.code,
    message: warning.message,
    source: warning.source,
    detail: null,
  }));
}

function configuredVisualizerTelemetryDir(env: NodeJS.ProcessEnv): string | undefined {
  const visualizerDir = env.TDAI_VIS_TELEMETRY_DIR?.trim();
  if (visualizerDir) return visualizerDir;
  const sharedDir = env.TDAI_TELEMETRY_DIR?.trim();
  return sharedDir || undefined;
}

async function readJsonBody(request: IncomingMessage, maxBytes: number): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.byteLength;
    if (size > maxBytes) throw new HttpError(413, "body-too-large", "Request body is too large.");
    chunks.push(buffer);
  }

  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (raw === "") return {};

  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed;
  } catch (error) {
    void error;
    throw new HttpError(400, "malformed-json", "Malformed JSON request body.");
  }
}

function createRequestUrl(request: IncomingMessage): URL {
  return new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body);
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(json),
  });
  response.end(json);
}

function toHttpError(error: unknown): HttpError {
  if (error instanceof HttpError) return error;
  const message = error instanceof Error ? error.message : String(error);
  if (/^(Missing required|Field must|Request body must)/.test(message)) {
    return new HttpError(400, "invalid-request", message);
  }
  return new HttpError(500, "internal-error", "Internal Server Error", false);
}

function logUnexpectedError(error: unknown): void {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(`Memory Visualizer API request failed: ${message}`);
}

export type { GatewayFetch, GatewayRequestInit };
