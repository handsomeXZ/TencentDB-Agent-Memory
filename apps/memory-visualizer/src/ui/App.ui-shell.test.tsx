// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";

import type { DashboardSnapshot } from "../contracts/dashboard";
import { DashboardApiError, type DashboardApiClient, type EvidenceLinkIndexEntry, type OffloadResponse } from "./api-client";
import type { DashboardPage } from "../providers";
import type { RequestTelemetryPage, RequestTelemetrySummary } from "../../../../src/telemetry/request-telemetry.js";

describe("ui-shell App", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.innerHTML = "";
    document.body.appendChild(container);
    window.history.replaceState({}, "", "/");
    window.sessionStorage.clear();
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    vi.restoreAllMocks();
  });

  it("renders ui-shell navigation and preserves the read-only banner after route changes", async () => {
    await renderApp(createClient(createSnapshot(), false));

    expect(textContent()).toContain("只读模式");
    expect(textContent()).toContain("总览");

    await clickNav("请求监视 Requests Monitor");
    expect(textContent()).toContain("紧凑请求表");
    expect(textContent()).toContain("只读模式");

    await clickNav("场景图谱 Scene Map");
    expect(textContent()).toContain("Contract design");
    expect(textContent()).toContain("只读模式");

    await clickNav("记忆浏览 Memory Explorer");
    expect(textContent()).toContain("按分页查看的结构化 Memory 索引");

    await clickNav("证据下钻 Evidence Drill-down");
    expect(textContent()).toContain("当前页面记录");

    await clickNav("任务画布 Offload Task Canvas");
    expect(textContent()).toContain("Map the dashboard shell");

    await clickNav("调试 Search/Recall Debug");
    expect(textContent()).toContain("健康状态与安全端点范围");

    await clickNav("设置 / 状态");
    expect(textContent()).toContain("路径配置");
    expect(textContent()).toContain("仅选择本地只读数据源");
  });

  it("renders grouped navigation and preserves source query parameters in nav hrefs and route changes", async () => {
    window.history.replaceState({}, "", "/?sourceLabel=gateway-fixture&dataDir=D:/fixture-data");

    await renderApp(createClient(createSnapshot(), false));

    expect(textContent()).toContain("Overview");
    expect(textContent()).toContain("Observability");
    expect(textContent()).toContain("Explore");
    expect(textContent()).toContain("Trace");
    expect(textContent()).toContain("Debug");
    expect(textContent()).toContain("System");
    expect(textContent()).toContain("Requests Monitor");

    expect(getNavHref("请求监视 Requests Monitor")).toBe("/requests-monitor?dataDir=D%3A%2Ffixture-data&sourceLabel=gateway-fixture");
    expect(getNavHref("场景图谱 Scene Map")).toBe("/scene-map?dataDir=D%3A%2Ffixture-data&sourceLabel=gateway-fixture");
    expect(getNavHref("设置 / 状态")).toBe("/settings-status?dataDir=D%3A%2Ffixture-data&sourceLabel=gateway-fixture");

    await clickNav("场景图谱 Scene Map");

    expect(window.location.pathname).toBe("/scene-map");
    expect(new URLSearchParams(window.location.search).get("sourceLabel")).toBe("gateway-fixture");
    expect(new URLSearchParams(window.location.search).get("dataDir")).toBe("D:/fixture-data");
    expect(textContent()).toContain("Contract design");
  });

  it("renders ui-shell degraded empty states when the source is missing", async () => {
    await renderApp(createClient(createSnapshot(true), true));

    expect(textContent()).toContain("检测到能力降级");
    expect(textContent()).toContain("data-dir-missing");

    await clickNav("场景图谱 Scene Map");
    expect(textContent()).toContain("没有可用的 Scene Map");

    await clickNav("设置 / 状态");
    expect(textContent()).toContain("missing-fixture");
    expect(textContent()).toContain("只读模式");
  });

  it("shows login on unauthorized load, validates the shared key, and logs out cleanly", async () => {
    const secret = "vis-test-secret-1234567890";
    await renderApp(undefined, createAuthAwareClientFactory(createSnapshot(), secret));

    expect(textContent()).toContain("输入共享访问密钥");
    expect(textContent()).not.toContain("共享密钥已验证");

    await changeInputByAriaLabel("共享访问密钥", "wrong-token");
    await clickButton("登录并验证");

    expect(textContent()).toContain("登录失败");
    expect(textContent()).toContain("共享访问密钥无效，请检查后重试。");

    await changeInputByAriaLabel("共享访问密钥", secret);
    await clickButton("登录并验证");

    expect(textContent()).toContain("共享密钥已验证");
    expect(textContent()).toContain("退出登录");
    expect(textContent()).toContain("总览");

    await clickButton("退出登录");

    expect(textContent()).toContain("输入共享访问密钥");
    expect(textContent()).not.toContain("共享密钥已验证");
  });

  it("reuses a stored shared key when auth is required on reload", async () => {
    const secret = "vis-test-secret-1234567890";
    window.sessionStorage.setItem("tdai-memory-visualizer-api-key", secret);

    await renderApp(undefined, createAuthAwareClientFactory(createSnapshot(), secret));

    expect(textContent()).toContain("共享密钥已验证");
    expect(textContent()).not.toContain("输入共享访问密钥");
  });

  it("shows a deployment configuration error when production auth lacks a server key", async () => {
    await renderApp(undefined, createAuthConfigurationErrorClientFactory());

    expect(textContent()).toContain("输入共享访问密钥");
    expect(textContent()).toContain("尚未配置 TDAI_VIS_API_KEY");
  });

  it("clears a stored shared key when auth is not required", async () => {
    window.sessionStorage.setItem("tdai-memory-visualizer-api-key", "stale-token");

    await renderApp(createClient(createSnapshot(), false));

    expect(textContent()).toContain("本地免登录");
    expect(textContent()).not.toContain("共享密钥已验证");
    expect(window.sessionStorage.getItem("tdai-memory-visualizer-api-key")).toBeNull();
  });

  async function renderApp(client?: DashboardApiClient, apiClientFactory?: (getApiKey: () => string | undefined) => DashboardApiClient) {
    await act(async () => {
      root.render(<App apiClient={client} apiClientFactory={apiClientFactory} />);
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
  }

  async function changeInputByAriaLabel(label: string, value: string) {
    const input = container.querySelector(`input[aria-label="${label}"]`);
    if (!(input instanceof HTMLInputElement)) throw new Error(`Input not found: ${label}`);
    const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
    const setter = descriptor?.set;
    if (!setter) throw new Error("HTMLInputElement value setter not found");

    await act(async () => {
      setter.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });

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

  function textContent(): string {
    return container.textContent ?? "";
  }

  function getNavHref(label: string): string {
    const link = [...container.querySelectorAll("a")].find((element) => element.textContent?.includes(label));
    if (!(link instanceof HTMLAnchorElement)) throw new Error(`Navigation link not found: ${label}`);
    return link.getAttribute("href") ?? "";
  }
});

function createClient(snapshot: DashboardSnapshot, missingData: boolean): DashboardApiClient {
  const scenes: DashboardPage<DashboardSnapshot["scenes"][number]> = {
    items: missingData ? [] : snapshot.scenes,
    total: missingData ? 0 : snapshot.scenes.length,
    offset: 0,
    limit: 50,
  };
  const memories: DashboardPage<DashboardSnapshot["structuredMemories"][number]> = {
    items: missingData ? [] : snapshot.structuredMemories,
    total: missingData ? 0 : snapshot.structuredMemories.length,
    offset: 0,
    limit: 50,
  };
  const evidenceLinks: DashboardPage<EvidenceLinkIndexEntry> = {
    items: missingData
      ? []
      : [
          {
            memoryRecordId: "l1:memory:1",
            evidenceIds: ["l0:message:1"],
            evidenceRecords: snapshot.conversationEvidence.slice(0, 1),
          },
        ],
    total: missingData ? 0 : 1,
    offset: 0,
    limit: 50,
  };
  const conversations: DashboardPage<DashboardSnapshot["conversationEvidence"][number]> = {
    items: missingData ? [] : snapshot.conversationEvidence,
    total: missingData ? 0 : snapshot.conversationEvidence.length,
    offset: 0,
    limit: 50,
  };
  const offload: OffloadResponse = {
    canvases: {
      items: missingData ? [] : snapshot.offloadCanvases,
      total: missingData ? 0 : snapshot.offloadCanvases.length,
      offset: 0,
      limit: 50,
    },
    references: {
      items: missingData ? [] : snapshot.offloadCanvases.flatMap((canvas) => canvas.refs),
      total: missingData ? 0 : snapshot.offloadCanvases.flatMap((canvas) => canvas.refs).length,
      offset: 0,
      limit: 50,
    },
  };
  const requests = createEmptyRequestPage();
  const requestsSummary = createEmptyRequestSummary();

  return {
    getSnapshot: async () => snapshot,
    getScenes: async () => scenes,
    getMemories: async () => memories,
    getEvidence: async () => evidenceLinks,
    getConversations: async () => conversations,
    getOffload: async () => offload,
    getRequests: async () => requests,
    getRequestsSummary: async () => requestsSummary,
    getGatewayHealth: async () => ({ ok: false, endpoint: "/health", checkedAt: "2026-05-30T12:00:00.000Z", latencyMs: null, httpStatus: null, data: null, warning: "Gateway base URL is not configured." }),
    runGatewayRecallDebug: async () => ({ ok: false, endpoint: "/recall", checkedAt: "2026-05-30T12:00:00.000Z", latencyMs: null, httpStatus: null, data: null, warning: "Gateway base URL is not configured." }),
    runGatewayMemorySearchDebug: async () => ({ ok: false, endpoint: "/search/memories", checkedAt: "2026-05-30T12:00:00.000Z", latencyMs: null, httpStatus: null, data: null, warning: "Gateway base URL is not configured." }),
    runGatewayConversationSearchDebug: async () => ({ ok: false, endpoint: "/search/conversations", checkedAt: "2026-05-30T12:00:00.000Z", latencyMs: null, httpStatus: null, data: null, warning: "Gateway base URL is not configured." }),
  };
}

function createAuthAwareClientFactory(snapshot: DashboardSnapshot, secret: string): (getApiKey: () => string | undefined) => DashboardApiClient {
  return (getApiKey) => {
    const delegate = createClient(snapshot, false);
    const assertKey = () => {
      if (getApiKey() !== secret) throw new DashboardApiError("Unauthorized (unauthorized)", 401, "unauthorized");
    };

    return {
      getSnapshot: async (config) => {
        assertKey();
        return delegate.getSnapshot(config);
      },
      getScenes: async (config) => {
        assertKey();
        return delegate.getScenes(config);
      },
      getMemories: async (config, page) => {
        assertKey();
        return delegate.getMemories(config, page);
      },
      getEvidence: async (config, page) => {
        assertKey();
        return delegate.getEvidence(config, page);
      },
      getConversations: async (config, page) => {
        assertKey();
        return delegate.getConversations(config, page);
      },
      getOffload: async (config) => {
        assertKey();
        return delegate.getOffload(config);
      },
      getRequests: async (config, page) => {
        assertKey();
        return delegate.getRequests(config, page);
      },
      getRequestsSummary: async (config) => {
        assertKey();
        return delegate.getRequestsSummary(config);
      },
      getGatewayHealth: async (config) => {
        assertKey();
        return delegate.getGatewayHealth(config);
      },
      runGatewayRecallDebug: async (config, body) => {
        assertKey();
        return delegate.runGatewayRecallDebug(config, body);
      },
      runGatewayMemorySearchDebug: async (config, body) => {
        assertKey();
        return delegate.runGatewayMemorySearchDebug(config, body);
      },
      runGatewayConversationSearchDebug: async (config, body) => {
        assertKey();
        return delegate.runGatewayConversationSearchDebug(config, body);
      },
    };
  };
}

function createAuthConfigurationErrorClientFactory(): (getApiKey: () => string | undefined) => DashboardApiClient {
  return () => {
    const reject = async () => {
      throw new DashboardApiError("Memory Visualizer authentication is required but TDAI_VIS_API_KEY is not configured. (auth-not-configured)", 503, "auth-not-configured");
    };

    return {
      getSnapshot: reject,
      getScenes: reject,
      getMemories: reject,
      getEvidence: reject,
      getConversations: reject,
      getOffload: reject,
      getRequests: reject,
      getRequestsSummary: reject,
      getGatewayHealth: reject,
      runGatewayRecallDebug: reject,
      runGatewayMemorySearchDebug: reject,
      runGatewayConversationSearchDebug: reject,
    };
  };
}

function createSnapshot(missingData = false): DashboardSnapshot {
  const generatedAt = "2026-05-30T12:00:00.000Z";
  return {
    snapshotId: `snapshot:${generatedAt}`,
    generatedAt,
    dataSource: {
      sourceLabel: missingData ? "missing-fixture" : "complete-data-dir",
      memoryRootPath: missingData ? "" : "D:/fixtures/complete-data-dir",
      profilesPath: missingData ? "" : "D:/fixtures/complete-data-dir/profiles",
      scenesPath: missingData ? "" : "D:/fixtures/complete-data-dir/scenes",
      l1DatabasePath: missingData ? "" : "D:/fixtures/complete-data-dir/records/l1.jsonl",
      l0DatabasePath: missingData ? "" : "D:/fixtures/complete-data-dir/conversations/l0.jsonl",
      offloadRootPath: missingData ? "" : "D:/fixtures/complete-data-dir/offload",
      gatewayBaseUrl: null,
      gatewayApiKeyEnv: null,
      readOnly: true,
      environmentInputs: [],
    },
    capabilityReport: {
      generatedAt,
      persona: { status: missingData ? "missing" : "available", label: "Persona profile", detail: missingData ? "Missing data: data-dir-missing" : null, checkedAt: generatedAt, sourcePath: null, warningCodes: missingData ? ["data-dir-missing"] : [] },
      scenes: { status: missingData ? "missing" : "partial", label: "Scene blocks", detail: missingData ? "Missing data: data-dir-missing" : "Parsed with warnings: scene-metadata-missing", checkedAt: generatedAt, sourcePath: null, warningCodes: missingData ? ["data-dir-missing"] : ["scene-metadata-missing"] },
      structuredMemories: { status: missingData ? "missing" : "available", label: "Structured L1 memories", detail: missingData ? "Missing data: data-dir-missing" : null, checkedAt: generatedAt, sourcePath: null, warningCodes: missingData ? ["data-dir-missing"] : [] },
      conversationEvidence: { status: missingData ? "missing" : "available", label: "Conversation L0 evidence", detail: missingData ? "Missing data: data-dir-missing" : null, checkedAt: generatedAt, sourcePath: null, warningCodes: missingData ? ["data-dir-missing"] : [] },
      offloadCanvas: { status: missingData ? "disabled" : "available", label: "Offload canvas", detail: missingData ? "Offload root is not configured or not present." : null, checkedAt: generatedAt, sourcePath: null, warningCodes: missingData ? ["offload-root-disabled"] : [] },
      gatewayHealth: { status: "disabled", label: "Gateway health", detail: "Gateway is not configured.", checkedAt: generatedAt, sourcePath: null, warningCodes: [] },
      gatewaySearch: { status: "disabled", label: "Gateway search", detail: "Gateway is not configured.", checkedAt: generatedAt, sourcePath: null, warningCodes: [] },
      gatewayRecall: { status: "disabled", label: "Gateway recall", detail: "Gateway is not configured.", checkedAt: generatedAt, sourcePath: null, warningCodes: [] },
    },
    persona: missingData
      ? null
      : {
          profileId: "profile:v1:fixture",
          filename: "persona.md",
          available: true,
          title: "Fixture persona",
          contentSummary: "Preference memory",
          contentPreview: "Likes precise summaries.",
          contentMd5: "abc123",
          agentId: null,
          version: 1,
          createdAtMs: 1,
          updatedAtMs: 1,
          sourcePath: "D:/fixtures/complete-data-dir/profiles/persona.md",
          sceneIds: ["scene:contracts"],
          rawMetadata: null,
        },
    scenes: missingData
      ? []
      : [
          {
            sceneId: "scene:contracts",
            filename: "contracts.md",
            title: "Contract design",
            contentSummary: "Summarized contract constraints",
            contentPreview: "A compact scene preview",
            heatScore: 0.82,
            memoryCount: 2,
            updatedAtMs: 1,
            sourcePath: "D:/fixtures/complete-data-dir/scenes/contracts.md",
            relatedPersonaIds: ["profile:v1:fixture"],
            evidenceRecordIds: ["l0:message:1"],
            rawMetadata: null,
          },
        ],
    structuredMemories: missingData
      ? []
      : [
          {
            recordId: "l1:memory:1",
            content: "Keep strict contracts.",
            contentPreview: "Keep strict contracts.",
            type: "constraint",
            priority: 9,
            sceneName: "Contract design",
            sessionKey: "session-alpha",
            sessionId: "session-alpha",
            sourceId: "source-1",
            timestampLabel: "recent",
            timestampStart: generatedAt,
            timestampEnd: generatedAt,
            createdTime: generatedAt,
            updatedTime: generatedAt,
            score: 0.9,
            evidenceIds: ["l0:message:1"],
            rawMetadata: null,
          },
        ],
    conversationEvidence: missingData
      ? []
      : [
          {
            recordId: "l0:message:1",
            sessionKey: "session-alpha",
            sessionId: "session-alpha",
            role: "user",
            snippet: "Preserve contract compatibility.",
            recordedAt: generatedAt,
            timestamp: Date.parse(generatedAt),
            score: 0.8,
            sourceMemoryIds: ["l1:memory:1"],
          },
        ],
    offloadCanvases: missingData
      ? []
      : [
          {
            canvasId: "mmd:001",
            filename: "task.mmd",
            path: "D:/fixtures/complete-data-dir/offload/task.mmd",
            taskGoal: "Map the dashboard shell",
            createdTime: generatedAt,
            updatedTime: generatedAt,
            doneCount: 1,
            doingCount: 0,
            todoCount: 1,
            nodes: [
              { nodeId: "N1", label: "Route shell", status: "done", summary: "Added shell", timestamp: generatedAt },
              { nodeId: "N2", label: "Verify", status: "todo", summary: "Run QA", timestamp: generatedAt },
            ],
            refs: [
              {
                toolCallId: "call-001",
                nodeId: "N1",
                toolCall: "rg",
                summary: "Mapped existing files.",
                resultRef: "refs/001.md",
                timestamp: generatedAt,
                sessionKey: "session-alpha",
                score: 0.7,
              },
            ],
            rawMetadata: null,
          },
        ],
    gateway: {
      baseUrl: null,
      health: { status: "disabled", label: "Gateway not configured", checkedAt: null, latencyMs: null, httpStatus: null, detail: null },
      search: { status: "disabled", label: "Gateway not configured", checkedAt: null, latencyMs: null, httpStatus: null, detail: null },
      recall: { status: "disabled", label: "Gateway not configured", checkedAt: null, latencyMs: null, httpStatus: null, detail: null },
    },
    warnings: missingData
      ? [
          {
            source: "",
            code: "data-dir-missing",
            severity: "warning",
            message: "Memory data directory was not found.",
            location: null,
            rawValue: null,
          },
        ]
      : [
          {
            source: "D:/fixtures/complete-data-dir/scenes/contracts.md",
            code: "scene-metadata-missing",
            severity: "warning",
            message: "Scene metadata was incomplete.",
            location: null,
            rawValue: null,
          },
        ],
  };
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}

function createEmptyRequestPage(): RequestTelemetryPage {
  return {
    items: [],
    total: 0,
    offset: 0,
    limit: 20,
    warnings: [],
  };
}

function createEmptyRequestSummary(): RequestTelemetrySummary {
  return {
    generatedAt: "2026-05-30T12:00:00.000Z",
    total: 0,
    last24h: 0,
    errorRate: 0,
    p95LatencyMs: null,
    recent5xx: [],
    sources: [],
    warnings: [],
  };
}
