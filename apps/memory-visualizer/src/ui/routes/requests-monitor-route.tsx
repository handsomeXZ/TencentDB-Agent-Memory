import { useEffect, useMemo, useState } from "react";

import type { DashboardSnapshot } from "../../contracts/dashboard";
import type { RequestTelemetryAuthType, RequestTelemetryPage, RequestTelemetrySource, RequestTelemetrySummary, RequestTelemetryWarning, SanitizedRequestLog } from "../../../../../src/telemetry/request-telemetry.js";
import type { DashboardApiClient, PageRequest, SourceQueryConfig } from "../api-client";
import type { AsyncState } from "../dashboard-data";
import { EmptyState, ErrorState, LoadingState, MetaPair, PageControls, StateCard, StatusBadge, WarningState } from "../components";

const DEFAULT_PAGE: PageRequest = { offset: 0, limit: 20 };

type RequestTypeFilter = "all" | "gateway-api" | "visualizer-api" | "unknown";
type RequestOutcomeFilter = "all" | "ok" | "unauthorized" | "error" | "blocked" | "aborted";
type SourceFilter = "all" | RequestTelemetrySource;

interface RequestFilters {
  readonly source: SourceFilter;
  readonly outcome: RequestOutcomeFilter;
  readonly type: RequestTypeFilter;
}

