import { buildSourceQueryString } from "./api-client";
import { ROUTES } from "./route-registry";

import type { RouteDefinition } from "./route-registry";
import type { SourceQueryConfig } from "./api-client";
import type { LocationState } from "./dashboard-data";

export interface NavigationGroup {
  readonly id: string;
  readonly label: string;
  readonly detail: string;
  readonly routes: readonly RouteDefinition[];
}

const routeById = new Map(ROUTES.map((route) => [route.id, route]));

export const NAVIGATION_GROUPS: readonly NavigationGroup[] = [
  {
    id: "overview",
    label: "Overview",
    detail: "入口与当前健康概览。",
    routes: [requireRoute("overview")],
  },
  {
    id: "observability",
    label: "Observability",
    detail: "只读请求观测与运行态采样。",
    routes: [requireRoute("requests-monitor")],
  },
  {
    id: "explore",
    label: "Explore",
    detail: "浏览 Persona、Scene 与结构化记忆。",
    routes: [requireRoute("scene-map"), requireRoute("memory-explorer")],
  },
  {
    id: "trace",
    label: "Trace",
    detail: "沿 Evidence 与 Offload 轨迹下钻。",
    routes: [requireRoute("evidence"), requireRoute("offload")],
  },
  {
    id: "debug",
    label: "Debug",
    detail: "执行只读调试探测与原始响应查看。",
    routes: [requireRoute("debug")],
  },
  {
    id: "system",
    label: "System",
    detail: "配置本地只读数据源与环境状态。",
    routes: [requireRoute("settings")],
  },
] as const;

export function buildRouteUrl(path: string, sourceQuery: SourceQueryConfig, extras: { readonly sceneId?: string; readonly memoryId?: string } = {}): string {
  const params = new URLSearchParams(buildSourceQueryString(sourceQuery).replace(/^\?/, ""));
  if (extras.sceneId && extras.sceneId.trim().length > 0) params.set("sceneId", extras.sceneId.trim());
  else params.delete("sceneId");
  if (extras.memoryId && extras.memoryId.trim().length > 0) params.set("memoryId", extras.memoryId.trim());
  else params.delete("memoryId");
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}

export function readLocationState(): LocationState {
  return { path: window.location.pathname, search: window.location.search };
}

export function readSelectedSceneId(search: string): string | null {
  const value = new URLSearchParams(search).get("sceneId")?.trim() ?? "";
  return value.length > 0 ? value : null;
}

export function readSelectedMemoryId(search: string): string | null {
  const value = new URLSearchParams(search).get("memoryId")?.trim() ?? "";
  return value.length > 0 ? value : null;
}

function requireRoute(routeId: RouteDefinition["id"]): RouteDefinition {
  const route = routeById.get(routeId);
  if (!route) throw new Error(`Unknown route id: ${routeId}`);
  return route;
}
