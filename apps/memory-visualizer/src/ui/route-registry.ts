import type { RouteDefinition } from "./app-types";

export const ROUTES: readonly RouteDefinition[] = [
  { id: "overview", label: "总览", path: "/", detail: "查看只读健康状态、分层覆盖率与时间线背景。" },
  { id: "requests-monitor", label: "请求监视 Requests Monitor", path: "/requests-monitor", detail: "查看只读请求遥测、来源分布与最近请求窗口。" },
  { id: "scene-map", label: "场景图谱 Scene Map", path: "/scene-map", detail: "查看 Scene 密度、热度与关联 Persona 上下文。" },
  { id: "memory-explorer", label: "记忆浏览 Memory Explorer", path: "/memory-explorer", detail: "浏览带有 Evidence 指针的结构化 L1 Memory 卡片。" },
  { id: "evidence", label: "证据下钻 Evidence Drill-down", path: "/evidence-drill-down", detail: "将 Memory 记录回溯到对话 Evidence。" },
  { id: "offload", label: "任务画布 Offload Task Canvas", path: "/offload-task-canvas", detail: "查看 Mermaid Offload 进度、节点与工具引用轨迹。" },
  { id: "debug", label: "调试 Search/Recall Debug", path: "/search-recall-debug", detail: "查看 Gateway 就绪状态、原始调试能力与安全边界说明。" },
  { id: "settings", label: "设置 / 状态", path: "/settings-status", detail: "配置本地只读数据源，并查看能力与环境状态。" },
] as const;

export function resolveRoute(path: string): RouteDefinition {
  return ROUTES.find((route) => route.path === path) ?? ROUTES[0];
}

export type { RouteDefinition };
