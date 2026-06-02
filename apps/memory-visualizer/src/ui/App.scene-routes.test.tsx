// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";

import type { DashboardSnapshot, SceneBlockSummary } from "../contracts/dashboard";
import type { DashboardPage } from "../providers";
import type { DashboardApiClient, EvidenceLinkIndexEntry, OffloadResponse } from "./api-client";
import type { RequestTelemetryPage, RequestTelemetrySummary } from "../../../../src/telemetry/request-telemetry.js";

describe("scene routes", () => {
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

  it("shows scene overview metrics, persona summary, and heat-sorted scene cards", async () => {
    await renderApp(createClient(createSceneSnapshot()));

    expect(textContent()).toContain("Persona 可用性");
    expect(textContent()).toContain("最高 Scene 热度");
    expect(textContent()).toContain("Persona 面板");
    expect(textContent()).toContain("Prefers concise TypeScript contracts");

    await clickNav("场景图谱 Scene Map");
    expect(textContent()).toContain("Scene 聚焦");
    expect(textContent()).toContain("查看 Scene 详情");

    const headings = [...container.querySelectorAll(".scene-card .table-heading")].map((element) => element.textContent?.trim());
    expect(headings[0]).toBe("Contract design");
    expect(headings[1]).toBe("Fixture stability");

    const focusLink = [...container.querySelectorAll(".scene-card .scene-link")][1];
    if (!(focusLink instanceof HTMLAnchorElement)) throw new Error("Expected scene navigation link.");

    await act(async () => {
      focusLink.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    await flush();

    expect(window.location.pathname).toBe("/scene-map");
    expect(window.location.search).toContain("sceneId=scene%3Afixtures");
    expect(textContent()).toContain("Fixture stability");
  });

  it("keeps the scene map available when persona is missing", async () => {
    await renderApp(createClient(createSceneSnapshot({ missingPersona: true })));

    expect(textContent()).toContain("Persona 文件不可用");

    await clickNav("场景图谱 Scene Map");
    expect(textContent()).toContain("Persona omitted");
    expect(textContent()).toContain("关联 Persona 状态");
  });

  it("shows an empty scene state with warning details instead of crashing", async () => {
    await renderApp(createClient(createSceneSnapshot({ emptyScenes: true })));

    await clickNav("场景图谱 Scene Map");
    expect(textContent()).toContain("Scene Map 告警信息");
    expect(textContent()).toContain("没有可用的 Scene Map");
    expect(textContent()).toContain("未解析到数据。");
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

function createClient(snapshot: DashboardSnapshot): DashboardApiClient {
  const scenes: DashboardPage<DashboardSnapshot["scenes"][number]> = {
    items: snapshot.scenes,
    total: snapshot.scenes.length,
    offset: 0,
    limit: 50,
  };
  const memories: DashboardPage<DashboardSnapshot["structuredMemories"][number]> = {
    items: snapshot.structuredMemories,
    total: snapshot.structuredMemories.length,
    offset: 0,
    limit: 50,
  };
  const evidenceLinks: DashboardPage<EvidenceLinkIndexEntry> = {
    items: snapshot.structuredMemories.map((memory) => ({
      memoryRecordId: memory.recordId,
      evidenceIds: memory.evidenceIds,
      evidenceRecords: snapshot.conversationEvidence.filter((record) => memory.evidenceIds.includes(record.recordId)),
    })),
    total: snapshot.structuredMemories.length,
    offset: 0,
    limit: 50,
  };
  const conversations: DashboardPage<DashboardSnapshot["conversationEvidence"][number]> = {
    items: snapshot.conversationEvidence,
    total: snapshot.conversationEvidence.length,
    offset: 0,
    limit: 50,
  };
  const offload: OffloadResponse = {
    canvases: {
      items: snapshot.offloadCanvases,
      total: snapshot.offloadCanvases.length,
      offset: 0,
      limit: 50,
    },
    references: {
      items: snapshot.offloadCanvases.flatMap((canvas) => canvas.refs),
      total: snapshot.offloadCanvases.flatMap((canvas) => canvas.refs).length,
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
    getRequests: async () => createEmptyRequestPage(),
    getRequestsSummary: async () => createEmptyRequestSummary(),
    getGatewayHealth: async () => ({ ok: false, endpoint: "/health", checkedAt: "2026-05-30T12:00:00.000Z", latencyMs: null, httpStatus: null, data: null, warning: "Gateway base URL is not configured." }),
    runGatewayRecallDebug: async () => ({ ok: false, endpoint: "/recall", checkedAt: "2026-05-30T12:00:00.000Z", latencyMs: null, httpStatus: null, data: null, warning: "Gateway base URL is not configured." }),
    runGatewayMemorySearchDebug: async () => ({ ok: false, endpoint: "/search/memories", checkedAt: "2026-05-30T12:00:00.000Z", latencyMs: null, httpStatus: null, data: null, warning: "Gateway base URL is not configured." }),
    runGatewayConversationSearchDebug: async () => ({ ok: false, endpoint: "/search/conversations", checkedAt: "2026-05-30T12:00:00.000Z", latencyMs: null, httpStatus: null, data: null, warning: "Gateway base URL is not configured." }),
  };
}

function createSceneSnapshot(options: { readonly missingPersona?: boolean; readonly emptyScenes?: boolean } = {}): DashboardSnapshot {
  const generatedAt = "2026-05-30T12:00:00.000Z";
  const missingPersona = options.missingPersona ?? false;
  const emptyScenes = options.emptyScenes ?? false;
  const scenes = emptyScenes ? [] : createScenes(missingPersona);

  return {
    snapshotId: `snapshot:${generatedAt}`,
    generatedAt,
    dataSource: {
      sourceLabel: missingPersona ? "missing-persona" : emptyScenes ? "empty-scenes" : "complete-data-dir",
      memoryRootPath: "D:/fixtures/current",
      profilesPath: "D:/fixtures/current/profiles",
      scenesPath: "D:/fixtures/current/scene_blocks",
      l1DatabasePath: "D:/fixtures/current/records/memory-records.jsonl",
      l0DatabasePath: "D:/fixtures/current/conversations/conversations.jsonl",
      offloadRootPath: "D:/fixtures/current/offload",
      gatewayBaseUrl: null,
      gatewayApiKeyEnv: null,
      readOnly: true,
      environmentInputs: [],
    },
    capabilityReport: {
      generatedAt,
      persona: {
        status: missingPersona ? "missing" : "available",
        label: "Persona profile",
        detail: missingPersona ? "Persona file was not found." : null,
        checkedAt: generatedAt,
        sourcePath: missingPersona ? null : "D:/fixtures/current/profiles/persona.md",
        warningCodes: missingPersona ? ["persona-missing"] : [],
      },
      scenes: {
        status: emptyScenes ? "missing" : "available",
        label: "Scene blocks",
        detail: emptyScenes ? "No data was parsed." : null,
        checkedAt: generatedAt,
        sourcePath: "D:/fixtures/current/scene_blocks",
        warningCodes: emptyScenes ? ["scene-empty"] : [],
      },
      structuredMemories: { status: "available", label: "Structured L1 memories", detail: null, checkedAt: generatedAt, sourcePath: null, warningCodes: [] },
      conversationEvidence: { status: "available", label: "Conversation L0 evidence", detail: null, checkedAt: generatedAt, sourcePath: null, warningCodes: [] },
      offloadCanvas: { status: "available", label: "Offload canvas", detail: null, checkedAt: generatedAt, sourcePath: null, warningCodes: [] },
      gatewayHealth: { status: "disabled", label: "Gateway health", detail: "Gateway is not configured.", checkedAt: generatedAt, sourcePath: null, warningCodes: [] },
      gatewaySearch: { status: "disabled", label: "Gateway search", detail: "Gateway is not configured.", checkedAt: generatedAt, sourcePath: null, warningCodes: [] },
      gatewayRecall: { status: "disabled", label: "Gateway recall", detail: "Gateway is not configured.", checkedAt: generatedAt, sourcePath: null, warningCodes: [] },
    },
    persona: missingPersona
      ? null
      : {
          profileId: "profile:v1:fixture",
          filename: "persona.md",
          available: true,
          title: "Coding preferences",
          contentSummary: "Prefers concise TypeScript contracts.",
          contentPreview: "Prefers concise TypeScript contracts, stable IDs, and app-local read-only boundaries.",
          contentMd5: "abc123",
          agentId: "fixture-agent",
          version: 1,
          createdAtMs: Date.parse("2026-05-30T00:00:00.000Z"),
          updatedAtMs: Date.parse("2026-05-30T00:06:00.000Z"),
          sourcePath: "D:/fixtures/current/profiles/persona.md",
          sceneIds: ["scene:contracts", "scene:fixtures"],
          rawMetadata: null,
        },
    scenes,
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
        score: 0.91,
        evidenceIds: ["l0:message:1"],
        rawMetadata: null,
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
        score: 0.82,
        sourceMemoryIds: ["l1:memory:1"],
      },
    ],
    offloadCanvases: [
      {
        canvasId: "mmd:001",
        filename: "task.mmd",
        path: "D:/fixtures/current/offload/task.mmd",
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
    warnings: emptyScenes
      ? [{ source: "D:/fixtures/current/scene_blocks", code: "scene-empty", severity: "warning", message: "Scene index is empty.", location: null, rawValue: null }]
      : [{ source: "D:/fixtures/current/scene_blocks/contracts.md", code: "scene-metadata-missing", severity: "warning", message: "Scene metadata was incomplete.", location: null, rawValue: null }],
  };
}

function createScenes(missingPersona = false): readonly SceneBlockSummary[] {
  if (missingPersona) {
    return [
      {
        sceneId: "scene:no-persona",
        filename: "no-persona.md",
        title: "Persona omitted",
        contentSummary: "Scene data still renders without a persona file.",
        contentPreview: "Scene Map remains readable when persona parsing fails.",
        heatScore: 0.56,
        memoryCount: 0,
        updatedAtMs: Date.parse("2026-05-30T00:02:00.000Z"),
        sourcePath: "D:/fixtures/current/scene_blocks/no-persona.md",
        relatedPersonaIds: [],
        evidenceRecordIds: [],
        rawMetadata: null,
      },
    ];
  }

  return [
    {
      sceneId: "scene:fixtures",
      filename: "fixtures.md",
      title: "Fixture stability",
      contentSummary: "Stable fixture IDs help later tasks stay deterministic.",
      contentPreview: "Keep synthetic scene references deterministic across tests.",
      heatScore: 0.41,
      memoryCount: 1,
      updatedAtMs: Date.parse("2026-05-30T00:03:00.000Z"),
      sourcePath: "D:/fixtures/current/scene_blocks/fixtures.md",
      relatedPersonaIds: ["profile:v1:fixture"],
      evidenceRecordIds: ["l0:message:2"],
      rawMetadata: null,
    },
    {
      sceneId: "scene:contracts",
      filename: "contracts.md",
      title: "Contract design",
      contentSummary: "Summarized contract constraints.",
      contentPreview: "A compact scene preview for contract design.",
      heatScore: 0.91,
      memoryCount: 2,
      updatedAtMs: Date.parse("2026-05-30T00:05:00.000Z"),
      sourcePath: "D:/fixtures/current/scene_blocks/contracts.md",
      relatedPersonaIds: ["profile:v1:fixture"],
      evidenceRecordIds: ["l0:message:1", "l0:message:3"],
      rawMetadata: null,
    },
  ];
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

async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}
