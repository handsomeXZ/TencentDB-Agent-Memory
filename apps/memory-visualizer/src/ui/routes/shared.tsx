import type { CapabilityStatusValue, DashboardSnapshot, GatewayDebugPayload } from "../../contracts/dashboard";
import type { GatewayConversationSearchRequest, GatewayMemorySearchRequest } from "../api-client";
import type { AsyncState } from "../dashboard-data";
import { CapabilityBadge } from "../components";
import { hasDegradedCapabilities } from "../status-model";

export function CapabilityCard({
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



export function formatOptionalIsoText(value: string | null): string {
  if (!value) return "未记录";
  return value.replace("T", " ").replace(".000Z", "Z");
}



export function statusSummaryTone(report: DashboardSnapshot["capabilityReport"] | undefined): CapabilityStatusValue {
  if (!report) return "disabled";
  if (hasDegradedCapabilities(report)) {
    return Object.values(report).some((value) => typeof value === "object" && value !== null && "status" in value && value.status === "error") ? "error" : "partial";
  }
  return "available";
}



export function statusSummaryText(report: DashboardSnapshot["capabilityReport"] | undefined): string {
  if (!report) return "加载中";
  return hasDegradedCapabilities(report) ? "能力降级" : "可用";
}



export function translateAsyncStatus(status: AsyncState<unknown>["status"]): string {
  if (status === "loading") return "加载中";
  if (status === "ready") return "就绪";
  if (status === "error") return "错误";
  return status;
}



export function translateSeverity(severity: DashboardSnapshot["warnings"][number]["severity"]): string {
  if (severity === "warning") return "告警";
  if (severity === "error") return "错误";
  if (severity === "info") return "信息";
  return severity;
}



export function resolveGatewayStatus(payload: GatewayDebugPayload<unknown> | null | undefined): CapabilityStatusValue {
  if (!payload) return "disabled";
  if (payload.warning) return payload.httpStatus !== null && payload.httpStatus >= 500 ? "error" : "partial";
  if (payload.ok) return "available";
  return payload.httpStatus !== null && payload.httpStatus >= 500 ? "error" : "partial";
}



export function sanitizeMemorySearchRequest(request: GatewayMemorySearchRequest): GatewayMemorySearchRequest {
  return {
    query: request.query,
    ...(typeof request.limit === "number" ? { limit: request.limit } : {}),
    ...(request.type?.trim() ? { type: request.type.trim() } : {}),
    ...(request.scene?.trim() ? { scene: request.scene.trim() } : {}),
  };
}



export function sanitizeConversationSearchRequest(request: GatewayConversationSearchRequest): GatewayConversationSearchRequest {
  return {
    query: request.query,
    ...(request.session_key?.trim() ? { session_key: request.session_key.trim() } : {}),
    ...(typeof request.limit === "number" ? { limit: request.limit } : {}),
  };
}



export function readOptionalInteger(value: string): number | undefined {
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0) return undefined;
  return Math.floor(parsed);
}



function translateCapabilityStatus(status: CapabilityStatusValue): string {
  if (status === "available") return "可用";
  if (status === "partial") return "部分可用";
  if (status === "missing") return "缺失";
  if (status === "disabled") return "未启用";
  if (status === "error") return "错误";
  return status;
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

