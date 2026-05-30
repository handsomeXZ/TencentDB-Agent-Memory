import { fileURLToPath } from "node:url";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { createDataSourceConfigFromRoot } from "../parsers";

import { LocalDashboardDataProvider, createAggregationSummary } from "./index";

const appRoot = fileURLToPath(new URL("../..", import.meta.url));
const fixturesRoot = path.join(appRoot, "fixtures");
const generatedAt = "2026-05-30T12:00:00.000Z";

function fixturePath(name: string): string {
  return path.join(fixturesRoot, name);
}

function warningCodes(warnings: readonly { readonly code: string }[]): readonly string[] {
  return warnings.map((warning) => warning.code);
}

function blockedRawFieldNames(): readonly string[] {
  return [
    ["embed", "ding"].join(""),
    ["vec", "tor"].join(""),
    ["l1", "_", "vec"].join(""),
    ["l0", "_", "vec"].join(""),
  ];
}

describe("LocalDashboardDataProvider", () => {
  it("aggregates complete-data-dir into a deterministic dashboard snapshot and helper summary", async () => {
    const provider = new LocalDashboardDataProvider();
    const snapshot = await provider.getSnapshot({
      dataDir: fixturePath("complete-data-dir"),
      generatedAt,
      snapshotId: "snapshot:test:complete",
    });
    const summary = createAggregationSummary(snapshot);

    expect(snapshot.snapshotId).toBe("snapshot:test:complete");
    expect(snapshot.generatedAt).toBe(generatedAt);
    expect(snapshot.persona?.profileId).toBe("profile:v1:fixture");
    expect(snapshot.scenes).toHaveLength(1);
    expect(snapshot.structuredMemories).toHaveLength(4);
    expect(snapshot.conversationEvidence).toHaveLength(6);
    expect(snapshot.offloadCanvases).toHaveLength(1);
    expect(summary.counts).toMatchObject({
      persona: 1,
      scenes: 1,
      structuredMemories: 4,
      conversationEvidence: 6,
      offloadCanvases: 1,
      offloadReferences: 1,
    });
    expect(summary.typeDistribution).toEqual([
      { label: "constraint", count: 2 },
      { label: "persona", count: 2 },
    ]);
    expect(summary.priorityDistribution).toEqual([
      { priority: 92, count: 1 },
      { priority: 85, count: 1 },
      { priority: 9, count: 1 },
      { priority: 8, count: 1 },
    ]);
    expect(summary.sceneHeatList[0]).toMatchObject({ sceneId: "scene:contracts", heatScore: 0.82 });
    expect(summary.evidenceLinkIndex[0]).toMatchObject({
      memoryRecordId: "l1:memory:1",
      evidenceIds: ["l0:message:1"],
      evidenceRecords: [expect.objectContaining({ recordId: "l0:message:1" })],
    });
    expect(summary.offloadCanvasSummaries[0]).toMatchObject({
      canvasId: "mmd:001",
      nodeCount: 2,
      referenceCount: 1,
      doneCount: 1,
      todoCount: 1,
    });
    expect(snapshot.capabilityReport.persona.status).toBe("available");
    expect(snapshot.capabilityReport.scenes.status).toBe("available");
    expect(snapshot.capabilityReport.structuredMemories.status).toBe("available");
    expect(snapshot.capabilityReport.conversationEvidence.status).toBe("available");
    expect(snapshot.capabilityReport.offloadCanvas.status).toBe("available");
    expect(snapshot.capabilityReport.gatewayHealth.status).toBe("disabled");
  });

  it("returns empty snapshot with warning capabilities when dataDir is missing", async () => {
    const provider = new LocalDashboardDataProvider({ now: () => new Date(generatedAt) });
    const snapshot = await provider.getSnapshot({ sourceLabel: "missing-fixture" });

    expect(snapshot.snapshotId).toBe(`snapshot:${generatedAt}`);
    expect(snapshot.persona).toBeNull();
    expect(snapshot.scenes).toEqual([]);
    expect(snapshot.structuredMemories).toEqual([]);
    expect(snapshot.conversationEvidence).toEqual([]);
    expect(snapshot.offloadCanvases).toEqual([]);
    expect(warningCodes(snapshot.warnings)).toContain("data-dir-missing");
    expect(snapshot.capabilityReport.persona.status).toBe("missing");
    expect(snapshot.capabilityReport.structuredMemories.status).toBe("missing");
    expect(snapshot.capabilityReport.conversationEvidence.status).toBe("missing");
    expect(snapshot.capabilityReport.gatewayHealth.status).toBe("disabled");
  });

  it("disables offload capability without emitting a global warning when offloadRoot is absent", async () => {
    const provider = new LocalDashboardDataProvider();
    const snapshot = await provider.getSnapshot({
      dataDir: fixturePath("missing-metadata"),
      generatedAt,
      snapshotId: "snapshot:test:no-offload",
    });

    expect(snapshot.persona?.available).toBe(true);
    expect(snapshot.offloadCanvases).toEqual([]);
    expect(snapshot.capabilityReport.offloadCanvas.status).toBe("disabled");
    expect(warningCodes(snapshot.warnings)).not.toContain("offload-root-disabled");
  });

  it("does not expose raw vector field names in serialized DashboardSnapshot", async () => {
    const provider = new LocalDashboardDataProvider();
    const snapshot = await provider.getSnapshot({
      dataDir: fixturePath("complete-data-dir"),
      generatedAt,
      snapshotId: "snapshot:test:safe-fields",
    });
    const serialized = JSON.stringify(snapshot);

    for (const fieldName of blockedRawFieldNames()) {
      expect(serialized).not.toContain(`"${fieldName}"`);
    }
  });

  it("paginates large-layer helpers with total, offset, and limit", async () => {
    const provider = new LocalDashboardDataProvider();
    const config = createDataSourceConfigFromRoot(fixturePath("complete-data-dir"));
    const memories = await provider.getStructuredMemoriesPage(config, { offset: 1, limit: 1 });
    const evidence = await provider.getConversationEvidencePage(config, { offset: 2, limit: 2 });
    const canvases = await provider.getOffloadCanvasesPage(config, { offset: 0, limit: 1 });
    const refs = await provider.getOffloadReferencesPage(config, { offset: 0, limit: 10 });
    const linkIndex = await provider.getEvidenceLinkIndex(config);

    expect(memories).toMatchObject({ total: 4, offset: 1, limit: 1 });
    expect(memories.items).toEqual([expect.objectContaining({ recordId: "l1:memory:2" })]);
    expect(evidence).toMatchObject({ total: 6, offset: 2, limit: 2 });
    expect(evidence.items).toHaveLength(2);
    expect(canvases).toMatchObject({ total: 1, offset: 0, limit: 1 });
    expect(refs).toMatchObject({ total: 1, offset: 0, limit: 10 });
    expect(linkIndex).toHaveLength(4);
  });

  it("resolves config from request path before environment and app-local defaults", () => {
    const envRoot = fixturePath("missing-persona");
    const appRootPath = fixturePath("empty-conversations");
    const requestRoot = fixturePath("complete-data-dir");
    const provider = new LocalDashboardDataProvider({
      appConfig: { dataDir: appRootPath },
      env: { TDAI_VIS_DATA_DIR: envRoot, MEMORY_VISUALIZER_DATA_DIR: fixturePath("corrupt-json") },
    });

    expect(provider.resolveConfig({ dataDir: requestRoot }).memoryRootPath).toBe(path.resolve(requestRoot));
    expect(provider.resolveConfig().memoryRootPath).toBe(path.resolve(envRoot));
  });

  it("maps plan-required TDAI_VIS env names into DataSourceConfig before fallback aliases", () => {
    const envRoot = fixturePath("missing-persona");
    const envOffloadRoot = path.join(fixturePath("complete-data-dir"), "offload", "agent-planner");
    const provider = new LocalDashboardDataProvider({
      appConfig: {
        dataDir: fixturePath("empty-conversations"),
        offloadRootPath: fixturePath("offload-missing-refs"),
        gatewayBaseUrl: "http://app-local-gateway.test",
        gatewayApiKeyEnv: "APP_LOCAL_GATEWAY_KEY",
      },
      env: {
        TDAI_VIS_DATA_DIR: envRoot,
        TDAI_VIS_OFFLOAD_ROOT: envOffloadRoot,
        TDAI_VIS_GATEWAY_URL: "http://tdai-vis-gateway.test",
        TDAI_VIS_GATEWAY_API_KEY: "fixture-key",
        MEMORY_VISUALIZER_DATA_DIR: fixturePath("corrupt-json"),
        MEMORY_VISUALIZER_OFFLOAD_ROOT: fixturePath("offload-invalid-mermaid"),
        MEMORY_VISUALIZER_GATEWAY_BASE_URL: "http://fallback-gateway.test",
        TDAI_GATEWAY_API_KEY: "fallback-key",
      },
    });
    const resolved = provider.resolveConfig();

    expect(resolved.memoryRootPath).toBe(path.resolve(envRoot));
    expect(resolved.offloadRootPath).toBe(path.resolve(envOffloadRoot));
    expect(resolved.gatewayBaseUrl).toBe("http://tdai-vis-gateway.test");
    expect(resolved.gatewayApiKeyEnv).toBe("TDAI_VIS_GATEWAY_API_KEY");
    expect(resolved.environmentInputs).toEqual([
      "TDAI_VIS_DATA_DIR",
      "TDAI_VIS_GATEWAY_API_KEY",
      "TDAI_VIS_GATEWAY_URL",
      "TDAI_VIS_OFFLOAD_ROOT",
    ]);
  });
});
