import { useEffect, useMemo, useState } from "react";

import { createEmptySourceQueryConfig, readSourceQueryConfig } from "../api-client";
import { buildRouteUrl, readLocationState, readSelectedMemoryId, readSelectedSceneId } from "../navigation";
import { resolveRoute } from "../route-registry";

import type { LocationState } from "../dashboard-data";
import type { SourceQueryConfig } from "../api-client";

export function useSourceQuery() {
  const [locationState, setLocationState] = useState<LocationState>(() => readLocationState());
  const [formState, setFormState] = useState<SourceQueryConfig>(() => readSourceQueryConfig(locationState.search));

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

  return {
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
    getSceneHref: (sceneId: string) => buildRouteUrl("/scene-map", sourceQuery, { sceneId }),
  };
}
