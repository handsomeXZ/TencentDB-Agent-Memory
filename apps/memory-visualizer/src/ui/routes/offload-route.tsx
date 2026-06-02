import mermaid from "mermaid";
import { useEffect, useState } from "react";

import type { CapabilityStatusValue, DashboardSnapshot, JsonValue, OffloadCanvas } from "../../contracts/dashboard";
import type { OffloadResponse } from "../api-client";
import type { AsyncState } from "../dashboard-data";
import { EmptyState, ErrorState, LoadingState, MetaPair, StateCard, StatusBadge } from "../components";
import { formatOptionalIsoText, translateSeverity } from "./shared";

mermaid.initialize({
  startOnLoad: false,
  securityLevel: "strict",
});

export function OffloadRoute({
  offloadState,
  snapshotState,
}: {
  readonly offloadState: AsyncState<OffloadResponse>;
  readonly snapshotState: AsyncState<DashboardSnapshot>;
}) {
  if (offloadState.status === "loading" || snapshotState.status === "loading") {
    return <LoadingState title="正在加载 Offload Task Canvas" detail="正在从应用内本地 API 请求画布 DTO 与解析告警。" />;
  }

  if (offloadState.status === "error") {
    return <ErrorState title="Offload Task Canvas 不可用" detail={offloadState.error ?? "Offload 请求失败。"} />;
  }

  if (snapshotState.status === "error") {
    return <ErrorState title="快照不可用" detail={snapshotState.error ?? "快照请求失败。"} />;
  }

  const payload = offloadState.data;
  const snapshot = snapshotState.data;
  if (!payload || !snapshot) {
    return <EmptyState title="没有可用的 Offload 画布" detail="即使 Offload 能力未启用，其余页面仍然可以继续查看。" />;
  }

  if (payload.canvases.items.length === 0) {
    return <EmptyState title="没有可用的 Offload 画布" detail="当前数据源没有返回任何 Offload Mermaid 摘要。" />;
  }

  const selectedCanvas = payload.canvases.items[0] ?? null;
  const canvasWarnings = snapshot.warnings.filter((warning) => warning.code.startsWith("offload") || warning.source.includes("offload"));

  return (
    <div className="route-grid offload-route-layout">
      <section className="shell-panel">
        <div className="table-row">
          <div>
            <div className="table-label">画布注册表</div>
            <h3 className="table-heading">Offload 任务画布</h3>
          </div>
          <span>总计 {payload.canvases.total}</span>
        </div>
        <p className="route-copy">
          每个画布都保持只读。这个界面会列出序列化后的 MMD metadata、节点摘要、关联的 Offload 条目以及已有的 <span className="mono">result_ref</span> 提示，但不会打开任意文件系统路径。
        </p>
        <div className="table-list">
          {payload.canvases.items.map((canvas) => (
            <article key={canvas.canvasId} className="table-card offload-card" data-active={canvas.canvasId === selectedCanvas?.canvasId ? "true" : "false"}>
              <div className="table-row">
                <div>
                  <div className="table-label">{canvas.filename}</div>
                  <h3 className="table-heading">{canvas.taskGoal}</h3>
                </div>
                <StatusBadge status={offloadCanvasStatus(canvas)}>{canvas.nodes.length} 个节点</StatusBadge>
              </div>
              <div className="metric-subtle mono">{canvas.path}</div>
              <div className="offload-counter-grid">
                <MetaPair label="已完成 Done" value={String(canvas.doneCount)} variant="metric" />
                <MetaPair label="进行中 Doing" value={String(canvas.doingCount)} variant="metric" />
                <MetaPair label="待处理 Todo" value={String(canvas.todoCount)} variant="metric" />
                <MetaPair label="引用 Refs" value={String(canvas.refs.length)} variant="metric" />
              </div>
              <div className="memory-meta-grid">
                <MetaPair label="创建时间" value={formatOptionalIsoText(canvas.createdTime)} mono variant="metric" />
                <MetaPair label="更新时间" value={formatOptionalIsoText(canvas.updatedTime)} mono variant="metric" />
                <MetaPair label="Canvas ID" value={canvas.canvasId} mono variant="metric" />
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="shell-panel">
        <div className="table-row">
          <div>
            <div className="table-label">Mermaid 展示层</div>
            <h3 className="table-heading">画布渲染与回退</h3>
          </div>
          {selectedCanvas ? <StatusBadge status={offloadCanvasStatus(selectedCanvas)}>{selectedCanvas.filename}</StatusBadge> : null}
        </div>
        {selectedCanvas ? <OffloadCanvasDetail canvas={selectedCanvas} warnings={canvasWarnings} /> : <EmptyState title="未选择画布" detail="请选择一个画布摘要来查看 Mermaid 渲染和关联轨迹。" />}
      </section>

      <section className="shell-panel">
        <div className="table-row">
          <div>
            <div className="table-label">节点摘要</div>
             <h3 className="table-heading">Done、Doing 与 Todo 流程</h3>
          </div>
          <span>{selectedCanvas?.nodes.length ?? 0} 条可见</span>
        </div>
        {selectedCanvas ? (
          <div className="table-list">
            {selectedCanvas.nodes.map((node) => (
              <article key={node.nodeId} className="table-card">
                <div className="table-row">
                  <div>
                    <div className="table-label">{node.nodeId}</div>
                    <h3 className="table-heading">{node.label}</h3>
                  </div>
                  <StatusBadge status={nodeStatusToCapability(node.status)}>{node.status}</StatusBadge>
                </div>
                <div className="table-copy">{node.summary}</div>
                <div className="metric-subtle mono">{formatOptionalIsoText(node.timestamp)}</div>
              </article>
            ))}
          </div>
        ) : null}
      </section>

      <section className="shell-panel">
        <div className="table-row">
          <div>
            <div className="table-label">关联 Offload 条目</div>
            <h3 className="table-heading">序列化 result_ref</h3>
          </div>
          <span>{selectedCanvas?.refs.length ?? 0} 个关联</span>
        </div>
        {selectedCanvas && selectedCanvas.refs.length > 0 ? (
          <div className="table-list">
            {selectedCanvas.refs.map((reference) => (
              <article key={reference.toolCallId} className="table-card">
                <div className="table-row">
                  <div>
                    <div className="table-label">{reference.toolCall}</div>
                    <h3 className="table-heading">{reference.toolCallId}</h3>
                  </div>
                  <StatusBadge status={reference.score === null ? "missing" : "available"}>{reference.score === null ? "无 score" : `score ${reference.score}`}</StatusBadge>
                </div>
                <div className="table-copy">{reference.summary}</div>
                <div className="memory-meta-grid">
                  <MetaPair label="节点" value={reference.nodeId ?? "未关联"} mono variant="metric" />
                  <MetaPair label="result_ref" value={reference.resultRef} mono variant="metric" />
                  <MetaPair label="Session" value={reference.sessionKey ?? "未记录"} mono variant="metric" />
                  <MetaPair label="时间戳" value={formatOptionalIsoText(reference.timestamp)} mono variant="metric" />
                </div>
              </article>
            ))}
          </div>
        ) : (
          <EmptyState title="没有 Offload 引用" detail="当所选数据源里没有被 Offload 的工具结果时，这里的引用追踪会保持为空。" />
        )}
      </section>
    </div>
  );
}



function OffloadCanvasDetail({
  canvas,
  warnings,
}: {
  readonly canvas: OffloadCanvas;
  readonly warnings: DashboardSnapshot["warnings"];
}) {
  const renderSource = readCanvasMetadataText(canvas.rawMetadata, "mermaidSource");
  const fallbackText = readCanvasMetadataText(canvas.rawMetadata, "fallbackText");
  const relevantWarnings = warnings.filter((warning) => warning.source === canvas.path || warning.code.startsWith("offload-mermaid"));

  return (
    <div className="offload-detail-stack">
      {fallbackText ? (
        <StateCard tone="warning" label="告警" title="Mermaid 回退内容无效" detail={relevantWarnings[0]?.message ?? "Mermaid 解析已降级，因此界面保留原始预览，而不会直接崩溃。"} />
      ) : null}
      {renderSource ? <MermaidPreview source={renderSource} /> : null}
      {fallbackText ? (
        <article className="state-card" data-tone="warning">
          <div className="meta-label">原始回退预览</div>
          <strong>解析器已保留回退文本</strong>
          <pre className="json-hint">{fallbackText}</pre>
        </article>
      ) : null}
      {!renderSource && !fallbackText ? <EmptyState title="没有可用的 Mermaid 源" detail="这个画布没有包含可渲染的 Mermaid 正文，也没有回退预览 metadata。" /> : null}
      {relevantWarnings.length > 0 ? (
        <div className="warning-list">
          {relevantWarnings.map((warning) => (
            <article key={`${warning.code}:${warning.source}`} className="state-card" data-tone={warning.severity === "error" ? "error" : "warning"}>
              <div className="state-header">
                <div>
                    <div className="meta-label">{translateSeverity(warning.severity)}</div>
                    <strong>{warning.code}</strong>
                  </div>
                  <span className="mono">{warning.location ?? warning.source}</span>
              </div>
              <div className="state-copy">{warning.message}</div>
            </article>
          ))}
        </div>
      ) : null}
    </div>
  );
}



function MermaidPreview({ source }: { readonly source: string }) {
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const render = async () => {
      setSvg(null);
      setError(null);
      try {
        const output = await mermaid.render(`offload-${hashPreview(source)}`, source);
        if (active) setSvg(output.svg);
      } catch (renderError) {
        if (active) setError(renderError instanceof Error ? renderError.message : String(renderError));
      }
    };
    void render();
    return () => {
      active = false;
    };
  }, [source]);

  if (error) {
    return <StateCard tone="warning" label="告警" title="Mermaid 渲染已降级" detail={error} />;
  }

  if (!svg) {
    return <LoadingState title="正在渲染 Mermaid 画布" detail="正在使用应用内本地 Mermaid 依赖生成 strict-mode SVG。" />;
  }

  return (
    <article className="state-card mermaid-card" data-tone="loading">
      <div className="meta-label">Mermaid 渲染</div>
      <strong>strict-mode SVG 预览</strong>
      <div className="mermaid-preview" dangerouslySetInnerHTML={{ __html: svg }} />
      <pre className="json-hint">{source}</pre>
    </article>
  );
}



function offloadCanvasStatus(canvas: OffloadCanvas): CapabilityStatusValue {
  if (readCanvasMetadataText(canvas.rawMetadata, "fallbackText")) return "partial";
  if (canvas.todoCount > 0 || canvas.doingCount > 0) return "partial";
  if (canvas.doneCount > 0) return "available";
  return "missing";
}



function nodeStatusToCapability(status: OffloadCanvas["nodes"][number]["status"]): CapabilityStatusValue {
  if (status === "done") return "available";
  if (status === "doing") return "partial";
  if (status === "todo") return "missing";
  return "partial";
}



function readCanvasMetadataText(metadata: DashboardSnapshot["offloadCanvases"][number]["rawMetadata"], key: string): string {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return "";
  const value = (metadata as { readonly [name: string]: JsonValue })[key];
  return typeof value === "string" ? value : "";
}



function hashPreview(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return String(hash);
}

