import type {
  CapabilityState,
  CapabilityReport,
  ConversationSearchDebugData,
  ConversationEvidence,
  DashboardSnapshot,
  GatewayDebugPayload,
  HealthDebugData,
  MemorySearchDebugData,
  OffloadCanvas,
  RecallDebugData,
  SceneBlockSummary,
  StructuredMemorySummary,
} from "../contracts/dashboard";

import type { DashboardPage } from "../providers";

export interface SourceQueryConfig {
  readonly dataDir: string;
  readonly offloadRootPath: string;
  readonly sourceLabel: string;
}

export interface EvidenceLinkIndexEntry {
  readonly memoryRecordId: string;
  readonly evidenceIds: readonly string[];
  readonly evidenceRecords: readonly ConversationEvidence[];
}

export interface OffloadResponse {
  readonly canvases: DashboardPage<OffloadCanvas>;
  readonly references: DashboardPage<OffloadCanvas["refs"][number]>;
}

export interface DashboardApiClient {
  readonly getSnapshot: (config: SourceQueryConfig) => Promise<DashboardSnapshot>;
  readonly getScenes: (config: SourceQueryConfig) => Promise<DashboardPage<SceneBlockSummary>>;
  readonly getMemories: (config: SourceQueryConfig, page?: PageRequest) => Promise<DashboardPage<StructuredMemorySummary>>;
  readonly getEvidence: (config: SourceQueryConfig, page?: PageRequest) => Promise<DashboardPage<EvidenceLinkIndexEntry>>;
  readonly getConversations: (config: SourceQueryConfig, page?: PageRequest) => Promise<DashboardPage<ConversationEvidence>>;
  readonly getOffload: (config: SourceQueryConfig) => Promise<OffloadResponse>;
  readonly getGatewayHealth: (config: SourceQueryConfig) => Promise<GatewayDebugPayload<HealthDebugData>>;
  readonly runGatewayRecallDebug: (config: SourceQueryConfig, body: GatewayRecallRequest) => Promise<GatewayDebugPayload<RecallDebugData>>;
  readonly runGatewayMemorySearchDebug: (config: SourceQueryConfig, body: GatewayMemorySearchRequest) => Promise<GatewayDebugPayload<MemorySearchDebugData>>;
  readonly runGatewayConversationSearchDebug: (config: SourceQueryConfig, body: GatewayConversationSearchRequest) => Promise<GatewayDebugPayload<ConversationSearchDebugData>>;
}

export interface DashboardApiClientOptions {
  readonly getApiKey?: () => string | undefined;
}

export interface PageRequest {
  readonly offset?: number;
  readonly limit?: number;
}

export interface GatewayRecallRequest {
  readonly query: string;
  readonly session_key: string;
  readonly user_id?: string;
}

export interface GatewayMemorySearchRequest {
  readonly query: string;
  readonly limit?: number;
  readonly type?: string;
  readonly scene?: string;
}

export interface GatewayConversationSearchRequest {
  readonly query: string;
  readonly session_key?: string;
  readonly limit?: number;
}

interface ErrorPayload {
  readonly error?: string;
  readonly code?: string;
}

export class DashboardApiError extends Error {
  public readonly status: number;
  public readonly code: string | null;

  public constructor(message: string, status: number, code: string | null) {
    super(message);
    this.name = "DashboardApiError";
    this.status = status;
    this.code = code;
  }
}

export function isDashboardAuthError(error: unknown): boolean {
  return error instanceof DashboardApiError && error.status === 401 && error.code === "unauthorized";
}

export function isDashboardAuthConfigurationError(error: unknown): boolean {
  return error instanceof DashboardApiError && error.status === 503 && error.code === "auth-not-configured";
}

