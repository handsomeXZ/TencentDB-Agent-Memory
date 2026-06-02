import type { DashboardSnapshot } from "../../contracts/dashboard";
import type { AsyncState } from "../dashboard-data";
import { createUiDashboardSummary } from "../dashboard-summary";
import { EmptyState, ErrorState, LoadingState, WarningState } from "../components";
import { PersonaSummaryPanel, RecentSceneUpdatesPanel } from "../persona-scene-panels";
import { hasDegradedCapabilities, summarizeWarnings } from "../status-model";
import type { ShellStatusModel } from "../status-model";
import { CapabilityCard, translateSeverity } from "./shared";

export function OverviewRoute({
  snapshotState,
  statusModel,
  selectedSceneId,
  getSceneHref,
  onSceneNavigate,
}: {
  readonly snapshotState: AsyncState<DashboardSnapshot>;
  readonly statusModel: ShellStatusModel | null;
  readonly selectedSceneId: string | null;
  readonly getSceneHref: (sceneId: string) => string;
  readonly onSceneNavigate: (sceneId: string) => void;
}) {
  if (snapshotState.status === "loading") {
    return <LoadingState title="正在加载仪表盘快照" detail="正在从应用内本地 API 收集只读界面状态。" />;
  }

  if (snapshotState.status === "error") {
    return <ErrorState title="快照不可用" detail={snapshotState.error ?? "快照请求失败。"} />;
  }

  const snapshot = snapshotState.data;
  if (!snapshot || !statusModel) {
    return <EmptyState title="未返回快照" detail="API 没有返回界面快照数据。" />;
  }

  const summary = createUiDashboardSummary(snapshot);
  const topScene = summary.sceneHeatList[0] ?? null;
  const recentSceneUpdates = summary.recentUpdateTimeline.filter((item) => item.layer === "scene");
  const metricCards = [
    {
      label: "Persona 可用性",
      value: snapshot.capabilityReport.persona.status,
      detail: snapshot.persona?.title ?? snapshot.capabilityReport.persona.detail ?? "未解析到 Persona 摘要。",
    },
    { label: "Scene 数量", value: String(summary.counts.scenes), detail: topScene?.title ?? "没有可用的 Scene 块。" },
    {
      label: "最高 Scene 热度",
      value: topScene ? topScene.heatScore.toFixed(2) : "0.00",
      detail: topScene ? `${topScene.title} · ${topScene.memoryCount} 条 Memory` : "没有按热度排序的 Scene。",
    },
    {
      label: "最近 Scene 更新",
      value: String(recentSceneUpdates.length),
      detail: recentSceneUpdates[0] ? recentSceneUpdates[0].label : "未解析到 Scene 更新时间。",
    },
    {
      label: "解析告警",
      value: String(summary.counts.warnings),
      detail: snapshot.warnings[0]?.code ?? "未记录解析告警。",
    },
  ];

  return (
    <div className="route-grid">
      <section className="shell-panel">
        <h3 className="section-title">读取源健康概览</h3>
        <p className="route-copy">
          数据源 <strong>{statusModel.sourceLabel}</strong> 的快照生成于 <span className="mono">{statusModel.generatedAt}</span>。
        </p>
        {hasDegradedCapabilities(snapshot.capabilityReport) ? (
          <WarningState title="检测到能力降级" detail={summarizeWarnings(snapshot.warnings)} />
        ) : null}
        <div className="metric-grid">
          {metricCards.map((card) => (
            <article key={card.label} className="metric-card">
              <div className="meta-label">{card.label}</div>
              <div className="metric-value">{card.value}</div>
              <div className="metric-subtle">{card.detail}</div>
            </article>
          ))}
        </div>
      </section>
      <section className="shell-panel">
        <h3 className="section-title">能力状态</h3>
        <div className="capability-grid">
          {statusModel.capabilityEntries.map((entry) => (
            <CapabilityCard key={entry.key} label={entry.state.label} detail={entry.state.detail} status={entry.state.status} sourcePath={entry.state.sourcePath} />
          ))}
        </div>
      </section>
      <PersonaSummaryPanel snapshot={snapshot} getSceneHref={getSceneHref} onSceneNavigate={onSceneNavigate} />
      <RecentSceneUpdatesPanel snapshot={snapshot} getSceneHref={getSceneHref} onSceneNavigate={onSceneNavigate} />
      <section className="shell-panel">
        <h3 className="section-title">告警</h3>
        {snapshot.warnings.length === 0 ? (
            <EmptyState title="未记录告警" detail="这个数据源在 parser/provider 边界返回了完整可用的快照。" />
        ) : (
          <div className="warning-list">
            {snapshot.warnings.map((warning) => (
              <article key={`${warning.code}:${warning.source}`} className="state-card" data-tone={warning.severity === "error" ? "error" : "warning"}>
                <div className="state-header">
                  <div>
                    <div className="meta-label">{translateSeverity(warning.severity)}</div>
                    <strong>{warning.code}</strong>
                  </div>
                  <span className="mono">{warning.location ?? warning.source ?? "provider"}</span>
                </div>
                <div className="state-copy">{warning.message}</div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

