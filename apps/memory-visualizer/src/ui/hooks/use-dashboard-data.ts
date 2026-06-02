import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";

import { createDashboardApiClient } from "../api-client";
import { clearStoredVisualizerApiKey, readStoredVisualizerApiKey, storeVisualizerApiKey } from "../auth-storage";
import { applyDashboardLoadResult, clearDashboardState, loadingState, requestDashboardData } from "../dashboard-data";
import { createShellStatusModel } from "../status-model";

import type { ConversationEvidence, DashboardSnapshot, SceneBlockSummary, StructuredMemorySummary } from "../../contracts/dashboard";
import type { DashboardPage } from "../../providers";
import type { AsyncState, AuthRequirement } from "../dashboard-data";
import type { DashboardApiClient, EvidenceLinkIndexEntry, OffloadResponse, SourceQueryConfig } from "../api-client";

interface UseDashboardDataProps {
  readonly apiClient?: DashboardApiClient;
  readonly apiClientFactory?: (getApiKey: () => string | undefined) => DashboardApiClient;
  readonly sourceQuery: SourceQueryConfig;
}

export function useDashboardData({ apiClient, apiClientFactory, sourceQuery }: UseDashboardDataProps) {
  const clientFactory = useMemo(
    () => apiClientFactory ?? ((getApiKey: () => string | undefined) => apiClient ?? createDashboardApiClient("", { getApiKey })),
    [apiClient, apiClientFactory],
  );
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

  return {
    activeApiKey,
    authRequirement,
    client,
    conversationState,
    evidenceState,
    handleLoginSubmit,
    handleLogout,
    loginBusy,
    loginError,
    loginKey,
    memoryState,
    offloadState,
    sceneState,
    setLoginKey,
    statusModel: snapshotState.data ? createShellStatusModel(snapshotState.data) : null,
    snapshotState,
  };
}
