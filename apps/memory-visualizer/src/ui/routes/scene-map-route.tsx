import type { DashboardSnapshot, SceneBlockSummary } from "../../contracts/dashboard";
import type { DashboardPage } from "../../providers";
import type { AsyncState } from "../dashboard-data";
import { EmptyState, ErrorState, LoadingState } from "../components";
import { SceneMapPanel } from "../persona-scene-panels";

export function SceneMapRoute({
  sceneState,
  snapshotState,
  selectedSceneId,
  getSceneHref,
  onSceneNavigate,
}: {
  readonly sceneState: AsyncState<DashboardPage<SceneBlockSummary>>;
  readonly snapshotState: AsyncState<DashboardSnapshot>;
  readonly selectedSceneId: string | null;
  readonly getSceneHref: (sceneId: string) => string;
  readonly onSceneNavigate: (sceneId: string) => void;
}) {
  if (sceneState.status === "loading" || snapshotState.status === "loading") {
    return <LoadingState title="正在加载 Scene 拓扑" detail="正在请求 Scene 索引条目和快照能力状态。" />;
  }

  if (sceneState.status === "error") {
    return <ErrorState title="Scene 拓扑不可用" detail={sceneState.error ?? "Scene 页面请求失败。"} />;
  }

  if (snapshotState.status === "error") {
    return <ErrorState title="快照不可用" detail={snapshotState.error ?? "快照请求失败。"} />;
  }

  if (!sceneState.data || !snapshotState.data) {
    return <EmptyState title="没有可用的 Scene Map" detail="这个数据源没有生成任何 Scene 块，但界面仍可继续使用。" />;
  }

  return <SceneMapPanel snapshot={snapshotState.data} scenes={sceneState.data.items} selectedSceneId={selectedSceneId} getSceneHref={getSceneHref} onSceneNavigate={onSceneNavigate} />;
}