export function RequestsMonitorRoute({
  client,
  sourceQuery,
  snapshotState,
}: {
  readonly client: DashboardApiClient;
  readonly sourceQuery: SourceQueryConfig;
  readonly snapshotState: AsyncState<DashboardSnapshot>;
}) {
  const [pageRequest, setPageRequest] = useState<PageRequest>(DEFAULT_PAGE);
  const [pageState, setPageState] = useState<AsyncState<RequestTelemetryPage>>({ status: "loading", data: null, error: null });
  const [summaryState, setSummaryState] = useState<AsyncState<RequestTelemetrySummary>>({ status: "loading", data: null, error: null });
  const [filters, setFilters] = useState<RequestFilters>({ source: "all", outcome: "all", type: "all" });
  const [selectedRequestId, setSelectedRequestId] = useState<string | null>(null);
  const [refreshNonce, setRefreshNonce] = useState(0);

  useEffect(() => {
    setPageRequest(DEFAULT_PAGE);
  }, [sourceQuery]);

  useEffect(() => {
    let cancelled = false;
    const requestPage = async () => {
      setPageState((current) => ({ status: current.data ? "loading" : "loading", data: current.data, error: null }));
      try {
        const data = await client.getRequests(sourceQuery, pageRequest);
        if (!cancelled) setPageState({ status: "ready", data, error: null });
      } catch (error) {
        if (!cancelled) {
          setPageState({
            status: "error",
            data: null,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    };
    void requestPage();
    return () => {
      cancelled = true;
    };
  }, [client, pageRequest, refreshNonce, sourceQuery]);

  useEffect(() => {
    let cancelled = false;
    const requestSummary = async () => {
      setSummaryState((current) => ({ status: current.data ? "loading" : "loading", data: current.data, error: null }));
      try {
        const data = await client.getRequestsSummary(sourceQuery);
        if (!cancelled) setSummaryState({ status: "ready", data, error: null });
      } catch (error) {
        if (!cancelled) {
          setSummaryState({
            status: "error",
            data: null,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    };
    void requestSummary();
    return () => {
      cancelled = true;
    };
  }, [client, refreshNonce, sourceQuery]);

  const page = pageState.data;
  const summary = summaryState.data;
  const filteredItems = useMemo(() => {
    if (!page) return [] as readonly SanitizedRequestLog[];
    return page.items.filter((record) => matchesFilters(record, filters));
  }, [filters, page]);
  const selectedRecord = useMemo(() => {
    if (!page) return null;
    return filteredItems.find((record) => record.id === selectedRequestId)
      ?? page.items.find((record) => record.id === selectedRequestId)
      ?? filteredItems[0]
      ?? page.items[0]
      ?? null;
  }, [filteredItems, page, selectedRequestId]);
  const warningList = [
    ...(page?.warnings ?? []),
    ...(summary?.warnings ?? []),
  ];
  const dedupedWarnings = dedupeWarnings(warningList);
  const summaryMetrics = buildSummaryMetrics(summary, dedupedWarnings.length);
  const sourceBuckets = summary?.sources ?? [];
  const summaryLoading = summaryState.status === "loading" && summaryState.data === null;
  const pageLoading = pageState.status === "loading" && pageState.data === null;

  useEffect(() => {
    if (selectedRecord && selectedRecord.id !== selectedRequestId) {
      setSelectedRequestId(selectedRecord.id);
    }
    if (!selectedRecord && selectedRequestId !== null) {
      setSelectedRequestId(null);
    }
  }, [selectedRecord, selectedRequestId]);

  if (snapshotState.status === "loading" || pageLoading || summaryLoading) {
    return <LoadingState title="正在加载 Requests Monitor" detail="正在读取只读请求分页窗口、汇总指标与安全告警。" />;
  }

  if (snapshotState.status === "error") {
    return <ErrorState title="快照不可用" detail={snapshotState.error ?? "快照请求失败。"} />;
  }

  if (pageState.status === "error" && pageState.data === null) {
    return <ErrorState title="Requests Monitor 不可用" detail={pageState.error ?? "请求分页读取失败。"} />;
  }

  if (!page) {
    return <EmptyState title="没有请求遥测分页结果" detail="服务端没有返回任何安全请求记录窗口。" />;
  }

  return (
    <div className="route-grid requests-route-layout">
      <section className="shell-panel requests-span-full">
        <div className="table-row">
          <div>
            <div className="table-label">Operations strip</div>
            <h3 className="table-heading">Requests Monitor</h3>
          </div>
          <StatusBadge status={dedupedWarnings.length > 0 ? "partial" : "available"}>{dedupedWarnings.length > 0 ? "存在告警" : "只读就绪"}</StatusBadge>
        </div>
        <p className="route-copy">
          该视图只展示已脱敏的请求遥测字段。页面只保留 <span className="mono">path</span>、<span className="mono">query key 名</span>、结果状态、来源与认证类型，不暴露原始 body、query、header 或内容载荷。
        </p>
        <div className="metric-grid requests-top-strip">
          {summaryMetrics.map((metric) => (
            <article key={metric.label} className="metric-card">
              <div className="meta-label">{metric.label}</div>
              <div className="metric-value">{metric.value}</div>
              <div className="metric-subtle">{metric.detail}</div>
            </article>
          ))}
        </div>
        {sourceBuckets.length > 0 ? (
          <div className="summary-list">
            {sourceBuckets.map((bucket) => (
              <div key={bucket.key} className="summary-bar">
                <span>
                  <span className="monitor-pill" data-tone={bucket.key === "gateway" ? "source-gateway" : "source-visualizer"}>{formatSource(bucket.key as RequestTelemetrySource)}</span>
                  <span className="route-copy"> 平均 {bucket.averageLatencyMs === null ? "未记录" : `${bucket.averageLatencyMs} ms`}</span>
                </span>
                <span className="mono">{bucket.count} / error {bucket.errorCount} / auth {bucket.unauthorizedCount}</span>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState title="没有来源分布" detail="当前汇总窗口还没有足够的安全请求样本。" />
        )}
        {summaryState.status === "error" ? <WarningState title="汇总指标已降级" detail={summaryState.error ?? "请求汇总读取失败。"} /> : null}
        {dedupedWarnings.length > 0 ? <RequestWarningList warnings={dedupedWarnings} /> : null}
      </section>

      <section className="shell-panel requests-span-full">
        <div className="table-row">
          <div>
            <div className="table-label">Filter strip</div>
            <h3 className="table-heading">筛选与刷新</h3>
          </div>
          <span className="route-copy">当前页保留 {filteredItems.length} / {page.items.length} 条</span>
        </div>
        <div className="requests-filter-grid">
          <label className="field">
            <span>Source 来源</span>
            <select
              aria-label="Source 来源"
              value={filters.source}
              onChange={(event) => setFilters((current) => ({ ...current, source: event.target.value as SourceFilter }))}
            >
              <option value="all">全部来源</option>
              <option value="gateway">Gateway</option>
              <option value="visualizer-api">Visualizer API</option>
            </select>
          </label>
          <label className="field">
            <span>Result 结果</span>
            <select
              aria-label="Result 结果"
              value={filters.outcome}
              onChange={(event) => setFilters((current) => ({ ...current, outcome: event.target.value as RequestOutcomeFilter }))}
            >
              <option value="all">全部结果</option>
              <option value="ok">OK</option>
              <option value="unauthorized">Unauthorized</option>
              <option value="error">Error</option>
              <option value="blocked">Blocked</option>
              <option value="aborted">Aborted</option>
            </select>
          </label>
          <label className="field">
            <span>Type 类型</span>
            <select
              aria-label="Type 类型"
              value={filters.type}
              onChange={(event) => setFilters((current) => ({ ...current, type: event.target.value as RequestTypeFilter }))}
            >
              <option value="all">全部类型</option>
              <option value="gateway-api">Gateway API</option>
              <option value="visualizer-api">Visualizer API</option>
              <option value="unknown">Unknown</option>
            </select>
          </label>
          <div className="field field-actions requests-filter-actions">
            <span className="field-hint">刷新会重新读取分页窗口与摘要，但不会触发任何写操作。</span>
            <button className="button" type="button" onClick={() => setRefreshNonce((value) => value + 1)}>
              刷新窗口
            </button>
          </div>
        </div>
      </section>

      <section className="shell-panel">
        <div className="table-row">
          <div>
            <div className="table-label">Recent request window</div>
            <h3 className="table-heading">紧凑请求表</h3>
          </div>
          <span className="route-copy">offset {page.offset} · limit {page.limit} · total {page.total}</span>
        </div>
        {filteredItems.length === 0 ? (
          <StateCard
            tone={page.items.length === 0 ? "empty" : "warning"}
            label={page.items.length === 0 ? "空状态" : "筛选结果为空"}
            title={page.items.length === 0 ? "当前窗口没有请求记录" : "筛选后没有匹配请求"}
            detail={page.items.length === 0 ? "当前只读数据源尚未生成可展示的请求遥测。" : "请清除来源、结果或类型筛选条件，以恢复当前窗口的可见结果。"}
          />
        ) : (
          <div className="requests-table-wrap">
            <table className="requests-monitor-table">
              <thead>
                <tr>
                  <th scope="col">Time</th>
                  <th scope="col">Source</th>
                  <th scope="col">Type/Pattern</th>
                  <th scope="col">Method</th>
                  <th scope="col">Path</th>
                  <th scope="col">Result</th>
                  <th scope="col">Status</th>
                  <th scope="col">Latency</th>
                  <th scope="col">Auth</th>
                </tr>
              </thead>
              <tbody>
                {filteredItems.map((record) => {
                  const requestType = detectRequestType(record);
                  const active = record.id === selectedRecord?.id;
                  return (
                    <tr
                      key={record.id}
                      className="request-row"
                      data-active={active ? "true" : "false"}
                      data-request-id={record.id}
                      tabIndex={0}
                      onClick={() => setSelectedRequestId(record.id)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          setSelectedRequestId(record.id);
                        }
                      }}
                    >
                      <td><span className="mono">{formatTimestamp(record.createdAt)}</span></td>
                      <td><span className="monitor-pill" data-tone={record.source === "gateway" ? "source-gateway" : "source-visualizer"}>{formatSource(record.source)}</span></td>
                      <td>
                        <div className="requests-cell-stack">
                          <span className="monitor-pill" data-tone={requestType === "gateway-api" ? "type-gateway" : requestType === "visualizer-api" ? "type-visualizer" : "type-unknown"}>{formatRequestType(requestType)}</span>
                          <span className="mono requests-pattern">{record.routePattern}</span>
                        </div>
                      </td>
                      <td><span className="monitor-pill" data-tone="method">{record.method}</span></td>
                      <td><span className="mono requests-path">{record.path}</span></td>
                      <td><span className="monitor-pill" data-tone={outcomeTone(record)}>{formatOutcome(record.outcome)}</span></td>
                      <td><span className="monitor-pill" data-tone={statusTone(record.statusCode)}>{record.statusCode === null ? "n/a" : String(record.statusCode)}</span></td>
                      <td><span className="mono">{record.latencyMs === null ? "-" : `${record.latencyMs} ms`}</span></td>
                      <td><span className="monitor-pill" data-tone={authTone(record.authType)}>{formatAuth(record.authType)}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <PageControls page={page} busy={pageState.status === "loading"} onChange={setPageRequest} />
      </section>

      <aside className="shell-panel detail-drawer">
        <div className="table-row">
          <div>
            <div className="table-label">Sanitized drawer</div>
            <h3 className="table-heading">请求详情</h3>
          </div>
          {selectedRecord ? <span className="monitor-pill" data-tone="drawer">{selectedRecord.id}</span> : null}
        </div>
        {!selectedRecord ? (
          <EmptyState title="尚未选择请求" detail="点击表格中的任意请求行，即可查看仅包含安全字段的详情抽屉。" />
        ) : (
          <div className="detail-drawer requests-drawer-stack">
            <StateCard tone="loading" label="Sanitized only" title="抽屉不会展示原始载荷" detail="这里只保留 path、route pattern、query key 名、状态码、认证类型和告警代码，不包含 body、headers、raw query 或响应内容。" />
            <div className="memory-meta-grid">
              <MetaPair label="Time" value={formatTimestamp(selectedRecord.createdAt)} mono variant="metric" />
              <MetaPair label="Source" value={formatSource(selectedRecord.source)} variant="metric" />
              <MetaPair label="Method" value={selectedRecord.method} mono variant="metric" />
              <MetaPair label="Result" value={formatOutcome(selectedRecord.outcome)} variant="metric" />
              <MetaPair label="Status" value={selectedRecord.statusCode === null ? "未记录" : String(selectedRecord.statusCode)} mono variant="metric" />
              <MetaPair label="Latency" value={selectedRecord.latencyMs === null ? "未记录" : `${selectedRecord.latencyMs} ms`} variant="metric" />
              <MetaPair label="Auth" value={formatAuth(selectedRecord.authType)} variant="metric" />
              <MetaPair label="Type" value={formatRequestType(detectRequestType(selectedRecord))} variant="metric" />
            </div>
            <article className="table-card">
              <div className="table-row">
                <div>
                  <div className="table-label">Pathname</div>
                  <h3 className="table-heading">{selectedRecord.path}</h3>
                </div>
                <span className="monitor-pill" data-tone="pattern">{selectedRecord.routePattern}</span>
              </div>
              <div className="requests-cell-stack">
                <span className="meta-label">Query Keys</span>
                <div className="requests-pill-list">
                  {selectedRecord.queryKeys.length > 0 ? selectedRecord.queryKeys.map((key) => <span key={key} className="monitor-pill" data-tone="query">{key}</span>) : <span className="route-copy">没有 allowlist query key。</span>}
                </div>
              </div>
              <div className="requests-cell-stack">
                <span className="meta-label">Warning Codes</span>
                <div className="requests-pill-list">
                  {selectedRecord.warningCodes.length > 0 ? selectedRecord.warningCodes.map((code) => <span key={code} className="monitor-pill" data-tone="warning">{code}</span>) : <span className="route-copy">未记录告警代码。</span>}
                </div>
              </div>
            </article>
            {statusNarrative(selectedRecord) ? (
              <article className="state-card" data-tone={selectedRecord.outcome === "error" ? "error" : selectedRecord.outcome === "ok" ? "loading" : "warning"}>
                <div className="meta-label">Observability note</div>
                <strong>只读结果解读</strong>
                <div className="state-copy">{statusNarrative(selectedRecord)}</div>
              </article>
            ) : null}
          </div>
        )}
      </aside>
    </div>
  );
}

function buildSummaryMetrics(summary: RequestTelemetrySummary | null, warningCount: number) {
  if (!summary) {
    return [
      { label: "总请求", value: "-", detail: "等待摘要接口返回。" },
      { label: "24h", value: "-", detail: "等待摘要接口返回。" },
      { label: "错误率", value: "-", detail: "等待摘要接口返回。" },
      { label: "P95 延迟", value: "-", detail: "等待摘要接口返回。" },
      { label: "告警", value: String(warningCount), detail: "摘要暂未就绪。" },
    ] as const;
  }

  return [
    { label: "总请求", value: String(summary.total), detail: "跨 Gateway 与 Visualizer API 合并窗口。" },
    { label: "24h", value: String(summary.last24h), detail: "最近 24 小时内落盘的安全请求数。" },
    { label: "错误率", value: `${Math.round(summary.errorRate * 1000) / 10}%`, detail: `${summary.recent5xx.length} 条最近 5xx 已保留为只读样本。` },
    { label: "P95 延迟", value: summary.p95LatencyMs === null ? "n/a" : `${summary.p95LatencyMs} ms`, detail: "以已脱敏请求记录的 latencyMs 计算。" },
    { label: "告警", value: String(warningCount), detail: warningCount > 0 ? "存在已脱敏的读路径或文件告警。" : "当前没有额外告警。" },
  ] as const;
}

function RequestWarningList({ warnings }: { readonly warnings: readonly RequestTelemetryWarning[] }) {
  return (
    <div className="warning-list">
      {warnings.map((warning) => (
        <article key={`${warning.source}:${warning.code}`} className="state-card" data-tone="warning">
          <div className="state-header">
            <div>
              <div className="meta-label">Telemetry warning</div>
              <strong>{warning.code}</strong>
            </div>
            <span className="monitor-pill" data-tone="warning-source">{warning.source}</span>
          </div>
          <div className="state-copy">{warning.message}</div>
        </article>
      ))}
    </div>
  );
}

function dedupeWarnings(warnings: readonly RequestTelemetryWarning[]): readonly RequestTelemetryWarning[] {
  const seen = new Set<string>();
  return warnings.filter((warning) => {
    const key = `${warning.source}:${warning.code}:${warning.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function matchesFilters(record: SanitizedRequestLog, filters: RequestFilters): boolean {
  if (filters.source !== "all" && record.source !== filters.source) return false;
  if (filters.outcome !== "all" && record.outcome !== filters.outcome) return false;
  if (filters.type !== "all" && detectRequestType(record) !== filters.type) return false;
  return true;
}

function detectRequestType(record: SanitizedRequestLog): RequestTypeFilter {
  if (record.source === "gateway") return "gateway-api";
  if (record.source === "visualizer-api") return "visualizer-api";
  return "unknown";
}

function formatRequestType(value: RequestTypeFilter): string {
  if (value === "gateway-api") return "Gateway API";
  if (value === "visualizer-api") return "Visualizer API";
  if (value === "unknown") return "Unknown";
  return value;
}

function formatSource(source: RequestTelemetrySource): string {
  return source === "gateway" ? "Gateway" : "Visualizer API";
}

function formatOutcome(outcome: SanitizedRequestLog["outcome"]): string {
  if (outcome === "ok") return "OK";
  if (outcome === "unauthorized") return "Unauthorized";
  if (outcome === "error") return "Error";
  if (outcome === "blocked") return "Blocked";
  if (outcome === "aborted") return "Aborted";
  return outcome;
}

function formatAuth(authType: RequestTelemetryAuthType): string {
  if (authType === "visualizer_api_key") return "VIS key";
  if (authType === "gateway_api_key") return "GW key";
  if (authType === "api_key") return "API key";
  if (authType === "local") return "Local";
  if (authType === "none") return "None";
  return "Unknown";
}

function formatTimestamp(value: string): string {
  return value.replace("T", " ").replace(".000Z", "Z");
}

function outcomeTone(record: SanitizedRequestLog): string {
  if (record.outcome === "ok") return "success";
  if (record.outcome === "unauthorized") return "warning";
  if (record.outcome === "error") return "error";
  if (record.outcome === "blocked") return "warning";
  return "muted";
}

function statusTone(statusCode: number | null): string {
  if (statusCode === null) return "muted";
  if (statusCode >= 500) return "error";
  if (statusCode >= 400) return "warning";
  if (statusCode >= 200) return "success";
  return "muted";
}

function authTone(authType: RequestTelemetryAuthType): string {
  if (authType === "none") return "muted";
  if (authType === "local") return "source-visualizer";
  if (authType === "gateway_api_key") return "source-gateway";
  if (authType === "visualizer_api_key" || authType === "api_key") return "method";
  return "warning";
}

function statusNarrative(record: SanitizedRequestLog): string {
  if (record.outcome === "ok") return "该请求在只读监视窗口中表现正常，可结合 path 与 route pattern 对照近期调用热点。";
  if (record.outcome === "unauthorized") return "该请求命中了认证边界。这里只展示认证类型与状态码，不会暴露任何 token 值。";
  if (record.outcome === "error") return "该请求在服务端返回了错误态。请结合 route pattern、来源与延迟判断是 Gateway 还是 Visualizer API 链路异常。";
  if (record.outcome === "blocked") return "该请求被保护边界阻断。只读监视器保留结果分类，但不展示原始访问内容。";
  if (record.outcome === "aborted") return "该请求未完成。只读监视器会保留有限的时间、路径和认证上下文用于排查。";
  return "";
}
