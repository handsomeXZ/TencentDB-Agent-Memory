import type { MouseEvent as ReactMouseEvent } from "react";

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
              <StatusPill status="available">{formatCapabilityStatus("available")}</StatusPill>
            </div>
            <div className="table-copy">{persona.contentSummary}</div>
            <div className="scene-preview">{persona.contentPreview}</div>
            <div className="summary-list">
              <div className="stack-row">
                <span className="meta-label">Agent 标识</span>
                <span>{persona.agentId ?? "未记录"}</span>
              </div>
              <div className="stack-row">
                <span className="meta-label">版本</span>
                <span>{persona.version}</span>
              </div>
              <div className="stack-row">
                <span className="meta-label">更新时间</span>
                <span className="mono">{formatTimestamp(persona.updatedAtMs)}</span>
              </div>
              <div className="stack-row">
                <span className="meta-label">源提示</span>
                <span className="mono">{persona.filename}</span>
              </div>
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
              <div className="state-card" data-tone="empty">
                <div className="state-copy">这个 Persona 摘要没有引用任何 Scene ID。</div>
              </div>
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
        <article className="state-card" data-tone="warning">
          <div className="meta-label">Persona 缺失</div>
          <strong>Persona 文件不可用</strong>
          <div className="state-copy">{localizeDetail(snapshot.capabilityReport.persona.detail) ?? "当前数据源不包含 Persona 摘要。"}</div>
        </article>
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
        <article className="state-card" data-tone="empty">
          <div className="state-copy">当前数据源没有可用的 Scene 更新时间。</div>
        </article>
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
          <article className="state-card" data-tone="warning">
            <div className="meta-label">Scene 能力</div>
            <strong>{formatCapabilityStatus(sceneCapability.status)}</strong>
            <div className="state-copy">{localizeDetail(sceneCapability.detail) ?? "当前数据源没有 Scene Map 条目。"}</div>
          </article>
        </section>
        <section className="shell-panel">
          <h3 className="section-title">Scene 拓扑</h3>
          <article className="state-card" data-tone="empty">
            <div className="meta-label">空状态</div>
            <strong>没有可用的 Scene Map</strong>
            <div className="state-copy">这个数据源没有生成任何 Scene 块，但界面仍可继续使用。</div>
          </article>
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
          {selectedScene ? <StatusPill status={heatStatus(selectedScene.heatScore)}>{`热度 ${selectedScene.heatScore.toFixed(2)}`}</StatusPill> : null}
        </div>
        {selectedScene ? (
          <div className="scene-panel-stack">
            <div className="table-copy">{selectedScene.contentSummary}</div>
            <div className="scene-preview">{selectedScene.contentPreview}</div>
            <div className="detail-grid">
              <article className="metric-card">
                <div className="meta-label">更新时间</div>
                <div className="metric-subtle mono">{formatTimestamp(selectedScene.updatedAtMs)}</div>
              </article>
              <article className="metric-card">
                <div className="meta-label">Memory 数量</div>
                <div className="metric-subtle">{selectedScene.memoryCount}</div>
              </article>
              <article className="metric-card">
                <div className="meta-label">Evidence 引用</div>
                <div className="metric-subtle">{selectedScene.evidenceRecordIds.length}</div>
              </article>
              <article className="metric-card">
                <div className="meta-label">源提示</div>
                <div className="metric-subtle mono">{selectedScene.filename}</div>
              </article>
            </div>
            <div className="summary-list">
              <div className="stack-row">
                <span className="meta-label">Scene ID</span>
                <span className="mono">{selectedScene.sceneId}</span>
              </div>
              <div className="stack-row">
                <span className="meta-label">路径提示</span>
                <span className="mono">{selectedScene.sourcePath}</span>
              </div>
              <div className="stack-row">
                <span className="meta-label">关联 Persona</span>
                <span>{selectedScene.relatedPersonaIds.length}</span>
              </div>
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
          <article className="state-card" data-tone="warning">
            <div className="meta-label">解析告警</div>
            <strong>{sceneWarnings[0]?.code}</strong>
            <div className="state-copy">{sceneWarnings.map((warning) => `${warning.code}: ${warning.message}`).join(" ")}</div>
          </article>
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
                  <StatusPill status={heatStatus(scene.heatScore)}>{`热度 ${scene.heatScore.toFixed(2)}`}</StatusPill>
                </div>
                <div className="table-copy">{scene.contentSummary}</div>
                <div className="scene-preview">{scene.contentPreview}</div>
                <div className="summary-list">
                  <div className="stack-row">
                    <span className="meta-label">更新时间</span>
                    <span className="mono">{formatTimestamp(scene.updatedAtMs)}</span>
                  </div>
                  <div className="stack-row">
                    <span className="meta-label">Memory 数量</span>
                    <span>{scene.memoryCount}</span>
                  </div>
                  <div className="stack-row">
                    <span className="meta-label">Evidence 提示</span>
                    <span>{scene.evidenceRecordIds.length}</span>
                  </div>
                  <div className="stack-row">
                    <span className="meta-label">源提示</span>
                    <span className="mono">{scene.filename}</span>
                  </div>
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
          <StatusPill status={snapshot.capabilityReport.persona.status}>{formatCapabilityStatus(snapshot.capabilityReport.persona.status)}</StatusPill>
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

function StatusPill({ status, children }: { readonly status: DashboardSnapshot["capabilityReport"]["persona"]["status"]; readonly children: string }) {
  return (
    <span className="capability-badge" data-status={status}>
      {children}
    </span>
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
