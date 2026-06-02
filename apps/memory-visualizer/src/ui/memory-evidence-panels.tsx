import { useEffect, useMemo, useState } from "react";

import { JsonHintCard, MetaPair, PageControls, StateCard, StatusBadge } from "./components";

import type { ConversationEvidence, DashboardSnapshot, OffloadReference, StructuredMemorySummary } from "../contracts/dashboard";
import type { DashboardPage } from "../providers";
import type { DashboardApiClient, EvidenceLinkIndexEntry, PageRequest, SourceQueryConfig } from "./api-client";

interface AsyncState<T> {
  readonly status: "loading" | "ready" | "error";
  readonly data: T | null;
  readonly error: string | null;
}

interface MemoryExplorerRouteProps {
  readonly client: DashboardApiClient;
  readonly sourceQuery: SourceQueryConfig;
  readonly snapshotState: AsyncState<DashboardSnapshot>;
  readonly initialMemoryState: AsyncState<DashboardPage<StructuredMemorySummary>>;
  readonly selectedMemoryId: string | null;
  readonly onMemoryNavigate: (memoryId: string) => void;
}

interface EvidenceRouteProps {
  readonly client: DashboardApiClient;
  readonly sourceQuery: SourceQueryConfig;
  readonly snapshotState: AsyncState<DashboardSnapshot>;
  readonly initialMemoryState: AsyncState<DashboardPage<StructuredMemorySummary>>;
  readonly initialEvidenceState: AsyncState<DashboardPage<EvidenceLinkIndexEntry>>;
  readonly initialConversationState: AsyncState<DashboardPage<ConversationEvidence>>;
  readonly selectedMemoryId: string | null;
  readonly onMemoryNavigate: (memoryId: string) => void;
}

interface MemoryFilters {
  readonly query: string;
  readonly type: string;
  readonly priorityMin: string;
  readonly sceneQuery: string;
  readonly sessionQuery: string;
  readonly updatedSince: string;
  readonly warningStatus: "all" | "warning" | "clean";
}

interface PriorityBucketSummary {
  readonly label: string;
  readonly count: number;
}

const PAGE_LIMIT = 25;

const DEFAULT_FILTERS: MemoryFilters = {
  query: "",
  type: "all",
  priorityMin: "",
  sceneQuery: "",
  sessionQuery: "",
  updatedSince: "",
  warningStatus: "all",
};

