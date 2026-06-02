// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";

import type { DashboardSnapshot } from "../contracts/dashboard";
import type { DashboardPage } from "../providers";
import type { DashboardApiClient, EvidenceLinkIndexEntry, OffloadResponse, PageRequest } from "./api-client";
import type { RequestTelemetryPage, RequestTelemetrySummary, SanitizedRequestLog } from "../../../../src/telemetry/request-telemetry.js";

describe("requests monitor route", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.innerHTML = "";
    document.body.appendChild(container);
    window.history.replaceState({}, "", "/");
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    vi.restoreAllMocks();
  });

  it("renders metrics, compact table, and sanitized detail drawer", async () => {
    await renderApp(createClient());

    await clickNav("请求监视 Requests Monitor");

    expect(textContent()).toContain("Requests Monitor");
    expect(textContent()).toContain("紧凑请求表");
    expect(textContent()).toContain("Gateway API");
    expect(textContent()).toContain("Visualizer API");
    expect(textContent()).toContain("/recall");
    expect(textContent()).toContain("只保留 path、query key 名");

    await clickRequestRow("gateway-01");

    expect(textContent()).toContain("请求详情");
    expect(textContent()).toContain("Query Keys");
    expect(textContent()).toContain("GW key");
    expect(textContent()).toContain("limit");
    expect(textContent()).not.toContain("raw-secret-token");
    expect(textContent()).not.toContain("x-api-key");
  });

  it("shows empty and degraded states when telemetry window has no rows but warnings exist", async () => {
    await renderApp(createClient({ requestsPage: createEmptyRequestPageWithWarning(), requestsSummary: createEmptyRequestSummaryWithWarning() }));

    await clickNav("请求监视 Requests Monitor");

    expect(textContent()).toContain("当前窗口没有请求记录");
    expect(textContent()).toContain("telemetry-file-missing");
    expect(textContent()).toContain("当前汇总窗口还没有足够的安全请求样本");
  });


  it("does not expose mutation controls on the request monitor route", async () => {
    await renderApp(createClient());

    await clickNav("请求监视 Requests Monitor");

    const interactiveLabels = [...container.querySelectorAll("button, a, select, input")]
      .map((element) => element.textContent ?? element.getAttribute("aria-label") ?? element.getAttribute("name") ?? "")
      .join(" ")
      .toLowerCase();

    for (const forbidden of ["retry", "replay", "delete", "export", "edit", "capture", "seed", "session-end", "session/end"]) {
      expect(interactiveLabels).not.toContain(forbidden);
    }
  });

  it("paginates and refreshes through the dashboard API client", async () => {
    const client = createClient({ requestsPageFactory: createPagedRequestFactory() });

    await renderApp(client);
    await clickNav("请求监视 Requests Monitor");

    expect(textContent()).toContain("gateway-01");

    await clickButton("下一页");

    expect(textContent()).toContain("gateway-21");
    expect(client.getRequests).toHaveBeenLastCalledWith(expect.any(Object), { offset: 20, limit: 20 });

    const refreshCallsBefore = client.getRequests.mock.calls.length;
    const refreshSummaryCallsBefore = client.getRequestsSummary.mock.calls.length;

    await clickButton("刷新窗口");

    expect(client.getRequests.mock.calls.length).toBeGreaterThan(refreshCallsBefore);
    expect(client.getRequestsSummary.mock.calls.length).toBeGreaterThan(refreshSummaryCallsBefore);
  });

  async function renderApp(client: DashboardApiClient) {
    await act(async () => {
      root.render(<App apiClient={client} />);
    });

    await flush();
    await flush();
    await flush();
  }

  async function clickNav(label: string) {
    const link = [...container.querySelectorAll("a")].find((element) => element.textContent?.includes(label));
    if (!(link instanceof HTMLAnchorElement)) throw new Error(`Navigation link not found: ${label}`);

    await act(async () => {
      link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });

    await flush();
    await flush();
  }

  async function clickButton(label: string) {
    const button = [...container.querySelectorAll("button")].find((element) => element.textContent?.includes(label));
    if (!(button instanceof HTMLButtonElement)) throw new Error(`Button not found: ${label}`);

    await act(async () => {
      button.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });

    await flush();
    await flush();
  }

  async function clickRequestRow(requestId: string) {
    const row = container.querySelector(`[data-request-id="${requestId}"]`);
    if (!(row instanceof HTMLElement)) throw new Error(`Request row not found: ${requestId}`);

    await act(async () => {
      row.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });

    await flush();
  }

  function textContent(): string {
    return container.textContent ?? "";
  }
});

