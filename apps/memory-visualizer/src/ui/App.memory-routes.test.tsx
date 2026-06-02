// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";

import type { DashboardSnapshot } from "../contracts/dashboard";
import type { DashboardPage } from "../providers";
import type { DashboardApiClient, OffloadResponse } from "./api-client";
import type { RequestTelemetryPage, RequestTelemetrySummary } from "../../../../src/telemetry/request-telemetry.js";

describe("memory routes", () => {
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

  it("filters persona memories at priority >= 80 and updates visible summaries", async () => {
    await renderApp(createClient(createMemorySnapshot()));

    await clickNav("记忆浏览 Memory Explorer");
    await changeSelect("Type 类型", "persona");
    await changeInput("最低优先级", "80");

    expect(textContent()).toContain("当前可见的 Memory 组成");
    expect(textContent()).toContain("persona");
    expect(textContent()).toContain("2 条匹配");
    expect(textContent()).toContain("The user prefers deterministic fixtures with explicit IDs.");
    expect(textContent()).toContain("The user values read-only visual debugging surfaces over mutation controls.");
    expect(textContent()).not.toContain("Visualizer contracts stay app-local.");
    expect(textContent()).toContain("80-89 高");
    expect(textContent()).toContain("90-100 严重");
  });

  it("shows the JSONL fallback warning on Memory Explorer for sqlite metadata read errors", async () => {
    await renderApp(createClient(createMemorySnapshot("sqlite-metadata-read-error")));

    await clickNav("记忆浏览 Memory Explorer");

    expect(textContent()).toContain("JSONL 回退结果可能已过时");
    expect(textContent()).toContain("这里拿不到 SQLite 的有效记录，因此追加式 JSONL 解析可能包含过期更新或已合并内容。时间戳和 Evidence 轨迹请仅作为尽力提示。");
  });

  it("shows missing evidence warnings and resolved snippet details for the selected memory", async () => {
    await renderApp(createClient(createMemorySnapshot()));

    await clickNav("证据下钻 Evidence Drill-down");
    await clickButtonBySnippet("The user values read-only visual debugging surfaces over mutation controls.");

    expect(textContent()).toContain("缺少源 Evidence");
    expect(textContent()).toContain("l0:message:missing-404");
    expect(textContent()).toContain("追加式 JSONL 轨迹");
    expect(textContent()).toContain("没有解析到 L0 片段");
  });

  async function renderApp(client: DashboardApiClient) {
    await act(async () => {
      root.render(<App apiClient={client} />);
    });

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

  async function changeInput(label: string, value: string) {
    const input = [...container.querySelectorAll("label")].find((element) => element.textContent?.includes(label))?.querySelector("input");
    if (!(input instanceof HTMLInputElement)) throw new Error(`Input not found: ${label}`);

    await act(async () => {
      input.value = value;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });

    await flush();
  }

  async function changeSelect(label: string, value: string) {
    const select = [...container.querySelectorAll("label")].find((element) => element.textContent?.includes(label))?.querySelector("select");
    if (!(select instanceof HTMLSelectElement)) throw new Error(`Select not found: ${label}`);

    await act(async () => {
      select.value = value;
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });

    await flush();
  }

  async function clickButtonBySnippet(snippet: string) {
    const button = [...container.querySelectorAll("button")].find((element) => element.textContent?.includes(snippet));
    if (!(button instanceof HTMLButtonElement)) throw new Error(`Button not found: ${snippet}`);

    await act(async () => {
      button.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });

    await flush();
  }

  function textContent(): string {
    return container.textContent ?? "";
  }
});

function createClient(snapshot: DashboardSnapshot): DashboardApiClient {
  const memories = createPage(snapshot.structuredMemories);
  const evidence = createPage(
    snapshot.structuredMemories.map((memory) => ({
      memoryRecordId: memory.recordId,
      evidenceIds: memory.evidenceIds,
      evidenceRecords: snapshot.conversationEvidence.filter((record) => memory.evidenceIds.includes(record.recordId)),
    })),
  );
  const conversations = createPage(snapshot.conversationEvidence);
  const scenes = createPage(snapshot.scenes);
  const offload: OffloadResponse = {
    canvases: createPage(snapshot.offloadCanvases),
    references: createPage(snapshot.offloadCanvases.flatMap((canvas) => canvas.refs)),
  };

  return {
    getSnapshot: async () => snapshot,
    getScenes: async () => scenes,
    getMemories: async () => memories,
    getEvidence: async () => evidence,
    getConversations: async () => conversations,
    getOffload: async () => offload,
    getRequests: async () => createEmptyRequestPage(),
    getRequestsSummary: async () => createEmptyRequestSummary(),
    getGatewayHealth: async () => ({ ok: false, endpoint: "/health", checkedAt: "2026-05-30T12:00:00.000Z", latencyMs: null, httpStatus: null, data: null, warning: "Gateway base URL is not configured." }),
    runGatewayRecallDebug: async () => ({ ok: false, endpoint: "/recall", checkedAt: "2026-05-30T12:00:00.000Z", latencyMs: null, httpStatus: null, data: null, warning: "Gateway base URL is not configured." }),
    runGatewayMemorySearchDebug: async () => ({ ok: false, endpoint: "/search/memories", checkedAt: "2026-05-30T12:00:00.000Z", latencyMs: null, httpStatus: null, data: null, warning: "Gateway base URL is not configured." }),
    runGatewayConversationSearchDebug: async () => ({ ok: false, endpoint: "/search/conversations", checkedAt: "2026-05-30T12:00:00.000Z", latencyMs: null, httpStatus: null, data: null, warning: "Gateway base URL is not configured." }),
  };
}

function createPage<T>(items: readonly T[]): DashboardPage<T> {
  return {
    items,
    total: items.length,
    offset: 0,
    limit: 25,
  };
}

function createMemorySnapshot(
  structuredMemoryWarningCode: "sqlite-metadata-reader-disabled" | "sqlite-metadata-read-error" = "sqlite-metadata-reader-disabled",
): DashboardSnapshot {
  const generatedAt = "2026-05-30T12:00:00.000Z";
  const structuredMemoriesDetail = `Parsed with warnings: ${structuredMemoryWarningCode}`;
  const warningMessage =
    structuredMemoryWarningCode === "sqlite-metadata-read-error"
      ? "SQLite metadata read failed; JSONL parser output was used."
      : "SQLite metadata reader is disabled; JSONL parser output was used.";

  return {
    snapshotId: `snapshot:${generatedAt}`,
    generatedAt,
    dataSource: {
      sourceLabel: "memory-fixture",
      memoryRootPath: "D:/fixtures/memory-fixture",
      profilesPath: "D:/fixtures/memory-fixture/profiles",
      scenesPath: "D:/fixtures/memory-fixture/scene_blocks",
      l1DatabasePath: "D:/fixtures/memory-fixture/records/memory-records.jsonl",
      l0DatabasePath: "D:/fixtures/memory-fixture/conversations/session-alpha.jsonl",
      offloadRootPath: "D:/fixtures/memory-fixture/offload",
      gatewayBaseUrl: null,
      gatewayApiKeyEnv: null,
      readOnly: true,
      environmentInputs: [],
    },
    capabilityReport: {
      generatedAt,
      persona: { status: "available", label: "Persona profile", detail: null, checkedAt: generatedAt, sourcePath: null, warningCodes: [] },
      scenes: { status: "available", label: "Scene blocks", detail: null, checkedAt: generatedAt, sourcePath: null, warningCodes: [] },
      structuredMemories: { status: "partial", label: "Structured L1 memories", detail: structuredMemoriesDetail, checkedAt: generatedAt, sourcePath: null, warningCodes: [structuredMemoryWarningCode] },
      conversationEvidence: { status: "available", label: "Conversation L0 evidence", detail: null, checkedAt: generatedAt, sourcePath: null, warningCodes: [] },
      offloadCanvas: { status: "available", label: "Offload canvas", detail: null, checkedAt: generatedAt, sourcePath: null, warningCodes: [] },
      gatewayHealth: { status: "disabled", label: "Gateway health", detail: "Gateway is not configured.", checkedAt: generatedAt, sourcePath: null, warningCodes: [] },
      gatewaySearch: { status: "disabled", label: "Gateway search", detail: "Gateway is not configured.", checkedAt: generatedAt, sourcePath: null, warningCodes: [] },
      gatewayRecall: { status: "disabled", label: "Gateway recall", detail: "Gateway is not configured.", checkedAt: generatedAt, sourcePath: null, warningCodes: [] },
    },
    persona: null,
    scenes: [],
    structuredMemories: [
      {
        recordId: "l1:memory:1",
        content: "Visualizer contracts stay app-local.",
        contentPreview: "Visualizer contracts stay app-local.",
        type: "constraint",
        priority: 9,
        sceneName: "Contract design",
        sessionKey: "session-alpha",
        sessionId: "session-alpha",
        sourceId: "l0:message:1",
        timestampLabel: "2026-05-30",
        timestampStart: generatedAt,
        timestampEnd: generatedAt,
        createdTime: generatedAt,
        updatedTime: generatedAt,
        score: 0.9,
        evidenceIds: ["l0:message:1"],
        rawMetadata: null,
      },
      {
        recordId: "l1:memory:3",
        content: "The user prefers deterministic fixtures with explicit IDs.",
        contentPreview: "The user prefers deterministic fixtures with explicit IDs.",
        type: "persona",
        priority: 85,
        sceneName: "Contract design",
        sessionKey: "session-alpha",
        sessionId: "session-alpha",
        sourceId: "l0:message:5",
        timestampLabel: "2026-05-30",
        timestampStart: generatedAt,
        timestampEnd: generatedAt,
        createdTime: generatedAt,
        updatedTime: generatedAt,
        score: 0.95,
        evidenceIds: ["l0:message:5"],
        rawMetadata: { recordHint: "line:3" },
      },
      {
        recordId: "l1:memory:4",
        content: "The user values read-only visual debugging surfaces over mutation controls.",
        contentPreview: "The user values read-only visual debugging surfaces over mutation controls.",
        type: "persona",
        priority: 92,
        sceneName: "Contract design",
        sessionKey: "session-alpha",
        sessionId: "session-alpha",
        sourceId: "l0:message:missing-404",
        timestampLabel: "2026-05-30",
        timestampStart: generatedAt,
        timestampEnd: generatedAt,
        createdTime: generatedAt,
        updatedTime: generatedAt,
        score: 0.97,
        evidenceIds: ["l0:message:missing-404"],
        rawMetadata: { recordHint: "line:4" },
      },
    ],
    conversationEvidence: [
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
      {
        recordId: "l0:message:5",
        sessionKey: "session-alpha",
        sessionId: "session-alpha",
        role: "user",
        snippet: "Remember that I want deterministic fixture IDs whenever we build memory views.",
        recordedAt: generatedAt,
        timestamp: Date.parse(generatedAt),
        score: 0.86,
        sourceMemoryIds: ["l1:memory:3"],
      },
    ],
    offloadCanvases: [
      {
        canvasId: "mmd:001",
        filename: "task.mmd",
        path: "D:/fixtures/memory-fixture/offload/task.mmd",
        taskGoal: "Map the dashboard shell",
        createdTime: generatedAt,
        updatedTime: generatedAt,
        doneCount: 1,
        doingCount: 0,
        todoCount: 1,
        nodes: [{ nodeId: "N1", label: "Route shell", status: "done", summary: "Added shell", timestamp: generatedAt }],
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
    warnings: [
      {
        source: "D:/fixtures/memory-fixture/vectors.db",
        code: structuredMemoryWarningCode,
        severity: "info",
        message: warningMessage,
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
