import type { ConversationEvidence, DashboardSnapshot, SceneBlockSummary, StructuredMemorySummary } from "../../contracts/dashboard";
import type { DashboardPage } from "../../providers";
import type { DashboardApiClient, EvidenceLinkIndexEntry, OffloadResponse, SourceQueryConfig } from "../api-client";
import type { AsyncState } from "../dashboard-data";
import { EvidenceRoute, MemoryExplorerRoute } from "../memory-evidence-panels";
import { ROUTES, resolveRoute } from "../route-registry";
import type { RouteDefinition, RouteId } from "../app-types";
import type { ShellStatusModel } from "../status-model";
import { DebugRoute } from "./debug-route";
import { OffloadRoute } from "./offload-route";
import { OverviewRoute } from "./overview-route";
import { RequestsMonitorRoute } from "./requests-monitor-route";
import { SceneMapRoute } from "./scene-map-route";
import { SettingsRoute } from "./settings-route";

export { ROUTES, resolveRoute };
export type { RouteDefinition };

export interface RouteRenderModel {
  readonly snapshotState: AsyncState<DashboardSnapshot>;
  readonly sceneState: AsyncState<DashboardPage<SceneBlockSummary>>;
  readonly memoryState: AsyncState<DashboardPage<StructuredMemorySummary>>;
  readonly evidenceState: AsyncState<DashboardPage<EvidenceLinkIndexEntry>>;
  readonly conversationState: AsyncState<DashboardPage<ConversationEvidence>>;
  readonly offloadState: AsyncState<OffloadResponse>;
  readonly statusModel: ShellStatusModel | null;
  readonly selectedSceneId: string | null;
  readonly selectedMemoryId: string | null;
  readonly client: DashboardApiClient;
  readonly sourceQuery: SourceQueryConfig;
  readonly formState: SourceQueryConfig;
  readonly onFormStateChange: (value: SourceQueryConfig) => void;
  readonly onApplySourceSelection: (value: SourceQueryConfig) => void;
  readonly onResetSourceSelection: () => void;
  readonly getSceneHref: (sceneId: string) => string;
  readonly onSceneNavigate: (sceneId: string) => void;
  readonly onMemoryNavigate: (memoryId: string) => void;
}

export function renderRoute(routeId: RouteId, model: RouteRenderModel) {
  switch (routeId) {
    case "overview": return <OverviewRoute {...model} />;
    case "requests-monitor": return <RequestsMonitorRoute client={model.client} sourceQuery={model.sourceQuery} snapshotState={model.snapshotState} />;
    case "scene-map": return <SceneMapRoute {...model} />;
    case "memory-explorer": return <MemoryExplorerRoute client={model.client} sourceQuery={model.sourceQuery} snapshotState={model.snapshotState} initialMemoryState={model.memoryState} selectedMemoryId={model.selectedMemoryId} onMemoryNavigate={model.onMemoryNavigate} />;
    case "evidence": return <EvidenceRoute client={model.client} sourceQuery={model.sourceQuery} snapshotState={model.snapshotState} initialMemoryState={model.memoryState} initialEvidenceState={model.evidenceState} initialConversationState={model.conversationState} selectedMemoryId={model.selectedMemoryId} onMemoryNavigate={model.onMemoryNavigate} />;
    case "offload": return <OffloadRoute offloadState={model.offloadState} snapshotState={model.snapshotState} />;
    case "debug": return <DebugRoute client={model.client} sourceQuery={model.sourceQuery} snapshotState={model.snapshotState} />;
    case "settings": return <SettingsRoute {...model} />;
    default: return <OverviewRoute {...model} />;
  }
}
