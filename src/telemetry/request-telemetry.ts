// ============================
// JSON-safe request telemetry contract
// ============================

export type JsonPrimitive = string | number | boolean | null;

export type JsonValue = JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue };

export type RequestTelemetrySource = "visualizer-api" | "gateway";

export const REQUEST_TELEMETRY_SOURCES = [
  "visualizer-api",
  "gateway",
] as const satisfies readonly RequestTelemetrySource[];

export type RequestTelemetryOutcome = "ok" | "error" | "unauthorized" | "blocked" | "aborted";

export const REQUEST_TELEMETRY_OUTCOMES = [
  "ok",
  "error",
  "unauthorized",
  "blocked",
  "aborted",
] as const satisfies readonly RequestTelemetryOutcome[];

export type RequestTelemetryAuthType =
  | "none"
  | "local"
  | "api_key"
  | "visualizer_api_key"
  | "gateway_api_key"
  | "unknown";

export const REQUEST_TELEMETRY_AUTH_TYPES = [
  "none",
  "local",
  "api_key",
  "visualizer_api_key",
  "gateway_api_key",
  "unknown",
] as const satisfies readonly RequestTelemetryAuthType[];

export type RequestRouteKind =
  | "gateway-api"
  | "visualizer-api"
  | "request-monitor"
  | "health"
  | "static-asset"
  | "unknown";

export const REQUEST_ROUTE_KINDS = [
  "gateway-api",
  "visualizer-api",
  "request-monitor",
  "health",
  "static-asset",
  "unknown",
] as const satisfies readonly RequestRouteKind[];

export type RequestTelemetryQueryKey = "limit" | "offset" | "source" | "status" | "type";

export const REQUEST_TELEMETRY_QUERY_KEY_ALLOWLIST = [
  "limit",
  "offset",
  "source",
  "status",
  "type",
] as const satisfies readonly RequestTelemetryQueryKey[];

export interface RequestRouteClassification {
  readonly kind: RequestRouteKind;
  readonly routePattern: string;
  readonly skip: boolean;
  readonly warningCodes: readonly string[];
}

export interface SanitizedRequestLog {
  readonly id: string;
  readonly source: RequestTelemetrySource;
  readonly method: string;
  readonly path: string;
  readonly routePattern: string;
  readonly statusCode: number | null;
  readonly outcome: RequestTelemetryOutcome;
  readonly latencyMs: number | null;
  readonly authType: RequestTelemetryAuthType;
  readonly createdAt: string;
  readonly queryKeys: readonly RequestTelemetryQueryKey[];
  readonly warningCodes: readonly string[];
}

export interface RequestTelemetryPage {
  readonly items: readonly SanitizedRequestLog[];
  readonly total: number;
  readonly offset: number;
  readonly limit: number;
  readonly warnings: readonly RequestTelemetryWarning[];
}

export interface RequestTelemetryWarning {
  readonly code: string;
  readonly message: string;
  readonly source: RequestTelemetrySource | "shared";
  readonly detail: JsonValue | null;
}

export interface RequestTelemetrySummaryBucket {
  readonly key: string;
  readonly count: number;
  readonly errorCount: number;
  readonly unauthorizedCount: number;
  readonly averageLatencyMs: number | null;
}

export interface RequestTelemetrySummary {
  readonly generatedAt: string;
  readonly total: number;
  readonly last24h: number;
  readonly errorRate: number;
  readonly p95LatencyMs: number | null;
  readonly recent5xx: readonly SanitizedRequestLog[];
  readonly sources: readonly RequestTelemetrySummaryBucket[];
  readonly warnings: readonly RequestTelemetryWarning[];
}

export interface SanitizedRequestLogInput {
  readonly id: string;
  readonly source: RequestTelemetrySource;
  readonly method: string | null | undefined;
  readonly path: string;
  readonly query?: string | URLSearchParams | null;
  readonly statusCode?: number | null;
  readonly outcome?: RequestTelemetryOutcome | null;
  readonly latencyMs?: number | null;
  readonly authType?: RequestTelemetryAuthType | null;
  readonly createdAt: string;
  readonly warningCodes?: readonly string[];
}

const STATIC_ASSET_EXTENSIONS = [
  ".css",
  ".js",
  ".mjs",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".svg",
  ".ico",
  ".webp",
  ".woff",
  ".woff2",
  ".ttf",
  ".map",
] as const;

const STATIC_ASSET_PREFIXES = [
  "/assets/",
  "/static/",
  "/public/",
  "/node_modules/",
] as const;

export function normalizeRequestPathname(pathOrUrl: string | null | undefined): string {
  const fallback = "/";
  if (!pathOrUrl) return fallback;

  const raw = pathOrUrl.trim();
  if (!raw) return fallback;

  try {
    return normalizeParsedPathname(new URL(raw, "http://telemetry.local").pathname);
  } catch {
    const withoutQuery = raw.split("?")[0]?.split("#")[0] ?? fallback;
    return normalizeParsedPathname(withoutQuery);
  }
}

export function sanitizeRequestQueryKeys(query: string | URLSearchParams | null | undefined): readonly RequestTelemetryQueryKey[] {
  if (!query) return [];
  const searchParams = typeof query === "string" ? parseQueryString(query) : query;
  return REQUEST_TELEMETRY_QUERY_KEY_ALLOWLIST.filter((key) => searchParams.has(key));
}

