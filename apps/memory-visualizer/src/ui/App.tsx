import { useMemo } from "react";

import { AppShell } from "./app-shell";
import { AuthGate } from "./auth-gate";
import { useDashboardData } from "./hooks/use-dashboard-data";
import { useSourceQuery } from "./hooks/use-source-query";
import { buildRouteUrl } from "./navigation";
import { renderRoute } from "./routes/app-routes";
import { createShellStatusModel } from "./status-model";

import type { DashboardApiClient } from "./api-client";

interface AppProps {
  readonly apiClient?: DashboardApiClient;
  readonly apiClientFactory?: (getApiKey: () => string | undefined) => DashboardApiClient;
}

export function App({ apiClient, apiClientFactory }: AppProps) {
  const {
    activeRoute,
    applySourceSelection,
    formState,
    navigate,
    navigateToMemory,
    navigateToScene,
    resetSourceSelection,
    selectedMemoryId,
    selectedSceneId,
    setFormState,
    sourceQuery,
  } = useSourceQuery();
  const dashboard = useDashboardData({ apiClient, apiClientFactory, sourceQuery });
  const statusModel = useMemo(() => (dashboard.snapshotState.data ? createShellStatusModel(dashboard.snapshotState.data) : null), [dashboard.snapshotState.data]);

  if (dashboard.authRequirement === "required" && !dashboard.activeApiKey) {
    return (
      <AuthGate
        loginBusy={dashboard.loginBusy}
        loginError={dashboard.loginError}
        loginKey={dashboard.loginKey}
        onLoginKeyChange={dashboard.setLoginKey}
        onLoginSubmit={dashboard.handleLoginSubmit}
      />
    );
  }

  return (
    <AppShell
      activeApiKey={dashboard.activeApiKey}
      activeRoute={activeRoute}
      onLogout={dashboard.handleLogout}
      onNavigate={navigate}
      snapshotState={dashboard.snapshotState}
      sourceQuery={sourceQuery}
      statusModel={statusModel}
    >
      {renderRoute(activeRoute.id, {
        snapshotState: dashboard.snapshotState,
        sceneState: dashboard.sceneState,
        memoryState: dashboard.memoryState,
        evidenceState: dashboard.evidenceState,
        conversationState: dashboard.conversationState,
        offloadState: dashboard.offloadState,
        statusModel,
        selectedSceneId,
        formState,
        onFormStateChange: setFormState,
        onApplySourceSelection: applySourceSelection,
        onResetSourceSelection: resetSourceSelection,
        client: dashboard.client,
        sourceQuery,
        selectedMemoryId,
        onMemoryNavigate: navigateToMemory,
        getSceneHref: (sceneId: string) => buildRouteUrl("/scene-map", sourceQuery, { sceneId }),
        onSceneNavigate: navigateToScene,
      })}
    </AppShell>
  );
}
