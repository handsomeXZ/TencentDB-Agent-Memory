export interface GatewayDebugAdapterOptions {
  readonly baseUrl: string | null;
  readonly apiKey?: string;
  readonly timeoutMs?: number;
  readonly fetch?: GatewayFetch;
}

export type GatewayFetch = (input: string | URL, init?: GatewayRequestInit) => Promise<GatewayFetchResponse>;

export interface GatewayRequestInit {
  readonly method?: string;
  readonly headers?: HeadersInit;
  readonly body?: BodyInit | null;
  readonly signal?: AbortSignal | null;
}

export interface GatewayFetchResponse {
  readonly ok: boolean;
  readonly status: number;
  readonly statusText: string;
  readonly headers: Headers;
  readonly text: () => Promise<string>;
}

export interface GatewayDebugPayload<T> {
  readonly ok: boolean;
  readonly endpoint: "/health" | "/recall" | "/search/memories" | "/search/conversations";
  readonly checkedAt: string;
  readonly latencyMs: number | null;
  readonly httpStatus: number | null;
  readonly data: T | null;
  readonly warning: string | null;
}

export interface HealthDebugData {
  readonly status: "ok" | "degraded";
  readonly version: string;
  readonly uptime: number;
  readonly stores: {
    readonly vectorStore: boolean;
    readonly embeddingService: boolean;
  };
}

export interface RecallDebugData {
  readonly context: string;
  readonly strategy?: string;
  readonly memory_count?: number;
}

export interface MemorySearchDebugData {
  readonly results: string;
  readonly total: number;
  readonly strategy: string;
}

export interface ConversationSearchDebugData {
  readonly results: string;
  readonly total: number;
}

type GatewayEndpoint = GatewayDebugPayload<unknown>["endpoint"];

interface FetchResult {
  readonly status: number;
  readonly latencyMs: number;
  readonly text: string;
  readonly contentType: string;
}

const DEFAULT_TIMEOUT_MS = 5_000;
const SENSITIVE_NAME_PATTERN = String.raw`(?:TDAI_GATEWAY_API_KEY|(?:[A-Z][A-Z0-9_]*_)?(?:API_KEY|TOKEN|SECRET|PASSWORD|PRIVATE_KEY|ACCESS_TOKEN|REFRESH_TOKEN))`;
const ASSIGNMENT_VALUE_PATTERN = String.raw`(?:"[^"]*"|'[^']*'|[^\s,;]+)`;

export class GatewayDebugAdapter {
  private readonly baseUrl: string | null;
  private readonly apiKey: string | undefined;
  private readonly timeoutMs: number;
  private readonly fetchImpl: GatewayFetch;

  public constructor(options: GatewayDebugAdapterOptions) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl);
    this.apiKey = options.apiKey;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchImpl = options.fetch ?? fetch;
  }

  public async health(): Promise<GatewayDebugPayload<HealthDebugData>> {
    return this.callJson("/health", "GET", undefined, isHealthDebugData);
  }

  public async recall(body: unknown): Promise<GatewayDebugPayload<RecallDebugData>> {
    const request = readRecallRequest(body);
    return this.callJson("/recall", "POST", request, isRecallDebugData);
  }

  public async searchMemories(body: unknown): Promise<GatewayDebugPayload<MemorySearchDebugData>> {
    const request = readMemorySearchRequest(body);
    return this.callJson("/search/memories", "POST", request, isMemorySearchDebugData);
  }

  public async searchConversations(body: unknown): Promise<GatewayDebugPayload<ConversationSearchDebugData>> {
    const request = readConversationSearchRequest(body);
    return this.callJson("/search/conversations", "POST", request, isConversationSearchDebugData);
  }

  private async callJson<T>(
    endpoint: GatewayEndpoint,
    method: "GET" | "POST",
    body: Record<string, unknown> | undefined,
    isExpected: (value: unknown) => value is T,
  ): Promise<GatewayDebugPayload<T>> {
    if (this.baseUrl === null) return disabledPayload(endpoint);

    const started = Date.now();
    try {
      const result = await this.fetchEndpoint(endpoint, method, body);
      if (!isJsonContentType(result.contentType)) {
        return warningPayload(endpoint, result, `Gateway returned non-JSON content: ${redactSensitiveText(result.text).slice(0, 240)}`);
      }

      const parsed = parseJsonValue(result.text);
      if (!isExpected(parsed)) {
        return warningPayload(endpoint, result, `Gateway returned an unexpected payload: ${redactSensitiveText(result.text).slice(0, 240)}`);
      }

      if (result.status < 200 || result.status >= 300) {
        return { ...basePayload(endpoint, result), data: parsed, warning: `Gateway returned HTTP ${result.status}.` };
      }

      return { ...basePayload(endpoint, result), data: parsed, warning: null };
    } catch (error) {
      return {
        ok: false,
        endpoint,
        checkedAt: new Date().toISOString(),
        latencyMs: Date.now() - started,
        httpStatus: null,
        data: null,
        warning: redactSensitiveText(error instanceof Error ? error.message : String(error)),
      };
    }
  }

  private async fetchEndpoint(endpoint: GatewayEndpoint, method: "GET" | "POST", body: Record<string, unknown> | undefined): Promise<FetchResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const started = Date.now();
    try {
      const headers: Record<string, string> = { Accept: "application/json" };
      if (body !== undefined) headers["Content-Type"] = "application/json";
      if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;

      const response = await this.fetchImpl(new URL(endpoint, this.baseUrl ?? undefined), {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
      const text = await response.text();
      return {
        status: response.status,
        latencyMs: Date.now() - started,
        text: redactSensitiveText(text),
        contentType: response.headers.get("content-type") ?? "",
      };
    } finally {
      clearTimeout(timer);
    }
  }
}