export function MemoryExplorerRoute(props: MemoryExplorerRouteProps) {
  const { client, sourceQuery, snapshotState, initialMemoryState, selectedMemoryId, onMemoryNavigate } = props;
  const [page, setPage] = useState<PageRequest>({ offset: initialMemoryState.data?.offset ?? 0, limit: initialMemoryState.data?.limit ?? PAGE_LIMIT });
  const [memoryState, setMemoryState] = useState<AsyncState<DashboardPage<StructuredMemorySummary>>>(initialMemoryState);
  const [filters, setFilters] = useState<MemoryFilters>(DEFAULT_FILTERS);

  useEffect(() => {
    setMemoryState(initialMemoryState);
    setPage({ offset: initialMemoryState.data?.offset ?? 0, limit: initialMemoryState.data?.limit ?? PAGE_LIMIT });
  }, [initialMemoryState]);

  useEffect(() => {
    let cancelled = false;
    const requestPage = async () => {
      setMemoryState((current) => ({ ...current, status: "loading" }));
      try {
        const data = await client.getMemories(sourceQuery, page);
        if (!cancelled) setMemoryState({ status: "ready", data, error: null });
      } catch (error) {
        if (!cancelled) setMemoryState({ status: "error", data: null, error: error instanceof Error ? error.message : String(error) });
      }
    };
    void requestPage();
    return () => {
      cancelled = true;
    };
  }, [client, page.limit, page.offset, sourceQuery]);

  const snapshot = snapshotState.data;
  const memoryWarnings = useMemo(() => buildMemoryWarningMap(snapshot), [snapshot]);
  const staleJsonlWarning = findSqliteJsonlFallbackWarning(snapshot);
  const filteredPage = useMemo(() => {
    const pageData = memoryState.data;
    const items = pageData?.items ?? [];
    return items.filter((memory) => matchesMemoryFilters(memory, filters, memoryWarnings.get(memory.recordId) ?? []));
  }, [filters, memoryState.data, memoryWarnings]);
  const typeSummary = useMemo(() => countByType(filteredPage), [filteredPage]);
  const prioritySummary = useMemo(() => countByPriority(filteredPage), [filteredPage]);
  const selectedMemory = filteredPage.find((memory) => memory.recordId === selectedMemoryId) ?? filteredPage[0] ?? null;
  const availableTypes = useMemo(() => {
    const pageItems = memoryState.data?.items ?? [];
    return [...new Set(pageItems.map((memory) => memory.type).filter((value) => value.trim().length > 0))].sort((left, right) => left.localeCompare(right));
  }, [memoryState.data]);

  if (memoryState.status === "loading" && memoryState.data === null) {
    return <StateCard tone="loading" label="加载中" title="正在加载结构化 Memory Explorer" detail="正在通过只读分页 API 请求 L1 Memory。" />;
  }

  if (memoryState.status === "error") {
    return <StateCard tone="error" label="错误" title="结构化 Memory Explorer 不可用" detail={memoryState.error ?? "Memory 分页请求失败。"} />;
  }

  const pageData = memoryState.data;
  if (!pageData) {
    return <StateCard tone="empty" label="空状态" title="没有可用的结构化 Memory" detail="即使缺少 L1 Memory 数据，其它界面仍可继续使用。" />;
  }

  return (
    <div className="route-grid memory-route-layout">
      <section className="shell-panel">
        <div className="table-row">
          <div>
            <div className="table-label">Memory 浏览</div>
            <h3 className="table-heading">按分页查看的结构化 Memory 索引</h3>
          </div>
          <StatusBadge status={memoryState.status === "loading" ? "partial" : "available"}>{memoryState.status === "loading" ? "刷新中" : `总计 ${pageData.total}`}</StatusBadge>
        </div>
        <p className="route-copy">
          筛选条件只作用于当前已加载页面。当前从 offset <span className="mono">{pageData.offset}</span>、limit <span className="mono">{pageData.limit}</span> 加载了 <span className="mono">{pageData.items.length}</span> 行，因此这个视图不会假设所有记录都会一直常驻内存。
        </p>
        {staleJsonlWarning ? (
          <StateCard
            tone="warning"
            label="告警"
            title="JSONL 回退结果可能已过时"
            detail="这里拿不到 SQLite 的有效记录，因此追加式 JSONL 解析可能包含过期更新或已合并内容。时间戳和 Evidence 轨迹请仅作为尽力提示。"
          />
        ) : null}
        <MemoryFilterBar filters={filters} types={availableTypes} onChange={setFilters} />
      </section>

      <section className="shell-panel">
        <div className="table-row">
          <div>
            <div className="table-label">分布摘要</div>
            <h3 className="table-heading">当前可见的 Memory 组成</h3>
          </div>
          <span>{filteredPage.length} 条可见</span>
        </div>
        <div className="distribution-grid">
          <SummaryCluster title="Type 分布" items={typeSummary.map((item) => ({ label: item.label, value: item.count }))} emptyLabel="当前页面没有 Type 数据。" />
          <SummaryCluster title="优先级分布" items={prioritySummary.map((item) => ({ label: item.label, value: item.count }))} emptyLabel="当前页面没有优先级数据。" />
        </div>
      </section>

      <section className="shell-panel">
        <div className="table-row">
          <div>
            <div className="table-label">Memory 卡片</div>
            <h3 className="table-heading">过滤后的分页结果</h3>
          </div>
          <span>{filteredPage.length} 条匹配</span>
        </div>
        {filteredPage.length === 0 ? (
          <StateCard tone="empty" label="空状态" title="当前筛选条件没有匹配到任何 Memory" detail="可以清除 Scene、Session、Type 或告警筛选条件，扩大当前页面的可见结果。" />
        ) : (
          <div className="table-list">
            {filteredPage.map((memory) => {
              const warnings = memoryWarnings.get(memory.recordId) ?? [];
              const selected = memory.recordId === selectedMemory?.recordId;
              return (
                <article key={memory.recordId} className="table-card memory-card" data-active={selected ? "true" : "false"}>
                  <div className="table-row">
                    <div>
                      <div className="table-label">{memory.type}</div>
                      <h3 className="table-heading">{memory.sceneName || "未限定 Scene"}</h3>
                    </div>
                    <StatusBadge status={warnings.length > 0 ? "partial" : "available"}>{`优先级 ${memory.priority}`}</StatusBadge>
                  </div>
                  <div className="table-copy">{memory.contentPreview}</div>
                  <div className="memory-meta-grid">
                    <MetaPair label="Session key" value={memory.sessionKey || "未记录"} mono />
                    <MetaPair label="Session ID" value={memory.sessionId || "未记录"} mono />
                    <MetaPair label="更新时间" value={formatIsoText(memory.updatedTime)} mono />
                    <MetaPair label="Evidence 引用" value={String(memory.evidenceIds.length)} />
                  </div>
                  {warnings.length > 0 ? <WarningTagList warnings={warnings} /> : null}
                  <button className="button button-block" type="button" onClick={() => onMemoryNavigate(memory.recordId)}>
                    打开 Evidence 下钻
                  </button>
                </article>
              );
            })}
          </div>
        )}
        <PageControls page={pageData} busy={memoryState.status === "loading"} onChange={setPage} />
      </section>
    </div>
  );
}

