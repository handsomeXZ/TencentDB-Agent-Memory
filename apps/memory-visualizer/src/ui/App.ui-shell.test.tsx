// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";

import type { DashboardSnapshot } from "../contracts/dashboard";
import type { DashboardApiClient, EvidenceLinkIndexEntry, OffloadResponse } from "./api-client";
import type { DashboardPage } from "../providers";

describe("ui-shell App", () => {
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

  it("renders ui-shell navigation and preserves the read-only banner after route changes", async () => {
    await renderApp(createClient(createSnapshot(), false));

    expect(textContent()).toContain("只读模式");
    expect(textContent()).toContain("总览");

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

  function textContent(): string {
    return container.textContent ?? "";
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

  return {
    getSnapshot: async () => snapshot,
    getScenes: async () => scenes,
    getMemories: async () => memories,
    getEvidence: async () => evidenceLinks,
    getConversations: async () => conversations,
    getOffload: async () => offload,
    getGatewayHealth: async () => ({ ok: false, endpoint: "/health", checkedAt: "2026-05-30T12:00:00.000Z", latencyMs: null, httpStatus: null, data: null, warning: "Gateway base URL is not configured." }),
    runGatewayRecallDebug: async () => ({ ok: false, endpoint: "/recall", checkedAt: "2026-05-30T12:00:00.000Z", latencyMs: null, httpStatus: null, data: null, warning: "Gateway base URL is not configured." }),
    runGatewayMemorySearchDebug: async () => ({ ok: false, endpoint: "/search/memories", checkedAt: "2026-05-30T12:00:00.000Z", latencyMs: null, httpStatus: null, data: null, warning: "Gateway base URL is not configured." }),
    runGatewayConversationSearchDebug: async () => ({ ok: false, endpoint: "/search/conversations", checkedAt: "2026-05-30T12:00:00.000Z", latencyMs: null, httpStatus: null, data: null, warning: "Gateway base URL is not configured." }),
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