function createClient(options: {
  readonly requestsPage?: RequestTelemetryPage;
  readonly requestsSummary?: RequestTelemetrySummary;
  readonly requestsPageFactory?: (page: PageRequest | undefined) => RequestTelemetryPage;
} = {}): DashboardApiClient & {
  readonly getRequests: ReturnType<typeof vi.fn>;
  readonly getRequestsSummary: ReturnType<typeof vi.fn>;
} {
  const snapshot = createSnapshot();
  const requestsPage = options.requestsPage ?? createRequestPage();
  const requestsSummary = options.requestsSummary ?? createRequestSummary();
  const requestsPageFactory = options.requestsPageFactory;
  const getRequests = vi.fn(async (_config: unknown, page?: PageRequest) => requestsPageFactory ? requestsPageFactory(page) : requestsPage);
  const getRequestsSummary = vi.fn(async () => requestsSummary);

  return {
    getSnapshot: async () => snapshot,
    getScenes: async () => createPage(snapshot.scenes),
    getMemories: async () => createPage(snapshot.structuredMemories),
    getEvidence: async () => createPage<EvidenceLinkIndexEntry>([]),
    getConversations: async () => createPage(snapshot.conversationEvidence),
    getOffload: async () => createOffload(snapshot),
    getRequests,
    getRequestsSummary,
    getGatewayHealth: async () => ({ ok: false, endpoint: "/health", checkedAt: snapshot.generatedAt, latencyMs: null, httpStatus: null, data: null, warning: "Gateway base URL is not configured." }),
    runGatewayRecallDebug: async () => ({ ok: false, endpoint: "/recall", checkedAt: snapshot.generatedAt, latencyMs: null, httpStatus: null, data: null, warning: "Gateway base URL is not configured." }),
    runGatewayMemorySearchDebug: async () => ({ ok: false, endpoint: "/search/memories", checkedAt: snapshot.generatedAt, latencyMs: null, httpStatus: null, data: null, warning: "Gateway base URL is not configured." }),
    runGatewayConversationSearchDebug: async () => ({ ok: false, endpoint: "/search/conversations", checkedAt: snapshot.generatedAt, latencyMs: null, httpStatus: null, data: null, warning: "Gateway base URL is not configured." }),
  };
}

function createSnapshot(): DashboardSnapshot {
  const generatedAt = "2026-05-30T12:00:00.000Z";
  return {
    snapshotId: `snapshot:${generatedAt}`,
    generatedAt,
    dataSource: {
      sourceLabel: "requests-monitor-fixture",
      memoryRootPath: "D:/fixtures/requests-monitor",
      profilesPath: "D:/fixtures/requests-monitor/profiles",
      scenesPath: "D:/fixtures/requests-monitor/scenes",
      l1DatabasePath: "D:/fixtures/requests-monitor/l1.jsonl",
      l0DatabasePath: "D:/fixtures/requests-monitor/l0.jsonl",
      offloadRootPath: "D:/fixtures/requests-monitor/offload",
      gatewayBaseUrl: null,
      gatewayApiKeyEnv: null,
      readOnly: true,
      environmentInputs: [],
    },
    capabilityReport: {
      generatedAt,
      persona: { status: "available", label: "Persona profile", detail: null, checkedAt: generatedAt, sourcePath: null, warningCodes: [] },
      scenes: { status: "available", label: "Scene blocks", detail: null, checkedAt: generatedAt, sourcePath: null, warningCodes: [] },
      structuredMemories: { status: "available", label: "Structured L1 memories", detail: null, checkedAt: generatedAt, sourcePath: null, warningCodes: [] },
      conversationEvidence: { status: "available", label: "Conversation L0 evidence", detail: null, checkedAt: generatedAt, sourcePath: null, warningCodes: [] },
      offloadCanvas: { status: "available", label: "Offload canvas", detail: null, checkedAt: generatedAt, sourcePath: null, warningCodes: [] },
      gatewayHealth: { status: "disabled", label: "Gateway health", detail: "Gateway is not configured.", checkedAt: generatedAt, sourcePath: null, warningCodes: [] },
      gatewaySearch: { status: "disabled", label: "Gateway search", detail: "Gateway is not configured.", checkedAt: generatedAt, sourcePath: null, warningCodes: [] },
      gatewayRecall: { status: "disabled", label: "Gateway recall", detail: "Gateway is not configured.", checkedAt: generatedAt, sourcePath: null, warningCodes: [] },
    },
    persona: null,
    scenes: [],
    structuredMemories: [],
    conversationEvidence: [],
    offloadCanvases: [],
    gateway: {
      baseUrl: null,
      health: { status: "disabled", label: "Gateway not configured", checkedAt: null, latencyMs: null, httpStatus: null, detail: null },
      search: { status: "disabled", label: "Gateway not configured", checkedAt: null, latencyMs: null, httpStatus: null, detail: null },
      recall: { status: "disabled", label: "Gateway not configured", checkedAt: null, latencyMs: null, httpStatus: null, detail: null },
    },
    warnings: [],
  };
}

