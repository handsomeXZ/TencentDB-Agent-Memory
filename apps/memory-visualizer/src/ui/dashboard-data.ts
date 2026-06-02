import { isDashboardAuthConfigurationError, isDashboardAuthError } from "./api-client";
import type { DashboardApiClient, EvidenceLinkIndexEntry, OffloadResponse, SourceQueryConfig } from "./api-client";
import type { ConversationEvidence, DashboardSnapshot, SceneBlockSummary, StructuredMemorySummary } from "../contracts/dashboard";
import type { DashboardPage } from "../providers";

export interface AsyncState<T> {
  readonly status: "loading" | "ready" | "error";
  readonly data: T | null;
  readonly error: string | null;
}

export interface LocationState {
  readonly path: string;
  readonly search: string;
}

export interface DashboardLoadState {
  readonly snapshotState: AsyncState<DashboardSnapshot>;
  readonly sceneState: AsyncState<DashboardPage<SceneBlockSummary>>;
  readonly memoryState: AsyncState<DashboardPage<StructuredMemorySummary>>;
  readonly evidenceState: AsyncState<DashboardPage<EvidenceLinkIndexEntry>>;
  readonly conversationState: AsyncState<DashboardPage<ConversationEvidence>>;
  readonly offloadState: AsyncState<OffloadResponse>;
}

export type AuthRequirement = "unknown" | "required" | "not-required";

export function readyState<T>(): AsyncState<T> {
  return { status: "ready", data: null, error: null };
}



export function loadingState<T>(): AsyncState<T> {
  return { status: "loading", data: null, error: null };
}



export function clearDashboardState(
  setSnapshotState: (value: AsyncState<DashboardSnapshot>) => void,
  setSceneState: (value: AsyncState<DashboardPage<SceneBlockSummary>>) => void,
  setMemoryState: (value: AsyncState<DashboardPage<StructuredMemorySummary>>) => void,
  setEvidenceState: (value: AsyncState<DashboardPage<EvidenceLinkIndexEntry>>) => void,
  setConversationState: (value: AsyncState<DashboardPage<ConversationEvidence>>) => void,
  setOffloadState: (value: AsyncState<OffloadResponse>) => void,
): void {
  setSnapshotState(readyState());
  setSceneState(readyState());
  setMemoryState(readyState());
  setEvidenceState(readyState());
  setConversationState(readyState());
  setOffloadState(readyState());
}



export async function requestDashboardData(client: DashboardApiClient, sourceQuery: SourceQueryConfig): Promise<DashboardLoadState | "unauthorized" | "auth-not-configured"> {
  const [snapshot, scenes, memories, evidence, conversations, offload] = await Promise.allSettled([
    client.getSnapshot(sourceQuery),
    client.getScenes(sourceQuery),
    client.getMemories(sourceQuery),
    client.getEvidence(sourceQuery),
    client.getConversations(sourceQuery),
    client.getOffload(sourceQuery),
  ]);

  const settledResults: readonly PromiseSettledResult<unknown>[] = [snapshot, scenes, memories, evidence, conversations, offload];
  if (settledResults.some((result) => isUnauthorizedResult(result))) {
    return "unauthorized";
  }
  if (settledResults.some((result) => isAuthConfigurationErrorResult(result))) {
    return "auth-not-configured";
  }

  return {
    snapshotState: toAsyncState(snapshot),
    sceneState: toAsyncState(scenes),
    memoryState: toAsyncState(memories),
    evidenceState: toAsyncState(evidence),
    conversationState: toAsyncState(conversations),
    offloadState: toAsyncState(offload),
  };
}



export function applyDashboardLoadResult(
  result: DashboardLoadState,
  setSnapshotState: (value: AsyncState<DashboardSnapshot>) => void,
  setSceneState: (value: AsyncState<DashboardPage<SceneBlockSummary>>) => void,
  setMemoryState: (value: AsyncState<DashboardPage<StructuredMemorySummary>>) => void,
  setEvidenceState: (value: AsyncState<DashboardPage<EvidenceLinkIndexEntry>>) => void,
  setConversationState: (value: AsyncState<DashboardPage<ConversationEvidence>>) => void,
  setOffloadState: (value: AsyncState<OffloadResponse>) => void,
): void {
  setSnapshotState(result.snapshotState);
  setSceneState(result.sceneState);
  setMemoryState(result.memoryState);
  setEvidenceState(result.evidenceState);
  setConversationState(result.conversationState);
  setOffloadState(result.offloadState);
}



function isUnauthorizedResult<T>(result: PromiseSettledResult<T>): boolean {
  return result.status === "rejected" && isDashboardAuthError(result.reason);
}



function isAuthConfigurationErrorResult<T>(result: PromiseSettledResult<T>): boolean {
  return result.status === "rejected" && isDashboardAuthConfigurationError(result.reason);
}



function toAsyncState<T>(result: PromiseSettledResult<T>): AsyncState<T> {
  if (result.status === "fulfilled") return { status: "ready", data: result.value, error: null };
  return {
    status: "error",
    data: null,
    error: result.reason instanceof Error ? result.reason.message : String(result.reason),
  };
}

