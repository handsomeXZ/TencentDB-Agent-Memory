import type {
  CaptureRequest,
  CaptureResponse,
  GatewayErrorResponse,
  ConversationSearchRequest,
  ConversationSearchResponse,
  HealthResponse,
  MemorySearchRequest,
  MemorySearchResponse,
  RecallRequest,
  RecallResponse,
  SessionEndRequest,
  SessionEndResponse,
} from "../gateway/types.js";

export interface GatewayHttpClientOptions {
  baseUrl: string;
  apiKey?: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

export type GatewayHttpClientErrorKind =
  | "config"
  | "http"
  | "network"
  | "non_json"
  | "timeout";

export class GatewayHttpClientError extends Error {
  readonly kind: GatewayHttpClientErrorKind;
  readonly status?: number;

  constructor(message: string, options: { kind: GatewayHttpClientErrorKind; status?: number }) {
    super(message);
    this.name = "GatewayHttpClientError";
    this.kind = options.kind;
    this.status = options.status;
  }
}

export class GatewayHttpClient {
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: GatewayHttpClientOptions) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl);
    this.apiKey = options.apiKey?.trim() || undefined;
    this.timeoutMs = options.timeoutMs ?? 5_000;
    this.fetchImpl = options.fetch ?? fetch;
  }

  async health(): Promise<HealthResponse> {
    return this.request<HealthResponse>("GET", "/health", { auth: false });
  }

  async recall(request: RecallRequest): Promise<RecallResponse> {
    return this.request<RecallResponse>("POST", "/recall", { auth: true, body: request });
  }

  async capture(request: CaptureRequest): Promise<CaptureResponse> {
    return this.request<CaptureResponse>("POST", "/capture", { auth: true, body: request });
  }

  async searchMemories(request: MemorySearchRequest): Promise<MemorySearchResponse> {
    return this.request<MemorySearchResponse>("POST", "/search/memories", { auth: true, body: request });
  }

  async searchConversations(request: ConversationSearchRequest): Promise<ConversationSearchResponse> {
    return this.request<ConversationSearchResponse>("POST", "/search/conversations", { auth: true, body: request });
  }

  async endSession(request: SessionEndRequest): Promise<SessionEndResponse> {
    return this.request<SessionEndResponse>("POST", "/session/end", { auth: true, body: request });
  }

  private async request<T>(
    method: "GET" | "POST",
    path: string,
    options: { auth: boolean; body?: unknown },
  ): Promise<T> {
    if (options.auth && !this.apiKey) {
      throw new GatewayHttpClientError("Gateway API key is required for protected endpoint", {
        kind: "config",
      });
    }

    const headers: Record<string, string> = {};

    if (options.body !== undefined) {
      headers["Content-Type"] = "application/json";
    }
    if (options.auth) {
      headers.Authorization = `Bearer ${this.apiKey}`;
    }

    const maxAttempts = isRetryableReadEndpoint(method, path) ? 3 : 1;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

      try {
        const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
          method,
          headers,
          body: options.body === undefined ? undefined : JSON.stringify(options.body),
          signal: controller.signal,
        });

        const payload = await parseJsonResponse(response, this.apiKey);
        if (!response.ok) {
          const httpError = new GatewayHttpClientError(
            `Gateway ${method} ${path} failed with HTTP ${response.status}: ${extractErrorMessage(payload, this.apiKey)}`,
            { kind: "http", status: response.status },
          );

          if (shouldRetryHttp(response.status, attempt, maxAttempts)) {
            await sleep(retryDelayMs(attempt));
            continue;
          }

          throw httpError;
        }

        return payload as T;
      } catch (error) {
        if (error instanceof GatewayHttpClientError) {
          throw error;
        }
        if (controller.signal.aborted || isAbortError(error)) {
          throw new GatewayHttpClientError(`Gateway ${method} ${path} timed out after ${this.timeoutMs}ms`, {
            kind: "timeout",
          });
        }
        throw new GatewayHttpClientError(
          `Gateway ${method} ${path} network error: ${redactSecret(errorMessage(error), this.apiKey)}`,
          { kind: "network" },
        );
      } finally {
        clearTimeout(timeout);
      }
    }

    throw new GatewayHttpClientError(`Gateway ${method} ${path} exhausted retry attempts`, { kind: "http" });
  }
}

function normalizeBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim();
  if (!trimmed) {
    throw new GatewayHttpClientError("Gateway baseUrl is required", { kind: "config" });
  }
  return trimmed.replace(/\/+$/, "");
}

function isRetryableReadEndpoint(method: "GET" | "POST", path: string): boolean {
  if (method === "GET" && path === "/health") {
    return true;
  }
  return method === "POST" && (path === "/recall" || path === "/search/memories" || path === "/search/conversations");
}

function shouldRetryHttp(status: number, attempt: number, maxAttempts: number): boolean {
  return attempt < maxAttempts && (status === 429 || status >= 500);
}

function retryDelayMs(attempt: number): number {
  return attempt * 100;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function parseJsonResponse(response: Response, apiKey: string | undefined): Promise<unknown> {
  try {
    return await response.json();
  } catch (error) {
    throw new GatewayHttpClientError(
      `Gateway response non-JSON parse error: ${redactSecret(errorMessage(error), apiKey)}`,
      { kind: "non_json", status: response.status },
    );
  }
}

function extractErrorMessage(payload: unknown, apiKey: string | undefined): string {
  if (isGatewayErrorResponse(payload)) {
    return redactSecret(payload.error, apiKey);
  }
  return redactSecret(JSON.stringify(payload), apiKey);
}

function isGatewayErrorResponse(value: unknown): value is GatewayErrorResponse {
  return typeof value === "object" && value !== null && typeof (value as GatewayErrorResponse).error === "string";
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function redactSecret(message: string, apiKey: string | undefined): string {
  let redacted = message.replace(/Bearer\s+[^\s,)\]}]+/gi, "Bearer [redacted]");
  if (apiKey) {
    redacted = redacted.split(apiKey).join("[redacted]");
  }
  return redacted;
}