export function redactSensitiveText(text: string): string {
  let redacted = text;
  redacted = redacted.replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, "[redacted-api-key]");
  redacted = redacted.replace(/\bBearer\s+[^\s"'`,)\]}]+/gi, "Bearer [redacted]");
  redacted = redacted.replace(
    new RegExp(String.raw`(^|[\s{\[(,])((?:export\s+)?${SENSITIVE_NAME_PATTERN})\s*=\s*${ASSIGNMENT_VALUE_PATTERN}`, "gmi"),
    (_match: string, prefix: string, name: string) => `${prefix}${name}=[redacted]`,
  );
  redacted = redacted.replace(
    new RegExp(String.raw`(["']?${SENSITIVE_NAME_PATTERN}["']?\s*[:=]\s*)${ASSIGNMENT_VALUE_PATTERN}`, "gmi"),
    (_match: string, prefix: string) => `${prefix}[redacted]`,
  );
  return redacted;
}

function disabledPayload<T>(endpoint: GatewayEndpoint): GatewayDebugPayload<T> {
  return {
    ok: false,
    endpoint,
    checkedAt: new Date().toISOString(),
    latencyMs: null,
    httpStatus: null,
    data: null,
    warning: "Gateway base URL is not configured.",
  };
}

function basePayload(endpoint: GatewayEndpoint, result: FetchResult): Omit<GatewayDebugPayload<unknown>, "data" | "warning"> {
  return {
    ok: result.status >= 200 && result.status < 300,
    endpoint,
    checkedAt: new Date().toISOString(),
    latencyMs: result.latencyMs,
    httpStatus: result.status,
  };
}

function warningPayload<T>(endpoint: GatewayEndpoint, result: FetchResult, warning: string): GatewayDebugPayload<T> {
  return {
    ...basePayload(endpoint, result),
    ok: false,
    data: null,
    warning,
  };
}

function normalizeBaseUrl(baseUrl: string | null): string | null {
  if (!baseUrl || baseUrl.trim() === "") return null;
  try {
    const url = new URL(baseUrl);
    url.pathname = url.pathname.endsWith("/") ? url.pathname : `${url.pathname}/`;
    return url.toString();
  } catch (error) {
    void error;
    return null;
  }
}

function parseJsonValue(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch (error) {
    return { parseError: redactSensitiveText(error instanceof Error ? error.message : String(error)) };
  }
}

function isJsonContentType(contentType: string): boolean {
  return /^application\/(?:[\w.+-]+\+)?json\b/i.test(contentType);
}

function readRecallRequest(body: unknown): Record<string, unknown> {
  const value = expectRecord(body);
  const query = expectString(value.query, "query");
  const sessionKey = expectString(value.session_key, "session_key");
  return {
    query,
    session_key: sessionKey,
    ...optionalStringField(value.user_id, "user_id"),
  };
}

function readMemorySearchRequest(body: unknown): Record<string, unknown> {
  const value = expectRecord(body);
  return {
    query: expectString(value.query, "query"),
    ...optionalLimitField(value.limit),
    ...optionalStringField(value.type, "type"),
    ...optionalStringField(value.scene, "scene"),
  };
}

function readConversationSearchRequest(body: unknown): Record<string, unknown> {
  const value = expectRecord(body);
  return {
    query: expectString(value.query, "query"),
    ...optionalLimitField(value.limit),
    ...optionalStringField(value.session_key, "session_key"),
  };
}

function expectRecord(value: unknown): Record<string, unknown> {
  if (isRecord(value)) return value;
  throw new Error("Request body must be a JSON object.");
}

function expectString(value: unknown, field: string): string {
  if (typeof value === "string" && value.trim() !== "") return value;
  throw new Error(`Missing required string field: ${field}.`);
}

function optionalStringField(value: unknown, field: string): Record<string, string> {
  if (value === undefined) return {};
  if (typeof value === "string") return { [field]: value };
  throw new Error(`Field must be a string: ${field}.`);
}

function optionalLimitField(value: unknown): Record<string, number> {
  if (value === undefined) return {};
  if (typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 100) return { limit: value };
  throw new Error("Field must be an integer from 0 to 100: limit.");
}

function isHealthDebugData(value: unknown): value is HealthDebugData {
  if (!isRecord(value) || (value.status !== "ok" && value.status !== "degraded")) return false;
  if (typeof value.version !== "string" || typeof value.uptime !== "number") return false;
  const stores = value.stores;
  return isRecord(stores) && typeof stores.vectorStore === "boolean" && typeof stores.embeddingService === "boolean";
}

function isRecallDebugData(value: unknown): value is RecallDebugData {
  return isRecord(value) && typeof value.context === "string";
}

function isMemorySearchDebugData(value: unknown): value is MemorySearchDebugData {
  return isRecord(value) && typeof value.results === "string" && typeof value.total === "number" && typeof value.strategy === "string";
}

function isConversationSearchDebugData(value: unknown): value is ConversationSearchDebugData {
  return isRecord(value) && typeof value.results === "string" && typeof value.total === "number";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