export function createDashboardApiClient(baseUrl = "", options: DashboardApiClientOptions = {}): DashboardApiClient {
  return {
    getSnapshot: (config) => fetchJson<DashboardSnapshot>(buildApiUrl(baseUrl, "/api/snapshot", config), options),
    getScenes: (config) => fetchJson<DashboardPage<SceneBlockSummary>>(buildApiUrl(baseUrl, "/api/scenes", config), options),
    getMemories: (config, page) => fetchJson<DashboardPage<StructuredMemorySummary>>(buildApiUrl(baseUrl, "/api/memories", config, page), options),
    getEvidence: (config, page) => fetchJson<DashboardPage<EvidenceLinkIndexEntry>>(buildApiUrl(baseUrl, "/api/evidence", config, page), options),
    getConversations: (config, page) => fetchJson<DashboardPage<ConversationEvidence>>(buildApiUrl(baseUrl, "/api/conversations", config, page), options),
    getOffload: (config) => fetchJson<OffloadResponse>(buildApiUrl(baseUrl, "/api/offload", config), options),
    getGatewayHealth: (config) => fetchJson<GatewayDebugPayload<HealthDebugData>>(buildApiUrl(baseUrl, "/api/gateway/health", config), options),
    runGatewayRecallDebug: (config, body) => postJson<GatewayDebugPayload<RecallDebugData>>(buildApiUrl(baseUrl, "/api/gateway/recall-debug", config), body, options),
    runGatewayMemorySearchDebug: (config, body) => postJson<GatewayDebugPayload<MemorySearchDebugData>>(buildApiUrl(baseUrl, "/api/gateway/search-memories-debug", config), body, options),
    runGatewayConversationSearchDebug: (config, body) => postJson<GatewayDebugPayload<ConversationSearchDebugData>>(buildApiUrl(baseUrl, "/api/gateway/search-conversations-debug", config), body, options),
  };
}

export function createEmptySourceQueryConfig(): SourceQueryConfig {
  return {
    dataDir: "",
    offloadRootPath: "",
    sourceLabel: "",
  };
}

export function readSourceQueryConfig(search: string): SourceQueryConfig {
  const params = new URLSearchParams(search);
  return {
    dataDir: params.get("dataDir") ?? "",
    offloadRootPath: params.get("offloadRootPath") ?? "",
    sourceLabel: params.get("sourceLabel") ?? "",
  };
}

export function buildSourceQueryString(config: SourceQueryConfig): string {
  const params = new URLSearchParams();

  appendParam(params, "dataDir", config.dataDir);
  appendParam(params, "offloadRootPath", config.offloadRootPath);
  appendParam(params, "sourceLabel", config.sourceLabel);

  const value = params.toString();
  return value ? `?${value}` : "";
}

function appendParam(params: URLSearchParams, key: string, value: string): void {
  const trimmed = value.trim();
  if (trimmed.length > 0) params.set(key, trimmed);
}

function buildApiUrl(baseUrl: string, pathname: string, config: SourceQueryConfig, page?: PageRequest): string {
  const params = new URLSearchParams(buildSourceQueryString(config).replace(/^\?/, ""));
  if (typeof page?.offset === "number" && Number.isFinite(page.offset) && page.offset >= 0) {
    params.set("offset", String(Math.floor(page.offset)));
  }
  if (typeof page?.limit === "number" && Number.isFinite(page.limit) && page.limit >= 0) {
    params.set("limit", String(Math.floor(page.limit)));
  }
  const query = params.toString();
  return query ? `${baseUrl}${pathname}?${query}` : `${baseUrl}${pathname}`;
}

async function fetchJson<T>(url: string, options: DashboardApiClientOptions): Promise<T> {
  const response = await fetch(url, {
    headers: buildRequestHeaders(options, { Accept: "application/json" }),
  });

  if (!response.ok) {
    const payload = await readErrorPayload(response);
    let detail = `${response.status} ${response.statusText}`.trim();
    if (payload.error) detail = payload.error;
    if (payload.code) detail = `${detail} (${payload.code})`;
    throw new DashboardApiError(detail, response.status, payload.code ?? null);
  }

  return (await response.json()) as T;
}

async function postJson<T>(url: string, body: object, options: DashboardApiClientOptions): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: buildRequestHeaders(options, {
      Accept: "application/json",
      "Content-Type": "application/json",
    }),
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const payload = await readErrorPayload(response);
    let detail = `${response.status} ${response.statusText}`.trim();
    if (payload.error) detail = payload.error;
    if (payload.code) detail = `${detail} (${payload.code})`;
    throw new DashboardApiError(detail, response.status, payload.code ?? null);
  }

  return (await response.json()) as T;
}

function buildRequestHeaders(options: DashboardApiClientOptions, headers: Record<string, string>): Headers {
  const requestHeaders = new Headers(headers);
  const apiKey = options.getApiKey?.()?.trim();
  if (apiKey) requestHeaders.set("Authorization", `Bearer ${apiKey}`);
  return requestHeaders;
}

async function readErrorPayload(response: Response): Promise<ErrorPayload> {
  try {
    return (await response.json()) as ErrorPayload;
  } catch (error) {
    void error;
    return {};
  }
}

export function summarizeCapabilities(report: CapabilityReport): readonly string[] {
  return Object.values(report)
    .filter(isCapabilityState)
    .filter((entry) => entry.status !== "available")
    .map((entry) => `${entry.label}: ${entry.status}`);
}

function isCapabilityState(value: string | CapabilityState): value is CapabilityState {
  return typeof value === "object" && value !== null;
}