export function EvidenceRoute(props: EvidenceRouteProps) {
  const { client, sourceQuery, snapshotState, initialMemoryState, initialEvidenceState, initialConversationState, selectedMemoryId, onMemoryNavigate } = props;
  const [page, setPage] = useState<PageRequest>({ offset: initialMemoryState.data?.offset ?? 0, limit: initialMemoryState.data?.limit ?? PAGE_LIMIT });
  const [memoryState, setMemoryState] = useState<AsyncState<DashboardPage<StructuredMemorySummary>>>(initialMemoryState);
  const [evidenceState, setEvidenceState] = useState<AsyncState<DashboardPage<EvidenceLinkIndexEntry>>>(initialEvidenceState);
  const [conversationState, setConversationState] = useState<AsyncState<DashboardPage<ConversationEvidence>>>(initialConversationState);

  useEffect(() => {
    setPage({ offset: initialMemoryState.data?.offset ?? 0, limit: initialMemoryState.data?.limit ?? PAGE_LIMIT });
    setMemoryState(initialMemoryState);
    setEvidenceState(initialEvidenceState);
    setConversationState(initialConversationState);
  }, [initialConversationState, initialEvidenceState, initialMemoryState]);

  useEffect(() => {
    let cancelled = false;
    const requestPage = async () => {
      setMemoryState((current) => ({ ...current, status: "loading" }));
      setEvidenceState((current) => ({ ...current, status: "loading" }));
      setConversationState((current) => ({ ...current, status: "loading" }));
      try {
        const [memories, evidence, conversations] = await Promise.all([
          client.getMemories(sourceQuery, page),
          client.getEvidence(sourceQuery, page),
          client.getConversations(sourceQuery, page),
        ]);
        if (!cancelled) {
          setMemoryState({ status: "ready", data: memories, error: null });
          setEvidenceState({ status: "ready", data: evidence, error: null });
          setConversationState({ status: "ready", data: conversations, error: null });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!cancelled) {
          setMemoryState({ status: "error", data: null, error: message });
          setEvidenceState({ status: "error", data: null, error: message });
          setConversationState({ status: "error", data: null, error: message });
        }
      }
    };
    void requestPage();
    return () => {
      cancelled = true;
    };
  }, [client, page.limit, page.offset, sourceQuery]);

  if (memoryState.status === "loading" && memoryState.data === null) {
    return <StateCard tone="loading" label="加载中" title="正在加载 Evidence Drill-down" detail="正在解析当前页面的 Memory 卡片、Evidence 关联行和 L0 片段。" />;
  }

  if (memoryState.status === "error" || evidenceState.status === "error" || conversationState.status === "error") {
    return <StateCard tone="error" label="错误" title="Evidence Drill-down 不可用" detail={memoryState.error ?? evidenceState.error ?? conversationState.error ?? "Evidence 页面请求失败。"} />;
  }

  const memoryPage = memoryState.data;
  const evidencePage = evidenceState.data;
  const conversationPage = conversationState.data;
  if (!memoryPage || !evidencePage || !conversationPage) {
    return <StateCard tone="empty" label="空状态" title="没有可用的下钻链接" detail="Evidence 索引没有返回 Memory、Evidence 或会话分页数据。" />;
  }

  const snapshot = snapshotState.data;
  const selectedMemory = memoryPage.items.find((memory) => memory.recordId === selectedMemoryId) ?? memoryPage.items[0] ?? null;
  const selectedEvidence = selectedMemory ? evidencePage.items.find((entry) => entry.memoryRecordId === selectedMemory.recordId) ?? null : null;
  const conversationById = new Map(conversationPage.items.map((record) => [record.recordId, record]));
  const resolvedRecords = selectedEvidence?.evidenceIds.map((id) => conversationById.get(id) ?? selectedEvidence.evidenceRecords.find((record) => record.recordId === id)).filter(isDefined) ?? [];
  const missingEvidenceIds = selectedEvidence?.evidenceIds.filter((id) => !resolvedRecords.some((record) => record.recordId === id)) ?? [];
  const offloadRefs = snapshot && selectedMemory
    ? snapshot.offloadCanvases.flatMap((canvas) => canvas.refs).filter((reference) => reference.sessionKey === selectedMemory.sessionKey)
    : [];
  const staleJsonlWarning = findSqliteJsonlFallbackWarning(snapshot);

  return (
    <div className="route-grid evidence-route-layout">
      <section className="shell-panel">
        <div className="table-row">
          <div>
            <div className="table-label">Memory 选择器</div>
            <h3 className="table-heading">当前页面记录</h3>
          </div>
          <span>已加载 {memoryPage.items.length} 条</span>
        </div>
        <p className="route-copy">
          下钻只使用当前分页 API 的窗口数据。offset <span className="mono">{memoryPage.offset}</span>，limit <span className="mono">{memoryPage.limit}</span>，总计 <span className="mono">{memoryPage.total}</span>。
        </p>
        <div className="scene-link-list">
          {memoryPage.items.map((memory) => (
            <button
              key={memory.recordId}
              className="scene-link memory-select-button"
              data-active={memory.recordId === selectedMemory?.recordId ? "true" : "false"}
              type="button"
              onClick={() => onMemoryNavigate(memory.recordId)}
            >
              <span className="nav-title">{memory.contentPreview}</span>
              <span className="route-copy">{memory.type} · 优先级 {memory.priority} · {memory.sessionKey || "无 session key"}</span>
            </button>
          ))}
        </div>
        <PageControls page={memoryPage} busy={memoryState.status === "loading" || evidenceState.status === "loading" || conversationState.status === "loading"} onChange={setPage} />
      </section>

      <section className="shell-panel">
        <div className="table-row">
          <div>
            <div className="table-label">Evidence 下钻</div>
            <h3 className="table-heading">{selectedMemory ? selectedMemory.sceneName || selectedMemory.recordId : "未选择 Memory"}</h3>
          </div>
          {selectedMemory ? <StatusBadge status={missingEvidenceIds.length > 0 ? "partial" : "available"}>{selectedMemory.type}</StatusBadge> : null}
        </div>
        {!selectedMemory ? (
          <StateCard tone="empty" label="空状态" title="未选择 Memory" detail="请从当前页面选择一条记录，以查看 L0 片段、源 ID 和相关 Offload 引用。" />
        ) : (
          <div className="scene-panel-stack">
            <div className="scene-preview">{selectedMemory.content}</div>
            <div className="memory-meta-grid">
              <MetaPair label="Record ID" value={selectedMemory.recordId} mono />
              <MetaPair label="源消息提示" value={selectedMemory.sourceId || "未记录"} mono />
              <MetaPair label="Session key" value={selectedMemory.sessionKey || "未记录"} mono />
              <MetaPair label="Session ID" value={selectedMemory.sessionId || "未记录"} mono />
              <MetaPair label="创建时间" value={formatIsoText(selectedMemory.createdTime)} mono />
              <MetaPair label="更新时间" value={formatIsoText(selectedMemory.updatedTime)} mono />
            </div>
            {staleJsonlWarning ? (
              <StateCard tone="warning" label="告警" title="追加式 JSONL 轨迹" detail="由于拿不到 SQLite 的有效行，这些源 ID 和时间戳描述的可能是追加式 JSONL 历史，而不是最新合并状态。" />
            ) : null}
            {missingEvidenceIds.length > 0 ? (
              <StateCard tone="warning" label="告警" title="缺少源 Evidence" detail={`无法解析 ${missingEvidenceIds.join(", ")} 的源 Evidence。Memory 记录仍会显示，但当前数据源中缺少原始 L0 片段。`} />
            ) : null}
            <div className="detail-grid">
              <article className="metric-card">
                <div className="meta-label">Evidence ID 列表</div>
                <div className="metric-subtle mono">{selectedEvidence?.evidenceIds.join(", ") || "未记录"}</div>
              </article>
              <article className="metric-card">
                <div className="meta-label">JSONL 源提示</div>
                <div className="metric-subtle mono">{snapshot?.dataSource.l1DatabasePath || "未记录 L1 路径。"}</div>
              </article>
              <article className="metric-card">
                <div className="meta-label">会话源提示</div>
                <div className="metric-subtle mono">{snapshot?.dataSource.l0DatabasePath || "未记录 L0 路径。"}</div>
              </article>
              <article className="metric-card">
                <div className="meta-label">Metadata 说明</div>
                <div className="metric-subtle">{selectedMemory.rawMetadata ? "下方提供了原始 metadata，可用于文件或记录提示。" : "这条 Memory 没有序列化原始 metadata 提示。"}</div>
              </article>
            </div>
            {selectedMemory.rawMetadata ? <JsonHintCard title="原始 metadata 提示" value={selectedMemory.rawMetadata} /> : null}
          </div>
        )}
      </section>

      <section className="shell-panel">
        <div className="table-row">
          <div>
            <div className="table-label">L0 对话片段</div>
            <h3 className="table-heading">已解析的源 Evidence</h3>
          </div>
          <span>已解析 {resolvedRecords.length} 条</span>
        </div>
        {resolvedRecords.length === 0 ? (
          <StateCard tone="empty" label="空状态" title="没有解析到 L0 片段" detail="当前页面没有为所选 Memory 解析出任何对话片段。" />
        ) : (
          <div className="table-list">
            {resolvedRecords.map((record) => (
              <article key={record.recordId} className="table-card">
                <div className="table-row">
                  <div>
                    <div className="table-label">{record.role}</div>
                    <h3 className="table-heading">{record.recordId}</h3>
                  </div>
                  <span className="mono">{formatIsoText(record.recordedAt)}</span>
                </div>
                <div className="table-copy">{record.snippet}</div>
                <div className="memory-meta-grid">
                  <MetaPair label="Session key" value={record.sessionKey || "未记录"} mono />
                  <MetaPair label="Session ID" value={record.sessionId || "未记录"} mono />
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="shell-panel">
        <div className="table-row">
          <div>
            <div className="table-label">Offload / ref Evidence</div>
            <h3 className="table-heading">与 Session 关联的 Offload 轨迹</h3>
          </div>
          <span>{offloadRefs.length} 个关联</span>
        </div>
        {offloadRefs.length === 0 ? (
          <StateCard tone="empty" label="空状态" title="当前 Session 没有 Offload ref" detail="没有任何 Offload 引用与所选 Memory 的 session key 相同，因此下钻会停留在 L0 对话 Evidence。" />
        ) : (
          <div className="table-list">
            {offloadRefs.map((reference) => (
              <OffloadRefCard key={reference.toolCallId} reference={reference} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function MemoryFilterBar(props: {
  readonly filters: MemoryFilters;
  readonly types: readonly string[];
  readonly onChange: (filters: MemoryFilters) => void;
}) {
  const { filters, types, onChange } = props;
  return (
    <div className="memory-filter-grid">
      <label className="field">
        <span>文本搜索</span>
        <input aria-label="文本搜索" value={filters.query} onChange={(event) => onChange({ ...filters, query: event.target.value })} placeholder="内容、Record ID、Source ID" />
      </label>
      <label className="field">
        <span>Type 类型</span>
        <select aria-label="Type 类型" value={filters.type} onChange={(event) => onChange({ ...filters, type: event.target.value })}>
          <option value="all">全部 Type 类型</option>
          {types.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>最低优先级</span>
        <input aria-label="最低优先级" value={filters.priorityMin} onChange={(event) => onChange({ ...filters, priorityMin: event.target.value })} inputMode="numeric" placeholder="80" />
      </label>
      <label className="field">
        <span>Scene 筛选</span>
        <input aria-label="Scene 筛选" value={filters.sceneQuery} onChange={(event) => onChange({ ...filters, sceneQuery: event.target.value })} placeholder="Scene 标题或 ID 提示" />
      </label>
      <label className="field">
        <span>Session 筛选</span>
        <input aria-label="Session 筛选" value={filters.sessionQuery} onChange={(event) => onChange({ ...filters, sessionQuery: event.target.value })} placeholder="sessionKey 或 sessionId" />
      </label>
      <label className="field">
        <span>更新起始时间</span>
        <input aria-label="更新起始时间" type="date" value={filters.updatedSince} onChange={(event) => onChange({ ...filters, updatedSince: event.target.value })} />
      </label>
      <label className="field">
        <span>告警状态</span>
        <select aria-label="告警状态" value={filters.warningStatus} onChange={(event) => onChange({ ...filters, warningStatus: event.target.value as MemoryFilters["warningStatus"] })}>
          <option value="all">全部行</option>
          <option value="warning">仅告警</option>
          <option value="clean">仅干净记录</option>
        </select>
      </label>
      <div className="field field-actions">
        <span>快速重置</span>
        <button className="button" type="button" onClick={() => onChange(DEFAULT_FILTERS)}>
          清空筛选条件
        </button>
      </div>
    </div>
  );
}

function SummaryCluster(props: {
  readonly title: string;
  readonly items: readonly { readonly label: string; readonly value: number }[];
  readonly emptyLabel: string;
}) {
  const { title, items, emptyLabel } = props;
  return (
    <article className="table-card">
      <div className="table-label">{title}</div>
      {items.length === 0 ? (
        <div className="state-copy">{emptyLabel}</div>
      ) : (
        <div className="summary-list">
          {items.map((item) => (
            <div key={item.label} className="summary-bar">
              <span>{item.label}</span>
              <strong>{item.value}</strong>
            </div>
          ))}
        </div>
      )}
    </article>
  );
}

function WarningTagList(props: { readonly warnings: readonly string[] }) {
  return (
    <div className="warning-tag-list">
      {props.warnings.map((warning) => (
        <span key={warning} className="warning-tag">
          {formatWarningTag(warning)}
        </span>
      ))}
    </div>
  );
}

function OffloadRefCard(props: { readonly reference: OffloadReference }) {
  const { reference } = props;
  return (
    <article className="table-card">
      <div className="table-row">
        <div>
          <div className="table-label">{reference.toolCall}</div>
          <h3 className="table-heading">{reference.toolCallId}</h3>
        </div>
        <span className="mono">{reference.resultRef || "无 result_ref"}</span>
      </div>
      <div className="table-copy">{reference.summary}</div>
      <div className="memory-meta-grid">
        <MetaPair label="Node ID" value={reference.nodeId ?? "未记录"} mono />
        <MetaPair label="Session key" value={reference.sessionKey ?? "未记录"} mono />
        <MetaPair label="时间戳" value={formatIsoText(reference.timestamp)} mono />
      </div>
    </article>
  );
}

function buildMemoryWarningMap(snapshot: DashboardSnapshot | null): Map<string, string[]> {
  const warnings = new Map<string, string[]>();
  if (!snapshot) return warnings;
  const hasJsonlFallbackWarning = findSqliteJsonlFallbackWarning(snapshot) !== null;
  for (const memory of snapshot.structuredMemories) {
    const entries: string[] = [];
    const matchingEvidence = snapshot.conversationEvidence.filter((record) => memory.evidenceIds.includes(record.recordId));
    if (memory.evidenceIds.length > matchingEvidence.length) entries.push("missing-evidence");
    if (hasJsonlFallbackWarning) entries.push("jsonl-fallback");
    warnings.set(memory.recordId, entries);
  }
  return warnings;
}

function findSqliteJsonlFallbackWarning(snapshot: DashboardSnapshot | null) {
  return snapshot?.warnings.find((warning) => isSqliteJsonlFallbackWarningCode(warning.code)) ?? null;
}

function isSqliteJsonlFallbackWarningCode(code: string): boolean {
  return code === "sqlite-metadata-reader-disabled" || code === "sqlite-metadata-read-error";
}

function matchesMemoryFilters(memory: StructuredMemorySummary, filters: MemoryFilters, warnings: readonly string[]): boolean {
  const haystack = [memory.recordId, memory.content, memory.contentPreview, memory.sceneName, memory.sessionKey, memory.sessionId, memory.sourceId]
    .join(" ")
    .toLowerCase();
  const query = filters.query.trim().toLowerCase();
  if (query && !haystack.includes(query)) return false;
  if (filters.type !== "all" && memory.type !== filters.type) return false;
  const priorityMin = Number(filters.priorityMin.trim());
  if (filters.priorityMin.trim() !== "" && (!Number.isFinite(priorityMin) || memory.priority < priorityMin)) return false;
  const sceneQuery = filters.sceneQuery.trim().toLowerCase();
  if (sceneQuery && !memory.sceneName.toLowerCase().includes(sceneQuery)) return false;
  const sessionQuery = filters.sessionQuery.trim().toLowerCase();
  if (sessionQuery && !`${memory.sessionKey} ${memory.sessionId}`.toLowerCase().includes(sessionQuery)) return false;
  if (filters.updatedSince) {
    const updated = Date.parse(memory.updatedTime);
    const threshold = Date.parse(`${filters.updatedSince}T00:00:00.000Z`);
    if (!Number.isFinite(updated) || updated < threshold) return false;
  }
  if (filters.warningStatus === "warning" && warnings.length === 0) return false;
  if (filters.warningStatus === "clean" && warnings.length > 0) return false;
  return true;
}

function countByType(memories: readonly StructuredMemorySummary[]): readonly { readonly label: string; readonly count: number }[] {
  const counts = new Map<string, number>();
  for (const memory of memories) counts.set(memory.type || "unknown", (counts.get(memory.type || "unknown") ?? 0) + 1);
  return [...counts.entries()].map(([label, count]) => ({ label, count })).sort((left, right) => right.count - left.count || left.label.localeCompare(right.label));
}

function countByPriority(memories: readonly StructuredMemorySummary[]): readonly PriorityBucketSummary[] {
  const buckets = new Map<string, number>();
  for (const memory of memories) {
    const label = priorityBucketLabel(memory.priority);
    buckets.set(label, (buckets.get(label) ?? 0) + 1);
  }
  return [...buckets.entries()].map(([label, count]) => ({ label, count })).sort((left, right) => right.count - left.count || left.label.localeCompare(right.label));
}

function priorityBucketLabel(priority: number): string {
  if (priority >= 90) return "90-100 严重";
  if (priority >= 80) return "80-89 高";
  if (priority >= 60) return "60-79 提升";
  if (priority >= 0) return "0-59 基线";
  return "负值严格";
}

function formatIsoText(value: string): string {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : value || "未知";
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}

function formatWarningTag(warning: string): string {
  if (warning === "missing-evidence") return "缺失 Evidence";
  if (warning === "jsonl-fallback") return "JSONL 回退";
  return warning;
}
