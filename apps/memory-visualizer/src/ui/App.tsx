import mermaid from "mermaid";
import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";

import {
  buildSourceQueryString,
  createDashboardApiClient,
  isDashboardAuthConfigurationError,
  createEmptySourceQueryConfig,
  isDashboardAuthError,
  readSourceQueryConfig,
} from "./api-client";
import { createUiDashboardSummary } from "./dashboard-summary";
import { EvidenceRoute, MemoryExplorerRoute } from "./memory-evidence-panels";
import { PersonaSummaryPanel, RecentSceneUpdatesPanel, SceneMapPanel } from "./persona-scene-panels";
import { createShellStatusModel, hasDegradedCapabilities, summarizeWarnings } from "./status-model";

import type {
  CapabilityStatusValue,
  ConversationEvidence,
  ConversationSearchDebugData,
  DashboardSnapshot,
  GatewayDebugPayload,
  HealthDebugData,
  JsonValue,
  MemorySearchDebugData,
  OffloadCanvas,
  RecallDebugData,
  SceneBlockSummary,
  StructuredMemorySummary,
} from "../contracts/dashboard";
import type { DashboardPage } from "../providers";
import type {
  DashboardApiClient,
  EvidenceLinkIndexEntry,
  GatewayConversationSearchRequest,
  GatewayMemorySearchRequest,
  GatewayRecallRequest,
  OffloadResponse,
  SourceQueryConfig,
} from "./api-client";
import type { ShellStatusModel } from "./status-model";

mermaid.initialize({
  startOnLoad: false,
  securityLevel: "strict",
});

interface RouteDefinition {
  readonly id: string;
  readonly label: string;
  readonly path: string;
  readonly detail: string;
}

interface AsyncState<T> {
  readonly status: "loading" | "ready" | "error";
  readonly data: T | null;
  readonly error: string | null;
}

interface LocationState {
  readonly path: string;
  readonly search: string;
}

interface AppProps {
  readonly apiClient?: DashboardApiClient;
  readonly apiClientFactory?: (getApiKey: () => string | undefined) => DashboardApiClient;
}

interface DashboardLoadState {
  readonly snapshotState: AsyncState<DashboardSnapshot>;
  readonly sceneState: AsyncState<DashboardPage<SceneBlockSummary>>;
  readonly memoryState: AsyncState<DashboardPage<StructuredMemorySummary>>;
  readonly evidenceState: AsyncState<DashboardPage<EvidenceLinkIndexEntry>>;
  readonly conversationState: AsyncState<DashboardPage<ConversationEvidence>>;
  readonly offloadState: AsyncState<OffloadResponse>;
}

type AuthRequirement = "unknown" | "required" | "not-required";

const ROUTES: readonly RouteDefinition[] = [
  { id: "overview", label: "总览", path: "/", detail: "查看只读健康状态、分层覆盖率与时间线背景。" },
  { id: "scene-map", label: "场景图谱 Scene Map", path: "/scene-map", detail: "查看 Scene 密度、热度与关联 Persona 上下文。" },
  { id: "memory-explorer", label: "记忆浏览 Memory Explorer", path: "/memory-explorer", detail: "浏览带有 Evidence 指针的结构化 L1 Memory 卡片。" },
  { id: "evidence", label: "证据下钻 Evidence Drill-down", path: "/evidence-drill-down", detail: "将 Memory 记录回溯到对话 Evidence。" },
  { id: "offload", label: "任务画布 Offload Task Canvas", path: "/offload-task-canvas", detail: "查看 Mermaid Offload 进度、节点与工具引用轨迹。" },
  { id: "debug", label: "调试 Search/Recall Debug", path: "/search-recall-debug", detail: "查看 Gateway 就绪状态、原始调试能力与安全边界说明。" },
  { id: "settings", label: "设置 / 状态", path: "/settings-status", detail: "配置本地只读数据源，并查看能力与环境状态。" },
] as const;

const EMPTY_PAGE: DashboardPage<never> = {
  items: [],
  total: 0,
  offset: 0,
  limit: 50,
};

const VISUALIZER_API_KEY_STORAGE_KEY = "tdai-memory-visualizer-api-key";

