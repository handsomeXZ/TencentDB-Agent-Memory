import { describe, expect, it } from "vitest";

import {
  CAPABILITY_STATUS_VALUES,
  createCapabilityState,
  createDefaultDataSourceConfig,
  createDefaultGatewayStatus,
  createEmptyDashboardSnapshot,
} from "./dashboard";

import type {
  ConversationEvidence,
  DashboardDataProvider,
  DashboardSnapshot,
  OffloadCanvas,
  ParserWarning,
  PersonaSummary,
  SceneBlockSummary,
  StructuredMemorySummary,
} from "./dashboard";

describe("dashboard contracts", () => {
  it("covers every capability status used by degraded dashboard states", () => {
    expect(CAPABILITY_STATUS_VALUES).toEqual([
      "available",
      "missing",
      "partial",
      "error",
      "disabled",
    ]);

    const states = CAPABILITY_STATUS_VALUES.map((status) =>
      createCapabilityState(`status:${status}`, status, status === "error" ? "read failed" : null),
    );

    expect(states.map((state) => state.status)).toEqual(CAPABILITY_STATUS_VALUES);
    expect(states.find((state) => state.status === "error")?.detail).toBe("read failed");
  });

  it("constructs serializable empty defaults for read-only dashboard payloads", () => {
    const dataSource = createDefaultDataSourceConfig({
      sourceLabel: "fixture-root",
      memoryRootPath: "/readonly/memory",
      profilesPath: "/readonly/memory/profiles",
      scenesPath: "/readonly/memory/scenes",
      l1DatabasePath: "/readonly/memory/l1.sqlite",
      l0DatabasePath: "/readonly/memory/l0.sqlite",
      offloadRootPath: "/readonly/memory/offload",
      gatewayBaseUrl: "http://127.0.0.1:8420",
      gatewayApiKeyEnv: "TDAI_GATEWAY_API_KEY",
      environmentInputs: ["TDAI_GATEWAY_API_KEY", "MEMORY_TENCENTDB_HOME"],
    });
    const snapshot = createEmptyDashboardSnapshot("2026-05-30T00:00:00.000Z", dataSource);

    expect(snapshot.dataSource.readOnly).toBe(true);
    expect(snapshot.dataSource.environmentInputs).toEqual([
      "TDAI_GATEWAY_API_KEY",
      "MEMORY_TENCENTDB_HOME",
    ]);
    expect(snapshot.capabilityReport.gatewayHealth.status).toBe("disabled");
    expect(snapshot.gateway.baseUrl).toBe("http://127.0.0.1:8420");
    expect(snapshot.persona).toBeNull();
    expect(snapshot.scenes).toHaveLength(0);
    expect(JSON.parse(JSON.stringify(snapshot))).toMatchObject({
      snapshotId: "snapshot:2026-05-30T00:00:00.000Z",
      dataSource: { readOnly: true },
      warnings: [],
    });
  });

  it("supports representative persona, scene, memory, evidence, offload, and warning DTOs", async () => {
    const persona: PersonaSummary = {
      profileId: "profile:v1:abc",
      filename: "persona.md",
      available: true,
      title: "Coding preferences",
      contentSummary: "Prefers concise TypeScript contracts.",
      contentPreview: "Use readonly DTOs and app-local boundaries.",
      contentMd5: "0123456789abcdef",
      agentId: "openclaw",
      version: 3,
      createdAtMs: 1_700_000_000_000,
      updatedAtMs: 1_700_000_100_000,
      sourcePath: "/readonly/memory/profiles/persona.md",
      sceneIds: ["scene:contracts"],
      rawMetadata: { layer: "l3" },
    };
    const scene: SceneBlockSummary = {
      sceneId: "scene:contracts",
      filename: "contracts.md",
      title: "Contract design",
      contentSummary: "DTO decisions for the dashboard.",
      contentPreview: "Keep contracts stable and local.",
      heatScore: 0.82,
      memoryCount: 2,
      updatedAtMs: 1_700_000_200_000,
      sourcePath: "/readonly/memory/scenes/contracts.md",
      relatedPersonaIds: [persona.profileId],
      evidenceRecordIds: ["l1:memory:1"],
      rawMetadata: { layer: "l2" },
    };
    const memory: StructuredMemorySummary = {
      recordId: "l1:memory:1",
      content: "The visualizer contracts must not import root runtime types.",
      contentPreview: "Contracts must not import root runtime types.",
      type: "constraint",
      priority: 9,
      sceneName: "Contract design",
      sessionKey: "session-key",
      sessionId: "session-id",
      sourceId: "l0:message:1",
      timestampLabel: "2026-05-30",
      timestampStart: "2026-05-30T00:00:00.000Z",
      timestampEnd: "2026-05-30T00:10:00.000Z",
      createdTime: "2026-05-30T00:11:00.000Z",
      updatedTime: "2026-05-30T00:12:00.000Z",
      score: 0.91,
      evidenceIds: ["l0:message:1"],
      rawMetadata: { source: "l1" },
    };
    const evidence: ConversationEvidence = {
      recordId: "l0:message:1",
      sessionKey: "session-key",
      sessionId: "session-id",
      role: "user",
      snippet: "Define read-only dashboard contracts.",
      recordedAt: "2026-05-30T00:00:01.000Z",
      timestamp: 1_700_000_000_001,
      score: 0.77,
      sourceMemoryIds: [memory.recordId],
    };
    const offload: OffloadCanvas = {
      canvasId: "mmd:001",
      filename: "001-contracts.mmd",
      path: "/readonly/memory/offload/mmds/001-contracts.mmd",
      taskGoal: "Design dashboard contracts",
      createdTime: "2026-05-30T00:00:00.000Z",
      updatedTime: "2026-05-30T00:05:00.000Z",
      doneCount: 1,
      doingCount: 0,
      todoCount: 1,
      nodes: [
        {
          nodeId: "001-N1",
          label: "Define DTOs",
          status: "done",
          summary: "Created readonly dashboard contracts.",
          timestamp: "2026-05-30T00:03:00.000Z",
        },
      ],
      refs: [
        {
          toolCallId: "call-1",
          nodeId: "001-N1",
          toolCall: "read types",
          summary: "Mapped offload fields.",
          resultRef: "refs/call-1.md",
          timestamp: "2026-05-30T00:03:01.000Z",
          sessionKey: "session-key",
          score: 8,
        },
      ],
      rawMetadata: { doneCount: 1, todoCount: 1 },
    };
    const warning: ParserWarning = {
      source: "profiles/persona.md",
      code: "missing-title",
      severity: "warning",
      message: "Profile title was inferred from filename.",
      location: "line:1",
      rawValue: { filename: "persona.md" },
    };
    const snapshot: DashboardSnapshot = {
      ...createEmptyDashboardSnapshot("2026-05-30T00:00:00.000Z"),
      persona,
      scenes: [scene],
      structuredMemories: [memory],
      conversationEvidence: [evidence],
      offloadCanvases: [offload],
      gateway: createDefaultGatewayStatus("http://127.0.0.1:8420"),
      warnings: [warning],
    };
    const provider: DashboardDataProvider = {
      getSnapshot: async () => snapshot,
      getCapabilities: async () => snapshot.capabilityReport,
    };

    await expect(provider.getSnapshot(snapshot.dataSource)).resolves.toMatchObject({
      persona: { profileId: "profile:v1:abc" },
      scenes: [{ heatScore: 0.82 }],
      structuredMemories: [{ priority: 9, sourceId: "l0:message:1" }],
      conversationEvidence: [{ snippet: "Define read-only dashboard contracts." }],
      offloadCanvases: [{ nodes: [{ nodeId: "001-N1" }] }],
      warnings: [{ code: "missing-title" }],
    });
    await expect(provider.getCapabilities(snapshot.dataSource)).resolves.toBe(snapshot.capabilityReport);
    expect(JSON.stringify(snapshot)).toContain("Contract design");
  });
});