function createOffload(snapshot: DashboardSnapshot): OffloadResponse {
  return {
    canvases: createPage(snapshot.offloadCanvases),
    references: createPage(snapshot.offloadCanvases.flatMap((canvas) => canvas.refs)),
  };
}

function createPage<T>(items: readonly T[]): DashboardPage<T> {
  return { items, total: items.length, offset: 0, limit: 25 };
}

function createRequestPage(items: readonly SanitizedRequestLog[] = createRequestItems().slice(0, 20), offset = 0, limit = 20): RequestTelemetryPage {
  return {
    items,
    total: createRequestItems().length,
    offset,
    limit,
    warnings: [],
  };
}

function createRequestSummary(): RequestTelemetrySummary {
  return {
    generatedAt: "2026-05-30T12:00:00.000Z",
    total: createRequestItems().length,
    last24h: createRequestItems().length,
    errorRate: 0.15,
    p95LatencyMs: 812,
    recent5xx: createRequestItems().filter((item) => (item.statusCode ?? 0) >= 500).slice(0, 2),
    sources: [
      { key: "visualizer-api", count: 12, errorCount: 1, unauthorizedCount: 1, averageLatencyMs: 186 },
      { key: "gateway", count: 12, errorCount: 2, unauthorizedCount: 1, averageLatencyMs: 412 },
    ],
    warnings: [],
  };
}

function createEmptyRequestPageWithWarning(): RequestTelemetryPage {
  return {
    items: [],
    total: 0,
    offset: 0,
    limit: 20,
    warnings: [{ code: "telemetry-file-missing", message: "Telemetry file was not found.", source: "gateway", detail: null }],
  };
}

function createEmptyRequestSummaryWithWarning(): RequestTelemetrySummary {
  return {
    generatedAt: "2026-05-30T12:00:00.000Z",
    total: 0,
    last24h: 0,
    errorRate: 0,
    p95LatencyMs: null,
    recent5xx: [],
    sources: [],
    warnings: [{ code: "telemetry-file-missing", message: "Telemetry file was not found.", source: "visualizer-api", detail: null }],
  };
}

function createPagedRequestFactory(): (page: PageRequest | undefined) => RequestTelemetryPage {
  const items = createRequestItems();
  return (page) => {
    const offset = page?.offset ?? 0;
    const limit = page?.limit ?? 20;
    return {
      items: items.slice(offset, offset + limit),
      total: items.length,
      offset,
      limit,
      warnings: [],
    };
  };
}

function createRequestItems(): readonly SanitizedRequestLog[] {
  return Array.from({ length: 24 }, (_, index) => {
    const isGateway = index % 2 === 0;
    const idBase = index + 1;
    const padded = String(idBase).padStart(2, "0");
    const statusCode = idBase % 11 === 0 ? 500 : idBase % 7 === 0 ? 401 : 200;
    return {
      id: `${isGateway ? "gateway" : "visualizer"}-${padded}`,
      source: isGateway ? "gateway" : "visualizer-api",
      method: isGateway ? "POST" : "GET",
      path: isGateway ? "/recall" : "/api/memories",
      routePattern: isGateway ? "/recall" : "/api/*",
      statusCode,
      outcome: statusCode >= 500 ? "error" : statusCode === 401 ? "unauthorized" : "ok",
      latencyMs: isGateway ? 400 + idBase * 10 : 120 + idBase * 4,
      authType: isGateway ? "gateway_api_key" : "visualizer_api_key",
      createdAt: `2026-05-30T12:${String(index).padStart(2, "0")}:00.000Z`,
      queryKeys: isGateway ? ["limit", "source"] : ["offset"],
      warningCodes: statusCode >= 500 ? ["server-error"] : [],
    };
  });
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}
