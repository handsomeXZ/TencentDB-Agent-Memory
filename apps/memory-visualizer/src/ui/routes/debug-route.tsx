import { useEffect, useState } from "react";
import type { ReactNode } from "react";

import type { ConversationSearchDebugData, DashboardSnapshot, GatewayDebugPayload, HealthDebugData, MemorySearchDebugData, RecallDebugData } from "../../contracts/dashboard";
import type { DashboardApiClient, GatewayConversationSearchRequest, GatewayMemorySearchRequest, GatewayRecallRequest, SourceQueryConfig } from "../api-client";
import type { AsyncState } from "../dashboard-data";
import { EmptyState, ErrorState, LoadingState, MetaPair, StatusBadge } from "../components";
import { loadingState, readyState } from "../dashboard-data";
import { CapabilityCard, formatOptionalIsoText, readOptionalInteger, resolveGatewayStatus, sanitizeConversationSearchRequest, sanitizeMemorySearchRequest, translateAsyncStatus } from "./shared";

export function DebugRoute({
  client,
  sourceQuery,
  snapshotState,
}: {
  readonly client: DashboardApiClient;
  readonly sourceQuery: SourceQueryConfig;
  readonly snapshotState: AsyncState<DashboardSnapshot>;
}) {
  const [healthState, setHealthState] = useState<AsyncState<GatewayDebugPayload<HealthDebugData>>>(loadingState());
  const [recallState, setRecallState] = useState<AsyncState<GatewayDebugPayload<RecallDebugData>>>(readyState());
  const [memorySearchState, setMemorySearchState] = useState<AsyncState<GatewayDebugPayload<MemorySearchDebugData>>>(readyState());
  const [conversationSearchState, setConversationSearchState] = useState<AsyncState<GatewayDebugPayload<ConversationSearchDebugData>>>(readyState());
  const [recallRequest, setRecallRequest] = useState<GatewayRecallRequest>({ query: "", session_key: "" });
  const [memorySearchRequest, setMemorySearchRequest] = useState<GatewayMemorySearchRequest>({ query: "", limit: 5, type: "", scene: "" });
  const [conversationSearchRequest, setConversationSearchRequest] = useState<GatewayConversationSearchRequest>({ query: "", session_key: "", limit: 5 });

  useEffect(() => {
    let cancelled = false;
    const request = async () => {
      setHealthState(loadingState());
      try {
        const data = await client.getGatewayHealth(sourceQuery);
        if (!cancelled) setHealthState({ status: "ready", data, error: null });
      } catch (error) {
        if (!cancelled) setHealthState({ status: "error", data: null, error: error instanceof Error ? error.message : String(error) });
      }
    };
    void request();
    return () => {
      cancelled = true;
    };
  }, [client, sourceQuery]);

  if (snapshotState.status === "loading") {
    return <LoadingState title="正在加载 Gateway 调试状态" detail="正在读取 Gateway 能力 DTO 并探测应用内本地调试端点。" />;
  }

  if (snapshotState.status === "error") {
    return <ErrorState title="Gateway 调试状态不可用" detail={snapshotState.error ?? "快照请求失败。"} />;
  }

  const snapshot = snapshotState.data;
  if (!snapshot) {
    return <EmptyState title="没有 Gateway 调试数据" detail="快照中不包含任何 Gateway 状态数据。" />;
  }

  return (
    <div className="route-grid debug-route-layout">
      <section className="shell-panel">
        <div className="table-row">
          <div>
            <div className="table-label">Gateway 状态</div>
            <h3 className="table-heading">健康状态与安全端点范围</h3>
          </div>
          <StatusBadge status={resolveGatewayStatus(healthState.data)}>{healthState.data?.endpoint ?? "/health"}</StatusBadge>
        </div>
        <p className="route-copy">
          Gateway 调试仅用于观察。这个界面只会通过应用内本地 API DTO 暴露 <span className="mono">/health</span>、<span className="mono">/recall</span>、<span className="mono">/search/memories</span> 和 <span className="mono">/search/conversations</span>，绝不会调用可写端点。
        </p>
        <div className="capability-grid">
          <CapabilityCard label={snapshot.capabilityReport.gatewayHealth.label} detail={snapshot.capabilityReport.gatewayHealth.detail} status={snapshot.capabilityReport.gatewayHealth.status} sourcePath={snapshot.gateway.baseUrl} />
           <CapabilityCard label={snapshot.capabilityReport.gatewaySearch.label} detail="搜索结果会以原始格式化调试文本展示，而不是结构化主数据卡片。" status={snapshot.capabilityReport.gatewaySearch.status} sourcePath={snapshot.gateway.baseUrl} />
          <CapabilityCard label={snapshot.capabilityReport.gatewayRecall.label} detail={snapshot.capabilityReport.gatewayRecall.detail} status={snapshot.capabilityReport.gatewayRecall.status} sourcePath={snapshot.gateway.baseUrl} />
        </div>
        <DebugResponsePanel title="Gateway 健康探测" submittedRequest={{ method: "GET", endpoint: "/api/gateway/health" }} state={healthState} responseHint="健康探测会返回实时 Gateway DTO，或受控的告警载荷。" rawSearchText={null} />
      </section>

      <GatewayDebugFormSection
        title="Recall 调试"
        description="提交安全的 Recall 载荷，并在不修改 Memory 状态的前提下查看返回的上下文摘要。"
        submitLabel="运行 Recall"
        state={recallState}
        onSubmit={async () => {
          setRecallState(loadingState());
          try {
            const data = await client.runGatewayRecallDebug(sourceQuery, recallRequest);
            setRecallState({ status: "ready", data, error: null });
          } catch (error) {
            setRecallState({ status: "error", data: null, error: error instanceof Error ? error.message : String(error) });
          }
        }}
        requestSummary={{ method: "POST", endpoint: "/api/gateway/recall-debug", body: recallRequest }}
        fields={
          <div className="field-grid">
            <label className="field">
                <span>Recall 查询</span>
                <input aria-label="Recall 查询" value={recallRequest.query} onChange={(event) => setRecallRequest({ ...recallRequest, query: event.target.value })} placeholder="workspace constraints" />
              </label>
              <label className="field">
                <span>Session key</span>
                <input aria-label="Session key" value={recallRequest.session_key} onChange={(event) => setRecallRequest({ ...recallRequest, session_key: event.target.value })} placeholder="agent:fixture-agent:session-alpha" />
              </label>
              <label className="field">
                <span>User ID（可选）</span>
                <input aria-label="User ID（可选）" value={recallRequest.user_id ?? ""} onChange={(event) => setRecallRequest({ ...recallRequest, user_id: event.target.value.trim() || undefined })} placeholder="fixture-user" />
              </label>
            </div>
        }
      />

      <GatewayDebugFormSection
        title="Memory 搜索调试"
        description="搜索调试会保留 Gateway 返回的原始字符串载荷。结果面板会把它标记为原始格式化调试文本，而不是 Memory 卡片。"
        submitLabel="运行 Memory 搜索"
        state={memorySearchState}
        onSubmit={async () => {
          setMemorySearchState(loadingState());
          try {
            const data = await client.runGatewayMemorySearchDebug(sourceQuery, sanitizeMemorySearchRequest(memorySearchRequest));
            setMemorySearchState({ status: "ready", data, error: null });
          } catch (error) {
            setMemorySearchState({ status: "error", data: null, error: error instanceof Error ? error.message : String(error) });
          }
        }}
        requestSummary={{ method: "POST", endpoint: "/api/gateway/search-memories-debug", body: sanitizeMemorySearchRequest(memorySearchRequest) }}
        rawSearchText={memorySearchState.data?.data?.results ?? null}
        fields={
          <div className="field-grid">
            <label className="field">
                <span>Memory 搜索查询</span>
                <input aria-label="Memory 搜索查询" value={memorySearchRequest.query} onChange={(event) => setMemorySearchRequest({ ...memorySearchRequest, query: event.target.value })} placeholder="workspace" />
              </label>
              <label className="field">
                <span>结果上限 Limit</span>
                <input aria-label="Memory 搜索结果上限 Limit" value={String(memorySearchRequest.limit ?? "")} onChange={(event) => setMemorySearchRequest({ ...memorySearchRequest, limit: readOptionalInteger(event.target.value) })} placeholder="5" />
              </label>
              <label className="field">
                <span>Type（可选）</span>
                <input aria-label="Type（可选）" value={memorySearchRequest.type ?? ""} onChange={(event) => setMemorySearchRequest({ ...memorySearchRequest, type: event.target.value })} placeholder="persona" />
              </label>
              <label className="field">
                <span>Scene（可选）</span>
                <input aria-label="Scene（可选）" value={memorySearchRequest.scene ?? ""} onChange={(event) => setMemorySearchRequest({ ...memorySearchRequest, scene: event.target.value })} placeholder="Contract design" />
              </label>
            </div>
        }
      />

      <GatewayDebugFormSection
        title="Conversation 搜索调试"
        description="Conversation 搜索保持为诊断界面。它会并排展示原始 Gateway transcript 字符串，以及超时或错误告警。"
        submitLabel="运行 Conversation 搜索"
        state={conversationSearchState}
        onSubmit={async () => {
          setConversationSearchState(loadingState());
          try {
            const data = await client.runGatewayConversationSearchDebug(sourceQuery, sanitizeConversationSearchRequest(conversationSearchRequest));
            setConversationSearchState({ status: "ready", data, error: null });
          } catch (error) {
            setConversationSearchState({ status: "error", data: null, error: error instanceof Error ? error.message : String(error) });
          }
        }}
        requestSummary={{ method: "POST", endpoint: "/api/gateway/search-conversations-debug", body: sanitizeConversationSearchRequest(conversationSearchRequest) }}
        rawSearchText={conversationSearchState.data?.data?.results ?? null}
        fields={
          <div className="field-grid">
            <label className="field">
                <span>Conversation 搜索查询</span>
                <input aria-label="Conversation 搜索查询" value={conversationSearchRequest.query} onChange={(event) => setConversationSearchRequest({ ...conversationSearchRequest, query: event.target.value })} placeholder="workspace" />
              </label>
              <label className="field">
                <span>Session key（可选）</span>
                <input aria-label="Session key（可选）" value={conversationSearchRequest.session_key ?? ""} onChange={(event) => setConversationSearchRequest({ ...conversationSearchRequest, session_key: event.target.value })} placeholder="agent:fixture-agent:session-alpha" />
              </label>
              <label className="field">
                <span>结果上限 Limit</span>
                <input aria-label="Conversation 搜索结果上限 Limit" value={String(conversationSearchRequest.limit ?? "")} onChange={(event) => setConversationSearchRequest({ ...conversationSearchRequest, limit: readOptionalInteger(event.target.value) })} placeholder="5" />
              </label>
            </div>
        }
      />
    </div>
  );
}



