import type { MouseEvent as ReactMouseEvent } from "react";

import { MetaPair, StateCard, StatusBadge } from "./components";
import { createUiDashboardSummary } from "./dashboard-summary";

import type { DashboardSnapshot, ParserWarning, SceneBlockSummary } from "../contracts/dashboard";

interface SceneNavigationProps {
  readonly getSceneHref: (sceneId: string) => string;
  readonly onSceneNavigate: (sceneId: string) => void;
}

export function PersonaSummaryPanel(
  props: {
    readonly snapshot: DashboardSnapshot;
  } & SceneNavigationProps,
) {
  const { snapshot, getSceneHref, onSceneNavigate } = props;
  const persona = snapshot.persona;
  const scenesById = new Map(snapshot.scenes.map((scene) => [scene.sceneId, scene]));

  return (
    <section className="shell-panel">
      <h3 className="section-title">Persona 面板</h3>
      {persona ? (
        <div className="scene-panel-stack">
          <article className="table-card">
            <div className="table-row">
              <div>
                <div className="table-label">Persona 摘要</div>
                <h3 className="table-heading">{persona.title}</h3>
              </div>
              <StatusBadge status="available">{formatCapabilityStatus("available")}</StatusBadge>
            </div>
            <div className="table-copy">{persona.contentSummary}</div>
            <div className="scene-preview">{persona.contentPreview}</div>
            <div className="summary-list">
              <MetaPair label="Agent 标识" value={persona.agentId ?? "未记录"} />
              <MetaPair label="版本" value={persona.version} />
              <MetaPair label="更新时间" value={formatTimestamp(persona.updatedAtMs)} mono />
              <MetaPair label="源提示" value={persona.filename} mono />
            </div>
          </article>
          <article className="table-card">
            <div className="table-row">
              <div>
                <div className="table-label">Scene 导航</div>
                <h3 className="table-heading">关联 Persona 的 Scene</h3>
              </div>
              <span>{persona.sceneIds.length} 个关联</span>
            </div>
            {persona.sceneIds.length === 0 ? (
              <StateCard tone="empty" detail="这个 Persona 摘要没有引用任何 Scene ID。" />
            ) : (
              <div className="scene-link-list">
                {persona.sceneIds.map((sceneId) => {
                  const scene = scenesById.get(sceneId);
                  return (
                    <a
                      key={sceneId}
                      className="scene-link"
                      href={getSceneHref(sceneId)}
                      onClick={(event) => handleSceneClick(event, sceneId, onSceneNavigate)}
                    >
                      <span className="nav-title">{scene?.title ?? sceneId}</span>
                      <span className="route-copy">{scene?.contentSummary ?? "打开 Scene Map 并聚焦这个 Scene。"}</span>
                    </a>
                  );
                })}
              </div>
            )}
          </article>
        </div>
      ) : (
        <StateCard tone="warning" label="Persona 缺失" title="Persona 文件不可用" detail={localizeDetail(snapshot.capabilityReport.persona.detail) ?? "当前数据源不包含 Persona 摘要。"} />
      )}
    </section>
  );
}

export function RecentSceneUpdatesPanel(
  props: {
    readonly snapshot: DashboardSnapshot;
  } & SceneNavigationProps,
) {
  const { snapshot, getSceneHref, onSceneNavigate } = props;
  const summary = createUiDashboardSummary(snapshot);
  const items = summary.recentUpdateTimeline.filter((item) => item.layer === "scene").slice(0, 4);

  return (
    <section className="shell-panel">
      <div className="table-row">
        <div>
          <div className="table-label">最近 Scene 更新</div>
          <h3 className="table-heading">最新 Scene 活动</h3>
        </div>
        <span>{items.length} 条可见</span>
      </div>
      {items.length === 0 ? (
        <StateCard tone="empty" detail="当前数据源没有可用的 Scene 更新时间。" />
      ) : (
        <div className="scene-panel-stack">
          {items.map((item) => (
            <a
              key={item.id}
              className="scene-link"
              href={getSceneHref(item.id)}
              onClick={(event) => handleSceneClick(event, item.id, onSceneNavigate)}
            >
              <span className="nav-title">{item.label}</span>
              <span className="route-copy">更新于 {formatIsoText(item.timestamp)}</span>
            </a>
          ))}
        </div>
      )}
    </section>
  );
}

