import { createDefaultDataSourceConfig } from "../contracts/dashboard";

import type {
  CapabilityReport,
  ConversationEvidence,
  DashboardSnapshot,
  DataSourceConfig,
  OffloadCanvas,
  OffloadReference,
  StructuredMemorySummary,
} from "../contracts/dashboard";
import type {
  DashboardPage,
  EvidenceLinkIndexEntry,
  LocalDashboardRequestConfig,
} from "./local-dashboard-data-provider";
import type { GatewayFetch } from "./gateway-debug-adapter";

export interface RemoteDashboardDataProviderOptions {
  readonly env?: NodeJS.ProcessEnv;
  readonly fetch?: GatewayFetch;
  readonly timeoutMs?: number;
}

const GATEWAY_URL_ENV = "TDAI_VIS_GATEWAY_URL";
const GATEWAY_API_KEY_ENV_KEYS = ["TDAI_VIS_GATEWAY_API_KEY", "TDAI_GATEWAY_API_KEY", "MEMORY_TENCENTDB_GATEWAY_API_KEY"] as const;
const DEFAULT_TIMEOUT_MS = 5_000;

export class RemoteDashboardDataProvider {
  private readonly env: NodeJS.ProcessEnv;
  private readonly fetchImpl: GatewayFetch;
  private readonly timeoutMs: number;

  public constructor(options: RemoteDashboardDataProviderOptions = {}) {
    this.env = options.env ?? process.env;
    this.fetchImpl = options.fetch ?? fetch;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  public async getSnapshot(_config: DataSourceConfig | LocalDashboardRequestConfig = {}): Promise<DashboardSnapshot> {
    return await this.fetchJson<DashboardSnapshot>("/visualizer/snapshot");
  }

  public async getCapabilities(config: DataSourceConfig | LocalDashboardRequestConfig = {}): Promise<CapabilityReport> {
    return (await this.getSnapshot(config)).capabilityReport;
  }

  public async getStructuredMemoriesPage(
    _config: DataSourceConfig | LocalDashboardRequestConfig = {},
    page: Partial<Pick<DashboardPage<StructuredMemorySummary>, "offset" | "limit">> = {},
  ): Promise<DashboardPage<StructuredMemorySummary>> {
    return await this.fetchJson<DashboardPage<StructuredMemorySummary>>("/visualizer/memories", page);
  }

  public async getConversationEvidencePage(
    _config: DataSourceConfig | LocalDashboardRequestConfig = {},
    page: Partial<Pick<DashboardPage<ConversationEvidence>, "offset" | "limit">> = {},
  ): Promise<DashboardPage<ConversationEvidence>> {
    return await this.fetchJson<DashboardPage<ConversationEvidence>>("/visualizer/conversations", page);
  }

  public async getOffloadCanvasesPage(
    _config: DataSourceConfig | LocalDashboardRequestConfig = {},
    page: Partial<Pick<DashboardPage<OffloadCanvas>, "offset" | "limit">> = {},
  ): Promise<DashboardPage<OffloadCanvas>> {
    return (await this.fetchJson<RemoteOffloadResponse>("/visualizer/offload", page)).canvases;
  }

  public async getOffloadReferencesPage(
    _config: DataSourceConfig | LocalDashboardRequestConfig = {},
    page: Partial<Pick<DashboardPage<OffloadReference>, "offset" | "limit">> = {},
  ): Promise<DashboardPage<OffloadReference>> {
    return (await this.fetchJson<RemoteOffloadResponse>("/visualizer/offload", page)).references;
  }

  public async getEvidenceLinkIndex(_config: DataSourceConfig | LocalDashboardRequestConfig = {}): Promise<readonly EvidenceLinkIndexEntry[]> {
    return await this.fetchJson<readonly EvidenceLinkIndexEntry[]>("/visualizer/evidence");
  }

  public resolveConfig(_config: DataSourceConfig | LocalDashboardRequestConfig = {}): DataSourceConfig {
    return createDefaultDataSourceConfig({
      sourceLabel: "gateway-memory",
      gatewayBaseUrl: this.readGatewayBaseUrl(),
      gatewayApiKeyEnv: this.detectGatewayApiKeyEnv(),
      environmentInputs: [GATEWAY_URL_ENV, ...optionalString(this.detectGatewayApiKeyEnv())],
    });
  }

  private async fetchJson<T>(pathname: string, page?: Partial<Pick<DashboardPage<unknown>, "offset" | "limit">>): Promise<T> {
    const url = this.createUrl(pathname, page);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetchImpl(url, {
        method: "GET",
        headers: this.createHeaders(),
        signal: controller.signal,
      });
      const text = await response.text();
      const payload = parseJson(text);

      if (!response.ok) {
        throw new Error(`Gateway visualizer API ${pathname} failed with HTTP ${response.status}: ${readErrorMessage(payload)}`);
      }

      return payload as T;
    } finally {
      clearTimeout(timer);
    }
  }

  private createUrl(pathname: string, page?: Partial<Pick<DashboardPage<unknown>, "offset" | "limit">>): string {
    const baseUrl = this.readGatewayBaseUrl();
    if (!baseUrl) throw new Error(`${GATEWAY_URL_ENV} is required for gateway dashboard data source.`);
    const url = new URL(pathname.replace(/^\/+/, ""), normalizeBaseUrl(baseUrl));
    if (typeof page?.offset === "number") url.searchParams.set("offset", String(page.offset));
    if (typeof page?.limit === "number") url.searchParams.set("limit", String(page.limit));
    return url.toString();
  }

  private createHeaders(): HeadersInit {
    const headers: Record<string, string> = { Accept: "application/json" };
    const keyEnv = this.detectGatewayApiKeyEnv();
    const apiKey = keyEnv ? this.env[keyEnv]?.trim() : "";
    if (!apiKey) throw new Error("Gateway visualizer data source requires TDAI_VIS_GATEWAY_API_KEY, TDAI_GATEWAY_API_KEY, or MEMORY_TENCENTDB_GATEWAY_API_KEY.");
    headers.Authorization = `Bearer ${apiKey}`;
    return headers;
  }

  private readGatewayBaseUrl(): string | null {
    const value = this.env[GATEWAY_URL_ENV]?.trim();
    return value && value.length > 0 ? value : null;
  }

  private detectGatewayApiKeyEnv(): string | null {
    for (const key of GATEWAY_API_KEY_ENV_KEYS) {
      const value = this.env[key];
      if (typeof value === "string" && value.trim() !== "") return key;
    }
    return null;
  }
}

interface RemoteOffloadResponse {
  readonly canvases: DashboardPage<OffloadCanvas>;
  readonly references: DashboardPage<OffloadReference>;
}

function normalizeBaseUrl(baseUrl: string): string {
  const url = new URL(baseUrl.trim());
  url.pathname = url.pathname.endsWith("/") ? url.pathname : `${url.pathname}/`;
  return url.toString();
}

function optionalString(value: string | null): readonly string[] {
  return value ? [value] : [];
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new Error(`Gateway visualizer API returned non-JSON content: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function readErrorMessage(payload: unknown): string {
  if (typeof payload === "object" && payload !== null && "error" in payload && typeof payload.error === "string") {
    return payload.error;
  }
  return "Unexpected Gateway error response";
}