function GatewayDebugFormSection<T extends GatewayDebugPayload<unknown>>({
  title,
  description,
  submitLabel,
  fields,
  state,
  onSubmit,
  requestSummary,
  rawSearchText = null,
}: {
  readonly title: string;
  readonly description: string;
  readonly submitLabel: string;
  readonly fields: ReactNode;
  readonly state: AsyncState<T>;
  readonly onSubmit: () => void;
  readonly requestSummary: { readonly method: string; readonly endpoint: string; readonly body?: object };
  readonly rawSearchText?: string | null;
}) {
  return (
    <section className="shell-panel">
      <div className="table-row">
        <div>
          <div className="table-label">Gateway 调试表单</div>
          <h3 className="table-heading">{title}</h3>
        </div>
        <StatusBadge status={state.status === "error" ? "error" : state.status === "loading" ? "partial" : "available"}>{translateAsyncStatus(state.status)}</StatusBadge>
      </div>
      <p className="route-copy">{description}</p>
      <form
        className="debug-form-stack"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        {fields}
        <div className="form-actions">
          <button className="button" type="submit">
            {submitLabel}
          </button>
        </div>
      </form>
      <DebugResponsePanel title={title} submittedRequest={requestSummary} state={state} responseHint="请求与响应面板是安全的应用内本地 Gateway 调试 API 的 DTO 镜像。" rawSearchText={rawSearchText} />
    </section>
  );
}