export function SceneMapPanel(
  props: {
    readonly snapshot: DashboardSnapshot;
    readonly scenes: readonly SceneBlockSummary[];
    readonly selectedSceneId: string | null;
  } & SceneNavigationProps,
) {
  const { snapshot, scenes, selectedSceneId, getSceneHref, onSceneNavigate } = props;
  const orderedScenes = [...scenes].sort((left, right) => right.heatScore - left.heatScore || left.sceneId.localeCompare(right.sceneId));
  const selectedScene = orderedScenes.find((scene) => scene.sceneId === selectedSceneId) ?? orderedScenes[0] ?? null;
  const sceneWarnings = filterSceneWarnings(snapshot.warnings);
  const sceneCapability = snapshot.capabilityReport.scenes;

  if (orderedScenes.length === 0) {
    return (
      <div className="route-grid">
        <section className="shell-panel">
          <h3 className="section-title">Scene Map 告警信息</h3>
          <StateCard tone="warning" label="Scene 能力" title={formatCapabilityStatus(sceneCapability.status)} detail={localizeDetail(sceneCapability.detail) ?? "当前数据源没有 Scene Map 条目。"} />
        </section>
        <section className="shell-panel">
          <h3 className="section-title">Scene 拓扑</h3>
          <StateCard tone="empty" label="空状态" title="没有可用的 Scene Map" detail="这个数据源没有生成任何 Scene 块，但界面仍可继续使用。" />
        </section>
      </div>
    );
  }

  return (
    <div className="route-grid scene-route-layout">
      <section className="shell-panel">
        <div className="table-row">
          <div>
            <div className="table-label">Scene 聚焦</div>
            <h3 className="table-heading">{selectedScene?.title ?? "Scene 详情"}</h3>
          </div>
          {selectedScene ? <StatusBadge status={heatStatus(selectedScene.heatScore)}>{`热度 ${selectedScene.heatScore.toFixed(2)}`}</StatusBadge> : null}
        </div>
        {selectedScene ? (
          <div className="scene-panel-stack">
            <div className="table-copy">{selectedScene.contentSummary}</div>
            <div className="scene-preview">{selectedScene.contentPreview}</div>
            <div className="detail-grid">
              <MetaPair label="更新时间" value={formatTimestamp(selectedScene.updatedAtMs)} mono variant="metric" />
              <MetaPair label="Memory 数量" value={selectedScene.memoryCount} variant="metric" />
              <MetaPair label="Evidence 引用" value={selectedScene.evidenceRecordIds.length} variant="metric" />
              <MetaPair label="源提示" value={selectedScene.filename} mono variant="metric" />
            </div>
            <div className="summary-list">
              <MetaPair label="Scene ID" value={selectedScene.sceneId} mono />
              <MetaPair label="路径提示" value={selectedScene.sourcePath} mono />
              <MetaPair label="关联 Persona" value={selectedScene.relatedPersonaIds.length} />
            </div>
          </div>
        ) : null}
      </section>
      <section className="shell-panel">
        <div className="table-row">
          <div>
            <div className="table-label">按热度排序的 Scene 索引</div>
            <h3 className="table-heading">Scene 卡片</h3>
          </div>
          <span>{orderedScenes.length} 条总计</span>
        </div>
        {sceneWarnings.length > 0 ? (
          <StateCard tone="warning" label="解析告警" title={sceneWarnings[0]?.code} detail={sceneWarnings.map((warning) => `${warning.code}: ${warning.message}`).join(" ")} />
        ) : null}
        <div className="scene-panel-stack">
          {orderedScenes.map((scene) => {
            const selected = scene.sceneId === selectedScene?.sceneId;
            return (
              <article key={scene.sceneId} className="table-card scene-card" data-active={selected ? "true" : "false"}>
                <div className="table-row">
                  <div>
                    <div className="table-label">Scene</div>
                    <h3 className="table-heading">{scene.title}</h3>
                  </div>
                  <StatusBadge status={heatStatus(scene.heatScore)}>{`热度 ${scene.heatScore.toFixed(2)}`}</StatusBadge>
                </div>
                <div className="table-copy">{scene.contentSummary}</div>
                <div className="scene-preview">{scene.contentPreview}</div>
                <div className="summary-list">
                  <MetaPair label="更新时间" value={formatTimestamp(scene.updatedAtMs)} mono />
                  <MetaPair label="Memory 数量" value={scene.memoryCount} />
                  <MetaPair label="Evidence 提示" value={scene.evidenceRecordIds.length} />
                  <MetaPair label="源提示" value={scene.filename} mono />
                </div>
                <a
                  className="scene-link"
                  href={getSceneHref(scene.sceneId)}
                  onClick={(event) => handleSceneClick(event, scene.sceneId, onSceneNavigate)}
                >
                     <span className="nav-title">查看 Scene 详情</span>
                     <span className="route-copy">打开这个按热度排序的 Scene 聚焦面板。</span>
                </a>
              </article>
            );
          })}
        </div>
      </section>
      <section className="shell-panel">
        <div className="table-row">
          <div>
            <div className="table-label">Persona 覆盖情况</div>
            <h3 className="table-heading">关联 Persona 状态</h3>
          </div>
          <StatusBadge status={snapshot.capabilityReport.persona.status}>{formatCapabilityStatus(snapshot.capabilityReport.persona.status)}</StatusBadge>
        </div>
        <div className="table-copy">
          {snapshot.persona
            ? `${snapshot.persona.title} 引用了 ${snapshot.persona.sceneIds.length} 个 Scene 关联。`
            : localizeDetail(snapshot.capabilityReport.persona.detail) ?? "即使没有解析到 Persona 文件，Scene Map 仍然可用。"}
        </div>
      </section>
    </div>
  );
}