export function classifyRequestRoute(method: string | null | undefined, pathOrUrl: string | null | undefined): RequestRouteClassification {
  const methodName = normalizeRequestMethod(method);
  const path = normalizeRequestPathname(pathOrUrl);
  const warningCodes: string[] = [];

  if (isHealthPath(path)) return { kind: "health", routePattern: "/health", skip: true, warningCodes };
  if (isRequestMonitorPath(path)) return { kind: "request-monitor", routePattern: path, skip: true, warningCodes };
  if (isStaticAssetPath(path)) return { kind: "static-asset", routePattern: "static-asset", skip: true, warningCodes };

  if (path === "/recall") return route("gateway-api", "/recall");
  if (path === "/capture") return route("gateway-api", "/capture");
  if (path === "/search/memories") return route("gateway-api", "/search/memories");
  if (path === "/search/conversations") return route("gateway-api", "/search/conversations");
  if (path === "/session/end") return route("gateway-api", "/session/end");
  if (path === "/seed") return route("gateway-api", "/seed");
  if (path.startsWith("/visualizer/")) return route("visualizer-api", "/visualizer/*");
  if (path.startsWith("/api/")) return route("visualizer-api", "/api/*");

  warningCodes.push("unknown-route");
  return {
    kind: "unknown",
    routePattern: methodName === "GET" ? "GET unknown" : "unknown",
    skip: false,
    warningCodes,
  };
}

export function shouldSkipRequestTelemetry(method: string | null | undefined, pathOrUrl: string | null | undefined): boolean {
  return classifyRequestRoute(method, pathOrUrl).skip;
}

export function createSanitizedRequestLog(input: SanitizedRequestLogInput): SanitizedRequestLog | null {
  const path = normalizeRequestPathname(input.path);
  const classification = classifyRequestRoute(input.method, path);
  if (classification.skip) return null;
  const query = input.query ?? input.path;

  return {
    id: input.id,
    source: input.source,
    method: normalizeRequestMethod(input.method),
    path,
    routePattern: classification.routePattern,
    statusCode: sanitizeStatusCode(input.statusCode),
    outcome: input.outcome ?? outcomeFromStatusCode(input.statusCode),
    latencyMs: sanitizeLatencyMs(input.latencyMs),
    authType: input.authType ?? "unknown",
    createdAt: input.createdAt,
    queryKeys: sanitizeRequestQueryKeys(query),
    warningCodes: mergeWarningCodes(classification.warningCodes, input.warningCodes ?? []),
  };
}

export function outcomeFromStatusCode(statusCode: number | null | undefined): RequestTelemetryOutcome {
  if (statusCode === 401 || statusCode === 403) return "unauthorized";
  if (statusCode === 429) return "blocked";
  if (typeof statusCode === "number" && statusCode >= 500) return "error";
  return "ok";
}

function normalizeParsedPathname(pathname: string): string {
  const withLeadingSlash = pathname.startsWith("/") ? pathname : `/${pathname}`;
  const collapsed = withLeadingSlash.replace(/\/+/g, "/").replace(/\/{2,}/g, "/");
  return collapsed.length > 1 && collapsed.endsWith("/") ? collapsed.slice(0, -1) : collapsed;
}

function normalizeRequestMethod(method: string | null | undefined): string {
  const normalized = (method ?? "GET").trim().toUpperCase();
  return normalized || "GET";
}

function parseQueryString(query: string): URLSearchParams {
  const trimmed = query.trim();
  if (!trimmed) return new URLSearchParams();
  if (trimmed.startsWith("?")) return new URLSearchParams(trimmed.slice(1));
  if (!trimmed.includes("://") && !trimmed.startsWith("/") && trimmed.includes("=")) {
    return new URLSearchParams(trimmed);
  }
  try {
    return new URL(trimmed, "http://telemetry.local").searchParams;
  } catch {
    return new URLSearchParams(trimmed);
  }
}

function route(kind: RequestRouteKind, routePattern: string): RequestRouteClassification {
  return { kind, routePattern, skip: false, warningCodes: [] };
}

function isHealthPath(path: string): boolean {
  return path === "/health" || path === "/api/health";
}

function isRequestMonitorPath(path: string): boolean {
  return path === "/api/requests" ||
    path === "/api/requests/summary" ||
    path === "/visualizer/requests" ||
    path === "/visualizer/requests/summary";
}

function isStaticAssetPath(path: string): boolean {
  const lower = path.toLowerCase();
  if (lower === "/favicon.ico") return true;
  if (STATIC_ASSET_PREFIXES.some((prefix) => lower.startsWith(prefix))) return true;
  return STATIC_ASSET_EXTENSIONS.some((extension) => lower.endsWith(extension));
}

function sanitizeStatusCode(statusCode: number | null | undefined): number | null {
  if (typeof statusCode !== "number" || !Number.isFinite(statusCode)) return null;
  return Math.trunc(statusCode);
}

function sanitizeLatencyMs(latencyMs: number | null | undefined): number | null {
  if (typeof latencyMs !== "number" || !Number.isFinite(latencyMs) || latencyMs < 0) return null;
  return Math.round(latencyMs);
}

function mergeWarningCodes(left: readonly string[], right: readonly string[]): readonly string[] {
  return [...new Set([...left, ...right].filter((code) => code.trim().length > 0))];
}
