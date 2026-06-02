export type RouteId = "overview" | "requests-monitor" | "scene-map" | "memory-explorer" | "evidence" | "offload" | "debug" | "settings";

export interface RouteDefinition {
  readonly id: RouteId;
  readonly label: string;
  readonly path: string;
  readonly detail: string;
}