function filterSceneWarnings(warnings: readonly ParserWarning[]): readonly ParserWarning[] {
  return warnings.filter((warning) => warning.code.startsWith("scene") || warning.source.includes("scene_blocks"));
}

function heatStatus(heatScore: number): DashboardSnapshot["capabilityReport"]["persona"]["status"] {
  if (heatScore >= 0.75) return "available";
  if (heatScore >= 0.4) return "partial";
  return "missing";
}

function handleSceneClick(event: ReactMouseEvent<HTMLAnchorElement>, sceneId: string, onSceneNavigate: (sceneId: string) => void): void {
  event.preventDefault();
  onSceneNavigate(sceneId);
}

function formatTimestamp(timestampMs: number | null): string {
  if (!timestampMs) return "未记录";
  return formatIsoText(new Date(timestampMs).toISOString());
}

function formatCapabilityStatus(status: DashboardSnapshot["capabilityReport"]["persona"]["status"]): string {
  if (status === "available") return "可用";
  if (status === "partial") return "部分可用";
  if (status === "missing") return "缺失";
  if (status === "disabled") return "未启用";
  if (status === "error") return "错误";
  return status;
}

function localizeDetail(detail: string | null | undefined): string | null | undefined {
  if (!detail) return detail;
  if (detail.startsWith("Missing data: ")) return `缺少数据：${detail.slice("Missing data: ".length)}`;
  if (detail === "No data was parsed.") return "未解析到数据。";
  if (detail === "Persona file was not found.") return "未找到 Persona 文件。";
  return detail;
}

function formatIsoText(value: string): string {
  return value.replace("T", " ").replace(".000Z", "Z");
}
