// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("mermaid", () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn(async (_id: string, source: string) => ({ svg: `<svg data-length="${source.length}"></svg>` })),
  },
}));

import { App } from "./App";

import type { DashboardSnapshot } from "../contracts/dashboard";
import type { DashboardPage } from "../providers";
import type { DashboardApiClient, OffloadResponse } from "./api-client";

describe("offload and gateway debug views", () => {
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

  it("shows invalid Mermaid fallback text and parser warning", async () => {
    await renderApp(createClient());

    await clickNav("任务画布 Offload Task Canvas");

    expect(textContent()).toContain("画布渲染与回退");
    expect(textContent()).toContain("Mermaid 回退内容无效");
    expect(textContent()).toContain("原始回退预览");
    expect(textContent()).toContain("this is not mermaid syntax node without graph header");
    expect(textContent()).toContain("offload-mermaid-invalid");
    expect(textContent()).toContain("refs/call-invalid-001.md");
  });

  it("renders raw memory search debug text without inventing structured cards", async () => {
    const client = createClient();
    await renderApp(client);

    await clickNav("调试 Search/Recall Debug");
    await changeInput("Memory 搜索查询", "workspace");
    await clickButton("运行 Memory 搜索");

    expect(client.runGatewayMemorySearchDebug).toHaveBeenCalledWith(expect.any(Object), { query: "workspace", limit: 5 });
    expect(client.runGatewayRecallDebug).not.toHaveBeenCalled();
    expect(client.runGatewayConversationSearchDebug).not.toHaveBeenCalled();
    expect(textContent()).toContain("`/search/*` 主响应保持原样");
    expect(textContent()).toContain("# Raw memory result");
    expect(textContent()).toContain("keep formatting");
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

  async function changeInput(label: string, value: string) {
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
});

function createClient(): DashboardApiClient & {
  readonly runGatewayMemorySearchDebug: ReturnType<typeof vi.fn>;
  readonly runGatewayRecallDebug: ReturnType<typeof vi.fn>;
  readonly runGatewayConversationSearchDebug: ReturnType<typeof vi.fn>;
} {
  const generatedAt = "2026-05-30T12:00:00.000Z";
  const snapshot = createSnapshot(generatedAt);
  const offload: OffloadResponse = {
    canvases: createPage(snapshot.offloadCanvases),
    references: createPage(snapshot.offloadCanvases.flatMap((canvas) => canvas.refs)),
  };
  const runGatewayMemorySearchDebug = vi.fn(async () => ({
    ok: true,
    endpoint: "/search/memories" as const,
    checkedAt: generatedAt,
    latencyMs: 12,
    httpStatus: 200,
    data: { results: "# Raw memory result\n- keep formatting", total: 1, strategy: "hybrid" },
    warning: null,
  }));
  const runGatewayRecallDebug = vi.fn(async () => ({
    ok: true,
    endpoint: "/recall" as const,
    checkedAt: generatedAt,
    latencyMs: 9,
    httpStatus: 200,
    data: { context: "remember workspace", strategy: "hybrid", memory_count: 1 },
    warning: null,
  }));
  const runGatewayConversationSearchDebug = vi.fn(async () => ({
    ok: true,
    endpoint: "/search/conversations" as const,
    checkedAt: generatedAt,
    latencyMs: 8,
    httpStatus: 200,
    data: { results: "user: workspace", total: 1 },
    warning: null,
  }));

  return {
    getSnapshot: async () => snapshot,
    getScenes: async () => createPage(snapshot.scenes),
    getMemories: async () => createPage(snapshot.structuredMemories),
    getEvidence: async () => createPage([]),
    getConversations: async () => createPage(snapshot.conversationEvidence),
    getOffload: async () => offload,
    getGatewayHealth: async () => ({
      ok: true,
      endpoint: "/health",
      checkedAt: generatedAt,
      latencyMs: 5,
      httpStatus: 200,
      data: { status: "ok", version: "test", uptime: 7, stores: { vectorStore: true, embeddingService: false } },
      warning: null,
    }),
    runGatewayRecallDebug,
    runGatewayMemorySearchDebug,
    runGatewayConversationSearchDebug,
  };
}

function createSnapshot(generatedAt: string): DashboardSnapshot {
  return {
    snapshotId: `snapshot:${generatedAt}`,
    generatedAt,
    dataSource: {
      sourceLabel: "offload-invalid-mermaid",
      memoryRootPath: "D:/fixtures/offload-invalid-mermaid",
      profilesPath: "",
      scenesPath: "",
      l1DatabasePath: "",
      l0DatabasePath: "",
      offloadRootPath: "D:/fixtures/offload-invalid-mermaid/offload",
      gatewayBaseUrl: "http://gateway.test",
      gatewayApiKeyEnv: null,
      readOnly: true,
      environmentInputs: [],
    },
    capabilityReport: {
      generatedAt,
      persona: { status: "missing", label: "Persona profile", detail: "No data was parsed.", checkedAt: generatedAt, sourcePath: null, warningCodes: [] },
      scenes: { status: "missing", label: "Scene blocks", detail: "No data was parsed.", checkedAt: generatedAt, sourcePath: null, warningCodes: [] },
      structuredMemories: { status: "missing", label: "Structured L1 memories", detail: "No data was parsed.", checkedAt: generatedAt, sourcePath: null, warningCodes: [] },
      conversationEvidence: { status: "missing", label: "Conversation L0 evidence", detail: "No data was parsed.", checkedAt: generatedAt, sourcePath: null, warningCodes: [] },
      offloadCanvas: { status: "partial", label: "Offload canvas", detail: "Parsed with warnings: offload-mermaid-invalid", checkedAt: generatedAt, sourcePath: "D:/fixtures/offload-invalid-mermaid/offload", warningCodes: ["offload-mermaid-invalid"] },
      gatewayHealth: { status: "partial", label: "Gateway health", detail: "Gateway debug route is configured; run a live probe in Search/Recall Debug.", checkedAt: generatedAt, sourcePath: "http://gateway.test", warningCodes: [] },
      gatewaySearch: { status: "partial", label: "Gateway search", detail: "Gateway debug route is configured; run a live probe in Search/Recall Debug.", checkedAt: generatedAt, sourcePath: "http://gateway.test", warningCodes: [] },
      gatewayRecall: { status: "partial", label: "Gateway recall", detail: "Gateway debug route is configured; run a live probe in Search/Recall Debug.", checkedAt: generatedAt, sourcePath: "http://gateway.test", warningCodes: [] },
    },
    persona: null,
    scenes: [],
    structuredMemories: [],
    conversationEvidence: [],
    offloadCanvases: [
      {
        canvasId: "mmd:invalid",
        filename: "invalid.mmd",
        path: "D:/fixtures/offload-invalid-mermaid/offload/agent-planner/mmds/invalid.mmd",
        taskGoal: "this is not mermaid syntax node without graph header",
        createdTime: null,
        updatedTime: "2026-05-30T00:20:00.000Z",
        doneCount: 0,
        doingCount: 0,
        todoCount: 0,
        nodes: [{ nodeId: "raw:invalid", label: "Raw Mermaid fallback", status: "unknown", summary: "this is not mermaid syntax node without graph header", timestamp: null }],
        refs: [{ toolCallId: "call-invalid-001", nodeId: "X1", toolCall: "parse offload", summary: "Captured invalid mmd fixture.", resultRef: "refs/call-invalid-001.md", timestamp: "2026-05-30T00:20:00.000Z", sessionKey: "agent:fixture-agent:session-beta", score: 1 }],
        rawMetadata: { fallbackText: "this is not mermaid syntax node without graph header", mermaidSource: "" },
      },
    ],
    gateway: {
      baseUrl: "http://gateway.test",
      health: { status: "partial", label: "Gateway health", checkedAt: generatedAt, latencyMs: null, httpStatus: null, detail: null },
      search: { status: "partial", label: "Gateway search", checkedAt: generatedAt, latencyMs: null, httpStatus: null, detail: null },
      recall: { status: "partial", label: "Gateway recall", checkedAt: generatedAt, latencyMs: null, httpStatus: null, detail: null },
    },
    warnings: [{ source: "D:/fixtures/offload-invalid-mermaid/offload/agent-planner/mmds/invalid.mmd", code: "offload-mermaid-invalid", severity: "warning", message: "Mermaid graph header was not found; raw fallback text was preserved.", location: null, rawValue: "this is not mermaid syntax" }],
  };
}

function createPage<T>(items: readonly T[]): DashboardPage<T> {
  return { items, total: items.length, offset: 0, limit: 25 };
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}
