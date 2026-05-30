import type { DashboardSnapshot } from "../contracts/dashboard";

export interface UiSceneHeatItem {
  readonly sceneId: string;
  readonly title: string;
  readonly heatScore: number;
  readonly memoryCount: number;
}

export interface UiRecentUpdateItem {
  readonly id: string;
  readonly layer: "persona" | "scene" | "memory" | "conversation" | "offload";
  readonly label: string;
  readonly timestamp: string;
}

export interface UiDashboardSummary {
  readonly counts: {
    readonly persona: number;
    readonly scenes: number;
    readonly structuredMemories: number;
    readonly conversationEvidence: number;
    readonly warnings: number;
  };
  readonly sceneHeatList: readonly UiSceneHeatItem[];
  readonly recentUpdateTimeline: readonly UiRecentUpdateItem[];
}

export function createUiDashboardSummary(snapshot: DashboardSnapshot): UiDashboardSummary {
  return {
    counts: {
      persona: snapshot.persona ? 1 : 0,
      scenes: snapshot.scenes.length,
      structuredMemories: snapshot.structuredMemories.length,
      conversationEvidence: snapshot.conversationEvidence.length,
      warnings: snapshot.warnings.length,
    },
    sceneHeatList: snapshot.scenes
      .map((scene) => ({
        sceneId: scene.sceneId,
        title: scene.title,
        heatScore: scene.heatScore,
        memoryCount: scene.memoryCount,
      }))
      .sort((left, right) => right.heatScore - left.heatScore || left.sceneId.localeCompare(right.sceneId)),
    recentUpdateTimeline: createRecentUpdateTimeline(snapshot),
  };
}

function createRecentUpdateTimeline(snapshot: DashboardSnapshot): readonly UiRecentUpdateItem[] {
  const items: UiRecentUpdateItem[] = [];
  if (snapshot.persona?.updatedAtMs) {
    items.push({
      id: snapshot.persona.profileId,
      layer: "persona",
      label: snapshot.persona.title,
      timestamp: new Date(snapshot.persona.updatedAtMs).toISOString(),
    });
  }
  for (const scene of snapshot.scenes) {
    if (scene.updatedAtMs) items.push({ id: scene.sceneId, layer: "scene", label: scene.title, timestamp: new Date(scene.updatedAtMs).toISOString() });
  }
  for (const memory of snapshot.structuredMemories) {
    if (memory.updatedTime) items.push({ id: memory.recordId, layer: "memory", label: memory.contentPreview, timestamp: memory.updatedTime });
  }
  for (const evidence of snapshot.conversationEvidence) {
    if (evidence.recordedAt) items.push({ id: evidence.recordId, layer: "conversation", label: evidence.snippet, timestamp: evidence.recordedAt });
  }
  for (const canvas of snapshot.offloadCanvases) {
    if (canvas.updatedTime) items.push({ id: canvas.canvasId, layer: "offload", label: canvas.taskGoal, timestamp: canvas.updatedTime });
  }
  return items.sort((left, right) => timestampMs(right.timestamp) - timestampMs(left.timestamp) || left.id.localeCompare(right.id));
}

function timestampMs(timestamp: string): number {
  const value = Date.parse(timestamp);
  return Number.isNaN(value) ? 0 : value;
}