export function App({ apiClient, apiClientFactory }: AppProps) {
  const clientFactory = useMemo(
    () => apiClientFactory ?? ((getApiKey: () => string | undefined) => apiClient ?? createDashboardApiClient("", { getApiKey })),
    [apiClient, apiClientFactory],
  );
  const [locationState, setLocationState] = useState<LocationState>(() => readLocationState());
  const [formState, setFormState] = useState<SourceQueryConfig>(() => readSourceQueryConfig(locationState.search));
  const [snapshotState, setSnapshotState] = useState<AsyncState<DashboardSnapshot>>(loadingState());
  const [sceneState, setSceneState] = useState<AsyncState<DashboardPage<SceneBlockSummary>>>(loadingState());
  const [memoryState, setMemoryState] = useState<AsyncState<DashboardPage<StructuredMemorySummary>>>(loadingState());
  const [evidenceState, setEvidenceState] = useState<AsyncState<DashboardPage<EvidenceLinkIndexEntry>>>(loadingState());
  const [conversationState, setConversationState] = useState<AsyncState<DashboardPage<ConversationEvidence>>>(loadingState());
  const [offloadState, setOffloadState] = useState<AsyncState<OffloadResponse>>(loadingState());
  const [authRequirement, setAuthRequirement] = useState<AuthRequirement>("unknown");
  const [activeApiKey, setActiveApiKey] = useState<string | undefined>();
  const [loginKey, setLoginKey] = useState("");
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loginBusy, setLoginBusy] = useState(false);
  const activeApiKeyRef = useRef(activeApiKey);

  activeApiKeyRef.current = activeApiKey;

  const client = useMemo(() => clientFactory(() => activeApiKeyRef.current), [clientFactory]);

  const sourceQuery = useMemo(() => readSourceQueryConfig(locationState.search), [locationState.search]);
  const activeRoute = useMemo(() => resolveRoute(locationState.path), [locationState.path]);
  const selectedSceneId = useMemo(() => readSelectedSceneId(locationState.search), [locationState.search]);
  const selectedMemoryId = useMemo(() => readSelectedMemoryId(locationState.search), [locationState.search]);

  useEffect(() => {
    setFormState(sourceQuery);
  }, [sourceQuery]);

  useEffect(() => {
    const handleLocationChange = () => setLocationState(readLocationState());
    window.addEventListener("popstate", handleLocationChange);
    return () => window.removeEventListener("popstate", handleLocationChange);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const storedApiKey = readStoredVisualizerApiKey();

    if (authRequirement === "required" && !activeApiKey) {
      clearDashboardState(setSnapshotState, setSceneState, setMemoryState, setEvidenceState, setConversationState, setOffloadState);
      return () => {
        cancelled = true;
      };
    }

    setSnapshotState(loadingState());
    setSceneState(loadingState());
    setMemoryState(loadingState());
    setEvidenceState(loadingState());
    setConversationState(loadingState());
    setOffloadState(loadingState());

    const update = async () => {
      const result = await requestDashboardData(client, sourceQuery);

      if (cancelled) return;

      if (result === "auth-not-configured") {
        clearStoredVisualizerApiKey();
        setActiveApiKey(undefined);
        setAuthRequirement("required");
        setLoginBusy(false);
        setLoginError("服务端已要求访问验证，但尚未配置 TDAI_VIS_API_KEY。请先在部署环境中设置共享访问密钥并重启服务。");
        clearDashboardState(setSnapshotState, setSceneState, setMemoryState, setEvidenceState, setConversationState, setOffloadState);
        return;
      }

      if (result === "unauthorized") {
        if (!activeApiKey && authRequirement === "unknown" && storedApiKey) {
          const storedClient = clientFactory(() => storedApiKey);
          const storedResult = await requestDashboardData(storedClient, sourceQuery);

          if (cancelled) return;

          if (storedResult === "auth-not-configured") {
            clearStoredVisualizerApiKey();
            setActiveApiKey(undefined);
            setAuthRequirement("required");
            setLoginBusy(false);
            setLoginError("服务端已要求访问验证，但尚未配置 TDAI_VIS_API_KEY。请先在部署环境中设置共享访问密钥并重启服务。");
            clearDashboardState(setSnapshotState, setSceneState, setMemoryState, setEvidenceState, setConversationState, setOffloadState);
            return;
          }

          if (storedResult !== "unauthorized") {
            setActiveApiKey(storedApiKey);
            setAuthRequirement("required");
            setLoginBusy(false);
            setLoginError(null);
            applyDashboardLoadResult(storedResult, setSnapshotState, setSceneState, setMemoryState, setEvidenceState, setConversationState, setOffloadState);
            return;
          }
        }

        clearStoredVisualizerApiKey();
        setActiveApiKey(undefined);
        setAuthRequirement("required");
        setLoginBusy(false);
        setLoginError(activeApiKey ? "共享访问密钥无效，请重新输入后再验证。" : "此 Memory Visualizer 已启用共享访问密钥，请先登录。");
        clearDashboardState(setSnapshotState, setSceneState, setMemoryState, setEvidenceState, setConversationState, setOffloadState);
        return;
      }

      applyDashboardLoadResult(result, setSnapshotState, setSceneState, setMemoryState, setEvidenceState, setConversationState, setOffloadState);
      setLoginBusy(false);
      setLoginError(null);

      if (activeApiKey) {
        setAuthRequirement("required");
        return;
      }

      clearStoredVisualizerApiKey();
      setAuthRequirement("not-required");
    };

    void update();

    return () => {
      cancelled = true;
    };
  }, [activeApiKey, authRequirement, client, clientFactory, sourceQuery]);

  const statusModel = snapshotState.data ? createShellStatusModel(snapshotState.data) : null;

  const navigate = (path: string) => {
    const nextUrl = buildRouteUrl(path, sourceQuery);
    window.history.pushState({}, "", nextUrl);
    setLocationState(readLocationState());
  };

  const navigateToScene = (sceneId: string) => {
    const nextUrl = buildRouteUrl("/scene-map", sourceQuery, { sceneId });
    window.history.pushState({}, "", nextUrl);
    setLocationState(readLocationState());
  };

  const navigateToMemory = (memoryId: string) => {
    const nextUrl = buildRouteUrl("/evidence-drill-down", sourceQuery, { memoryId });
    window.history.pushState({}, "", nextUrl);
    setLocationState(readLocationState());
  };

  const applySourceSelection = (nextConfig: SourceQueryConfig) => {
    const nextUrl = buildRouteUrl(activeRoute.path, nextConfig);
    window.history.pushState({}, "", nextUrl);
    setLocationState(readLocationState());
  };

  const resetSourceSelection = () => {
    setFormState(createEmptySourceQueryConfig());
    applySourceSelection(createEmptySourceQueryConfig());
  };

  const handleLoginSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const candidate = loginKey.trim();
    if (candidate.length === 0) {
      setLoginError("请输入共享访问密钥。");
      return;
    }

    setLoginBusy(true);
    setLoginError(null);

    const temporaryClient = clientFactory(() => candidate);
    const result = await requestDashboardData(temporaryClient, sourceQuery);

    if (result === "auth-not-configured") {
      setLoginBusy(false);
      setLoginError("服务端尚未配置 TDAI_VIS_API_KEY，当前无法验证共享访问密钥。");
      clearStoredVisualizerApiKey();
      return;
    }

    if (result === "unauthorized") {
      setLoginBusy(false);
      setLoginError("共享访问密钥无效，请检查后重试。");
      clearStoredVisualizerApiKey();
      return;
    }

    storeVisualizerApiKey(candidate);
    setActiveApiKey(candidate);
    setAuthRequirement("required");
    setLoginKey("");
    setLoginBusy(false);
    setLoginError(null);
    applyDashboardLoadResult(result, setSnapshotState, setSceneState, setMemoryState, setEvidenceState, setConversationState, setOffloadState);
  };

  const handleLogout = () => {
    clearStoredVisualizerApiKey();
    setActiveApiKey(undefined);
    setAuthRequirement("required");
    setLoginBusy(false);
    setLoginKey("");
    setLoginError(null);
    clearDashboardState(setSnapshotState, setSceneState, setMemoryState, setEvidenceState, setConversationState, setOffloadState);
  };

  if (authRequirement === "required" && !activeApiKey) {
    return (
      <main className="app-shell">
        <div className="shell-frame">
          <ReadOnlyBanner />
          <section className="hero-panel auth-hero-panel" aria-labelledby="visualizer-title">
            <div className="hero-grid auth-hero-grid">
              <div>
                <div className="eyebrow">仅限本地的白盒可观测性</div>
                <h1 id="visualizer-title" className="hero-heading">
                  TencentDB Agent Memory Visualizer
                </h1>
                <p className="hero-copy">
                  这个只读界面仍会先加载 SPA 外壳，但数据读取继续受 <span className="mono">TDAI_VIS_API_KEY</span> 保护。输入共享访问密钥后，浏览器会对所有 <span className="mono">/api/*</span> 请求附带 Bearer 头，并继续保持只读边界。
                </p>
              </div>
              <form className="path-form auth-panel" onSubmit={handleLoginSubmit}>
                <div className="eyebrow">访问验证</div>
                <h2 className="section-title">输入共享访问密钥</h2>
                <p className="field-hint">
                  仅验证当前浏览器会话。退出登录会清除此会话缓存的密钥，不会改动任何本地 Memory 数据。
                </p>
                <label className="field">
                  <span className="meta-label">共享访问密钥</span>
                  <input
                    aria-label="共享访问密钥"
                    autoComplete="current-password"
                    disabled={loginBusy}
                    type="password"
                    value={loginKey}
                    onChange={(event) => setLoginKey(event.target.value)}
                  />
                </label>
                {loginError ? <ErrorState title="登录失败" detail={loginError} /> : null}
                <div className="form-actions auth-actions">
                  <button className="button" disabled={loginBusy} type="submit">
                    {loginBusy ? "验证中..." : "登录并验证"}
                  </button>
                </div>
              </form>
            </div>
          </section>
        </div>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <div className="shell-frame">
        <ReadOnlyBanner />
        <section className="hero-panel" aria-labelledby="visualizer-title">
          <div className="hero-grid">
            <div>
              <div className="eyebrow">仅限本地的白盒可观测性</div>
              <h1 id="visualizer-title" className="hero-heading">
                TencentDB Agent Memory Visualizer
              </h1>
              <p className="hero-copy">
                 面向 Persona、Scene、Evidence 和 Offload 轨迹的渐进式查看界面。即使本地数据根目录不完整、缺失或部分降级，所有页面仍可继续导航。
              </p>
            </div>
            <div className="shell-panel">
              <div className="eyebrow">使用提醒</div>
              <p className="metric-subtle">
                  这个界面始终通过 <span className="mono">/api/*</span> 读取服务端 DTO。选择数据源只会改变本地只读查询，不表示会对本地数据做任何修改。
              </p>
              <div className="stack-row">
                <span className="meta-label">访问模式</span>
                <span>{activeApiKey ? "共享密钥已验证" : "本地免登录"}</span>
              </div>
              <div className="stack-row">
                <span className="meta-label">当前路由</span>
                <span>{activeRoute.label}</span>
              </div>
              <div className="stack-row">
                <span className="meta-label">数据源查询</span>
                  <span className="mono">{buildSourceQueryString(sourceQuery) || "默认查询"}</span>
              </div>
              {activeApiKey ? (
                <div className="form-actions auth-actions">
                  <button className="button" data-variant="ghost" type="button" onClick={handleLogout}>
                    退出登录
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </section>

        <section className="shell-panel" aria-label="主导航">
          <div className="nav-list">
            {ROUTES.map((route) => (
              <a
                key={route.id}
                className="nav-link"
                href={`${route.path}${buildSourceQueryString(sourceQuery)}`}
                aria-current={route.id === activeRoute.id ? "page" : undefined}
                onClick={(event) => {
                  event.preventDefault();
                  navigate(route.path);
                }}
              >
                <span className="nav-title">{route.label}</span>
                <span className="route-copy">{route.detail}</span>
              </a>
            ))}
          </div>
        </section>

        <section className="route-panel" aria-labelledby="route-heading">
          <header className="stack-row">
            <div>
              <div className="eyebrow">当前页面</div>
              <h2 id="route-heading" className="route-heading">
                {activeRoute.label}
              </h2>
            </div>
            {statusModel ? <CapabilityBadge status={statusSummaryTone(snapshotState.data?.capabilityReport)}>{statusSummaryText(snapshotState.data?.capabilityReport)}</CapabilityBadge> : null}
          </header>
          <p className="route-copy">{activeRoute.detail}</p>
          {renderRoute(activeRoute.id, {
            snapshotState,
            sceneState,
            memoryState,
            evidenceState,
            conversationState,
            offloadState,
            statusModel,
            selectedSceneId,
            formState,
            onFormStateChange: setFormState,
            onApplySourceSelection: applySourceSelection,
            onResetSourceSelection: resetSourceSelection,
            client,
            sourceQuery,
            selectedMemoryId,
            onMemoryNavigate: navigateToMemory,
            getSceneHref: (sceneId: string) => buildRouteUrl("/scene-map", sourceQuery, { sceneId }),
            onSceneNavigate: navigateToScene,
          })}
        </section>
      </div>
    </main>
  );
}

function renderRoute(
  routeId: string,
  model: {
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
  },
) {
  switch (routeId) {
    case "overview":
      return <OverviewRoute {...model} />;
    case "scene-map":
      return <SceneMapRoute {...model} />;
    case "memory-explorer":
      return (
        <MemoryExplorerRoute
          client={model.client}
          sourceQuery={model.sourceQuery}
          snapshotState={model.snapshotState}
          initialMemoryState={model.memoryState}
          selectedMemoryId={model.selectedMemoryId}
          onMemoryNavigate={model.onMemoryNavigate}
        />
      );
    case "evidence":
      return (
        <EvidenceRoute
          client={model.client}
          sourceQuery={model.sourceQuery}
          snapshotState={model.snapshotState}
          initialMemoryState={model.memoryState}
          initialEvidenceState={model.evidenceState}
          initialConversationState={model.conversationState}
          selectedMemoryId={model.selectedMemoryId}
          onMemoryNavigate={model.onMemoryNavigate}
        />
      );
    case "offload":
      return <OffloadRoute offloadState={model.offloadState} snapshotState={model.snapshotState} />;
    case "debug":
      return <DebugRoute client={model.client} sourceQuery={model.sourceQuery} snapshotState={model.snapshotState} />;
    case "settings":
      return <SettingsRoute {...model} />;
    default:
      return <OverviewRoute {...model} />;
  }
}

function OverviewRoute({
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

function SceneMapRoute({
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

function OffloadRoute({
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
                <MetaPair label="已完成 Done" value={String(canvas.doneCount)} />
                <MetaPair label="进行中 Doing" value={String(canvas.doingCount)} />
                <MetaPair label="待处理 Todo" value={String(canvas.todoCount)} />
                <MetaPair label="引用 Refs" value={String(canvas.refs.length)} />
              </div>
              <div className="memory-meta-grid">
                <MetaPair label="创建时间" value={formatOptionalIsoText(canvas.createdTime)} mono />
                <MetaPair label="更新时间" value={formatOptionalIsoText(canvas.updatedTime)} mono />
                <MetaPair label="Canvas ID" value={canvas.canvasId} mono />
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
                  <MetaPair label="节点" value={reference.nodeId ?? "未关联"} mono />
                  <MetaPair label="result_ref" value={reference.resultRef} mono />
                  <MetaPair label="Session" value={reference.sessionKey ?? "未记录"} mono />
                  <MetaPair label="时间戳" value={formatOptionalIsoText(reference.timestamp)} mono />
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

function DebugRoute({
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

function SettingsRoute({
  snapshotState,
  statusModel,
  formState,
  onFormStateChange,
  onApplySourceSelection,
  onResetSourceSelection,
}: {
  readonly snapshotState: AsyncState<DashboardSnapshot>;
  readonly statusModel: ShellStatusModel | null;
  readonly formState: SourceQueryConfig;
  readonly onFormStateChange: (value: SourceQueryConfig) => void;
  readonly onApplySourceSelection: (value: SourceQueryConfig) => void;
  readonly onResetSourceSelection: () => void;
}) {
  return (
    <div className="route-grid">
      <PathConfigurationForm
        value={formState}
        onChange={onFormStateChange}
        onSubmit={onApplySourceSelection}
        onReset={onResetSourceSelection}
      />
      <section className="shell-panel">
        <h3 className="section-title">当前状态概览</h3>
        {snapshotState.status === "loading" ? <LoadingState title="正在加载数据源状态" detail="正在等待当前数据源 metadata。" /> : null}
        {snapshotState.status === "error" ? <ErrorState title="状态模型不可用" detail={snapshotState.error ?? "数据源状态请求失败。"} /> : null}
        {statusModel ? (
          <div className="detail-grid">
            <article className="metric-card">
              <div className="meta-label">数据源标签</div>
              <div className="metric-subtle">{statusModel.sourceLabel}</div>
            </article>
            <article className="metric-card">
              <div className="meta-label">数据根目录</div>
              <div className="metric-subtle mono">{statusModel.dataRoot || "未配置"}</div>
            </article>
            <article className="metric-card">
              <div className="meta-label">Offload 根目录</div>
              <div className="metric-subtle mono">{statusModel.offloadRoot || "未配置"}</div>
            </article>
            <article className="metric-card">
              <div className="meta-label">环境输入</div>
              <div className="metric-subtle mono">{statusModel.environmentInputs.join(", ") || "无"}</div>
            </article>
          </div>
        ) : null}
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
              <MetaPair label="检查时间" value={formatOptionalIsoText(payload.checkedAt)} mono />
              <MetaPair label="延迟" value={payload.latencyMs === null ? "未记录" : `${payload.latencyMs} ms`} />
              <MetaPair label="告警" value={payload.warning ?? "无"} />
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

function MetaPair({ label, value, mono = false }: { readonly label: string; readonly value: string; readonly mono?: boolean }) {
  return (
    <article className="metric-card">
      <div className="meta-label">{label}</div>
      <div className={mono ? "metric-subtle mono" : "metric-subtle"}>{value}</div>
    </article>
  );
}

function StatusBadge({ status, children }: { readonly status: CapabilityStatusValue; readonly children: ReactNode }) {
  return <CapabilityBadge status={status}>{children}</CapabilityBadge>;
}

function StateCard({
  tone,
  label,
  title,
  detail,
}: {
  readonly tone: "warning" | "error" | "loading" | "empty";
  readonly label: string;
  readonly title: string;
  readonly detail: string;
}) {
  return (
    <article className="state-card" data-tone={tone}>
      <div className="meta-label">{label}</div>
      <strong>{title}</strong>
      <div className="state-copy">{detail}</div>
    </article>
  );
}

function PathConfigurationForm({
  value,
  onChange,
  onSubmit,
  onReset,
}: {
  readonly value: SourceQueryConfig;
  readonly onChange: (value: SourceQueryConfig) => void;
  readonly onSubmit: (value: SourceQueryConfig) => void;
  readonly onReset: () => void;
}) {
  return (
    <form
      className="path-form"
      aria-label="路径配置表单"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(value);
      }}
    >
      <div className="eyebrow">仅选择本地只读数据源</div>
      <h3 className="section-title">路径配置</h3>
      <p className="field-hint">
        通过查询路径选择，你可以查看配置根目录下的其他本地文件夹。这个界面只会更新读取查询，不会写入本地数据。
      </p>
      <div className="field-grid">
        <label className="field">
          <span>数据目录覆盖</span>
          <input
            name="dataDir"
            value={value.dataDir}
            onChange={(event) => onChange({ ...value, dataDir: event.target.value })}
            placeholder="example-subdir"
          />
        </label>
        <label className="field">
          <span>Offload 根目录覆盖</span>
          <input
            name="offloadRootPath"
            value={value.offloadRootPath}
            onChange={(event) => onChange({ ...value, offloadRootPath: event.target.value })}
            placeholder="offload/agent-planner"
          />
        </label>
        <label className="field">
          <span>数据源标签</span>
          <input
            name="sourceLabel"
            value={value.sourceLabel}
            onChange={(event) => onChange({ ...value, sourceLabel: event.target.value })}
            placeholder="local-memory"
          />
        </label>
      </div>
      <div className="form-actions">
        <button className="button" type="submit">
          应用数据源选择
        </button>
        <button className="button" data-variant="ghost" type="button" onClick={onReset}>
          清除数据源查询
        </button>
      </div>
    </form>
  );
}

function CapabilityCard({
  label,
  detail,
  status,
  sourcePath,
}: {
  readonly label: string;
  readonly detail: string | null;
  readonly status: CapabilityStatusValue;
  readonly sourcePath: string | null;
}) {
  return (
    <article className="capability-card">
      <div className="capability-header">
        <strong>{localizeCapabilityLabel(label)}</strong>
        <CapabilityBadge status={status}>{translateCapabilityStatus(status)}</CapabilityBadge>
      </div>
      <div className="route-copy">{localizeCapabilityDetail(detail) ?? "可进行只读查看。"}</div>
      <div className="mono">{sourcePath ?? "未记录源路径。"}</div>
    </article>
  );
}

function CapabilityBadge({ status, children }: { readonly status: CapabilityStatusValue; readonly children: ReactNode }) {
  return (
    <span className="capability-badge" data-status={status}>
      {children}
    </span>
  );
}

function ReadOnlyBanner() {
  return (
    <section className="readonly-banner" aria-label="只读模式横幅">
      <strong>只读模式</strong>
      <span>
        这个可视化界面只会通过应用内本地 API DTO 查看现有 Memory 产物。无论是导航、路径选择还是状态卡片，都不会把任何内容持久化回本地存储。
      </span>
    </section>
  );
}

function DataRouteSection<T>({
  title,
  state,
  emptyTitle,
  emptyDetail,
  render,
}: {
  readonly title: string;
  readonly state: AsyncState<T>;
  readonly emptyTitle: string;
  readonly emptyDetail: string;
  readonly render: (value: T) => ReactNode;
}) {
  if (state.status === "loading") {
    return <LoadingState title={`正在加载${title}`} detail="正在从应用内本地 API 请求路由数据。" />;
  }

  if (state.status === "error") {
    return <ErrorState title={`${title}不可用`} detail={state.error ?? "请求失败。"} />;
  }

  if (isEmptyData(state.data)) {
    return <EmptyState title={emptyTitle} detail={emptyDetail} />;
  }

  if (!state.data) {
    return <EmptyState title={emptyTitle} detail={emptyDetail} />;
  }

  return <section className="shell-panel">{render(state.data)}</section>;
}

function LoadingState({ title, detail }: { readonly title: string; readonly detail: string }) {
  return (
    <article className="state-card" data-tone="loading">
      <div className="meta-label">加载中</div>
      <strong>{title}</strong>
      <div className="state-copy">{detail}</div>
    </article>
  );
}

function ErrorState({ title, detail }: { readonly title: string; readonly detail: string }) {
  return (
    <article className="state-card" data-tone="error">
      <div className="meta-label">错误</div>
      <strong>{title}</strong>
      <div className="state-copy">{detail}</div>
    </article>
  );
}

function WarningState({ title, detail }: { readonly title: string; readonly detail: string }) {
  return (
    <article className="state-card" data-tone="warning">
      <div className="meta-label">告警</div>
      <strong>{title}</strong>
      <div className="state-copy">{detail}</div>
    </article>
  );
}

function EmptyState({ title, detail }: { readonly title: string; readonly detail: string }) {
  return (
    <article className="state-card" data-tone="empty">
      <div className="meta-label">空状态</div>
      <strong>{title}</strong>
      <div className="state-copy">{detail}</div>
    </article>
  );
}

function readyState<T>(): AsyncState<T> {
  return { status: "ready", data: null, error: null };
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

function resolveGatewayStatus(payload: GatewayDebugPayload<unknown> | null | undefined): CapabilityStatusValue {
  if (!payload) return "disabled";
  if (payload.warning) return payload.httpStatus !== null && payload.httpStatus >= 500 ? "error" : "partial";
  if (payload.ok) return "available";
  return payload.httpStatus !== null && payload.httpStatus >= 500 ? "error" : "partial";
}

function sanitizeMemorySearchRequest(request: GatewayMemorySearchRequest): GatewayMemorySearchRequest {
  return {
    query: request.query,
    ...(typeof request.limit === "number" ? { limit: request.limit } : {}),
    ...(request.type?.trim() ? { type: request.type.trim() } : {}),
    ...(request.scene?.trim() ? { scene: request.scene.trim() } : {}),
  };
}

function sanitizeConversationSearchRequest(request: GatewayConversationSearchRequest): GatewayConversationSearchRequest {
  return {
    query: request.query,
    ...(request.session_key?.trim() ? { session_key: request.session_key.trim() } : {}),
    ...(typeof request.limit === "number" ? { limit: request.limit } : {}),
  };
}

function readOptionalInteger(value: string): number | undefined {
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0) return undefined;
  return Math.floor(parsed);
}

function readCanvasMetadataText(metadata: DashboardSnapshot["offloadCanvases"][number]["rawMetadata"], key: string): string {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return "";
  const value = (metadata as { readonly [name: string]: JsonValue })[key];
  return typeof value === "string" ? value : "";
}

function formatOptionalIsoText(value: string | null): string {
  if (!value) return "未记录";
  return value.replace("T", " ").replace(".000Z", "Z");
}

function hashPreview(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return String(hash);
}

function resolveRoute(path: string): RouteDefinition {
  return ROUTES.find((route) => route.path === path) ?? ROUTES[0];
}

function readLocationState(): LocationState {
  return {
    path: window.location.pathname,
    search: window.location.search,
  };
}

function readSelectedSceneId(search: string): string | null {
  const value = new URLSearchParams(search).get("sceneId")?.trim() ?? "";
  return value.length > 0 ? value : null;
}

function readSelectedMemoryId(search: string): string | null {
  const value = new URLSearchParams(search).get("memoryId")?.trim() ?? "";
  return value.length > 0 ? value : null;
}

function loadingState<T>(): AsyncState<T> {
  return { status: "loading", data: null, error: null };
}

function clearDashboardState(
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

async function requestDashboardData(client: DashboardApiClient, sourceQuery: SourceQueryConfig): Promise<DashboardLoadState | "unauthorized" | "auth-not-configured"> {
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

function applyDashboardLoadResult(
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

function isEmptyData(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value !== "object") return false;
  if ("items" in value && Array.isArray((value as { items?: unknown[] }).items)) return ((value as { items: unknown[] }).items).length === 0;
  if ("canvases" in value && "references" in value) {
    const offload = value as OffloadResponse;
    return offload.canvases.items.length === 0 && offload.references.items.length === 0;
  }
  return false;
}

function statusSummaryTone(report: DashboardSnapshot["capabilityReport"] | undefined): CapabilityStatusValue {
  if (!report) return "disabled";
  if (hasDegradedCapabilities(report)) {
    return Object.values(report).some((value) => typeof value === "object" && value !== null && "status" in value && value.status === "error") ? "error" : "partial";
  }
  return "available";
}

function statusSummaryText(report: DashboardSnapshot["capabilityReport"] | undefined): string {
  if (!report) return "加载中";
  return hasDegradedCapabilities(report) ? "能力降级" : "可用";
}

function translateAsyncStatus(status: AsyncState<unknown>["status"]): string {
  if (status === "loading") return "加载中";
  if (status === "ready") return "就绪";
  if (status === "error") return "错误";
  return status;
}

function translateCapabilityStatus(status: CapabilityStatusValue): string {
  if (status === "available") return "可用";
  if (status === "partial") return "部分可用";
  if (status === "missing") return "缺失";
  if (status === "disabled") return "未启用";
  if (status === "error") return "错误";
  return status;
}

function translateSeverity(severity: DashboardSnapshot["warnings"][number]["severity"]): string {
  if (severity === "warning") return "告警";
  if (severity === "error") return "错误";
  if (severity === "info") return "信息";
  return severity;
}

function localizeCapabilityLabel(label: string): string {
  const mapping: Record<string, string> = {
    "Persona profile": "Persona 档案",
    "Scene blocks": "Scene 块",
    "Structured L1 memories": "结构化 L1 Memory",
    "Conversation L0 evidence": "对话 L0 Evidence",
    "Offload canvas": "Offload 画布",
    "Gateway health": "Gateway 健康状态",
    "Gateway search": "Gateway 搜索",
    "Gateway recall": "Gateway Recall",
  };
  return mapping[label] ?? label;
}

function localizeCapabilityDetail(detail: string | null): string | null {
  if (!detail) return detail;
  if (detail.startsWith("Missing data: ")) return `缺少数据：${detail.slice("Missing data: ".length)}`;
  if (detail.startsWith("Parsed with warnings: ")) return `解析完成，但有告警：${detail.slice("Parsed with warnings: ".length)}`;
  if (detail === "Gateway is not configured.") return "Gateway 未配置。";
  if (detail === "Offload root is not configured or not present.") return "Offload 根目录未配置或不存在。";
  if (detail === "No data was parsed.") return "未解析到数据。";
  if (detail === "Persona file was not found.") return "未找到 Persona 文件。";
  if (detail === "Gateway debug route is configured; run a live probe in Search/Recall Debug.") return "已配置 Gateway 调试路由，请在 Search/Recall Debug 中执行实时探测。";
  return detail;
}

function buildRouteUrl(path: string, sourceQuery: SourceQueryConfig, extras: { readonly sceneId?: string; readonly memoryId?: string } = {}): string {
  const params = new URLSearchParams(buildSourceQueryString(sourceQuery).replace(/^\?/, ""));
  if (extras.sceneId && extras.sceneId.trim().length > 0) params.set("sceneId", extras.sceneId.trim());
  else params.delete("sceneId");
  if (extras.memoryId && extras.memoryId.trim().length > 0) params.set("memoryId", extras.memoryId.trim());
  else params.delete("memoryId");
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}

function readStoredVisualizerApiKey(): string | undefined {
  try {
    const value = window.sessionStorage.getItem(VISUALIZER_API_KEY_STORAGE_KEY)?.trim();
    return value ? value : undefined;
  } catch (error) {
    void error;
    return undefined;
  }
}

function storeVisualizerApiKey(value: string): void {
  try {
    window.sessionStorage.setItem(VISUALIZER_API_KEY_STORAGE_KEY, value);
  } catch (error) {
    void error;
  }
}

function clearStoredVisualizerApiKey(): void {
  try {
    window.sessionStorage.removeItem(VISUALIZER_API_KEY_STORAGE_KEY);
  } catch (error) {
    void error;
  }
}