function DebugResponsePanel<T extends GatewayDebugPayload<unknown>>({
  title,
  submittedRequest,
  state,
  responseHint,
  rawSearchText,
}: {
  readonly title: string;
  readonly submittedRequest: { readonly method: string; readonly endpoint: string; readonly body?: object };
  readonly state: AsyncState<T>;
  readonly responseHint: string;
  readonly rawSearchText: string | null;
}) {
  const payload = state.data;

  return (
    <div className="offload-detail-stack">
      <article className="table-card">
        <div className="table-row">
          <div>
              <div className="table-label">请求</div>
              <h3 className="table-heading">{title}</h3>
          </div>
          <span className="mono">{submittedRequest.method} {submittedRequest.endpoint}</span>
        </div>
        <pre className="json-hint">{JSON.stringify(submittedRequest.body ?? {}, null, 2)}</pre>
      </article>
      {state.status === "loading" ? <LoadingState title="正在等待 Gateway 响应" detail={responseHint} /> : null}
      {state.status === "error" ? <ErrorState title="Gateway 调试请求失败" detail={state.error ?? "Gateway 调试请求失败。"} /> : null}
      {state.status === "ready" && payload !== null ? (
        <article className="table-card">
          <div className="table-row">
            <div>
                <div className="table-label">响应</div>
                <h3 className="table-heading">{payload.endpoint}</h3>
              </div>
              <StatusBadge status={resolveGatewayStatus(payload)}>{payload.httpStatus === null ? "无 HTTP 状态" : `HTTP ${payload.httpStatus}`}</StatusBadge>
            </div>
            <div className="memory-meta-grid">
              <MetaPair label="检查时间" value={formatOptionalIsoText(payload.checkedAt)} mono variant="metric" />
              <MetaPair label="延迟" value={payload.latencyMs === null ? "未记录" : `${payload.latencyMs} ms`} variant="metric" />
              <MetaPair label="告警" value={payload.warning ?? "无"} variant="metric" />
            </div>
            <pre className="json-hint">{JSON.stringify(payload, null, 2)}</pre>
            {rawSearchText ? (
              <article className="state-card" data-tone="warning">
                <div className="meta-label">原始格式化调试文本</div>
                <strong>`/search/*` 主响应保持原样</strong>
                <pre className="json-hint">{rawSearchText}</pre>
              </article>
            ) : null}
        </article>
      ) : null}
    </div>
  );
}

