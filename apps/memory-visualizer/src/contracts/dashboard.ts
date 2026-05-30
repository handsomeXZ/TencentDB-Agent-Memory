export type JsonPrimitive = string | number | boolean | null;

export type JsonValue = JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue };

export type CapabilityStatusValue = "available" | "missing" | "partial" | "error" | "disabled";

export const CAPABILITY_STATUS_VALUES = [
  "available",
  "missing",
  "partial",
  "error",
  "disabled",
] as const satisfies readonly CapabilityStatusValue[];

export type ParserWarningSeverity = "info" | "warning" | "error";

export type OffloadNodeStatus = "done" | "doing" | "todo" | "unknown";

/** Read-only provider boundary for app-local dashboard DTOs. */
export interface DashboardDataProvider {
  readonly getSnapshot: (config: DataSourceConfig) => Promise<DashboardSnapshot>;
  readonly getCapabilities: (config: DataSourceConfig) => Promise<CapabilityReport>;
}

/** Read-only source inputs used by later fixture/parser/provider tasks. */
export interface DataSourceConfig {
  readonly sourceLabel: string;
  readonly memoryRootPath: string;
  readonly profilesPath: string;
  readonly scenesPath: string;
  readonly l1DatabasePath: string;
  readonly l0DatabasePath: string;
  readonly offloadRootPath: string;
  readonly gatewayBaseUrl: string | null;
  readonly gatewayApiKeyEnv: string | null;
  readonly readOnly: true;
  readonly environmentInputs: readonly string[];
}

export interface CapabilityState {
  readonly status: CapabilityStatusValue;
  readonly label: string;
  readonly detail: string | null;
  readonly checkedAt: string | null;
  readonly sourcePath: string | null;
  readonly warningCodes: readonly string[];
}

export interface CapabilityReport {
  readonly generatedAt: string;
  readonly persona: CapabilityState;
  readonly scenes: CapabilityState;
  readonly structuredMemories: CapabilityState;
  readonly conversationEvidence: CapabilityState;
  readonly offloadCanvas: CapabilityState;
  readonly gatewayHealth: CapabilityState;
  readonly gatewaySearch: CapabilityState;
  readonly gatewayRecall: CapabilityState;
}

export interface PersonaSummary {
  readonly profileId: string;
  readonly filename: string;
  readonly available: boolean;
  readonly title: string;
  readonly contentSummary: string;
  readonly contentPreview: string;
  readonly contentMd5: string;
  readonly agentId: string | null;
  readonly version: number;
  readonly createdAtMs: number | null;
  readonly updatedAtMs: number | null;
  readonly sourcePath: string;
  readonly sceneIds: readonly string[];
  readonly rawMetadata: JsonValue | null;
}

export interface SceneBlockSummary {
  readonly sceneId: string;
  readonly filename: string;
  readonly title: string;
  readonly contentSummary: string;
  readonly contentPreview: string;
  readonly heatScore: number;
  readonly memoryCount: number;
  readonly updatedAtMs: number | null;
  readonly sourcePath: string;
  readonly relatedPersonaIds: readonly string[];
  readonly evidenceRecordIds: readonly string[];
  readonly rawMetadata: JsonValue | null;
}

export interface StructuredMemorySummary {
  readonly recordId: string;
  readonly content: string;
  readonly contentPreview: string;
  readonly type: string;
  readonly priority: number;
  readonly sceneName: string;
  readonly sessionKey: string;
  readonly sessionId: string;
  readonly sourceId: string;
  readonly timestampLabel: string;
  readonly timestampStart: string;
  readonly timestampEnd: string;
  readonly createdTime: string;
  readonly updatedTime: string;
  readonly score: number | null;
  readonly evidenceIds: readonly string[];
  readonly rawMetadata: JsonValue | null;
}

export interface ConversationEvidence {
  readonly recordId: string;
  readonly sessionKey: string;
  readonly sessionId: string;
  readonly role: string;
  readonly snippet: string;
  readonly recordedAt: string;
  readonly timestamp: number;
  readonly score: number | null;
  readonly sourceMemoryIds: readonly string[];
}

export interface OffloadCanvasNode {
  readonly nodeId: string;
  readonly label: string;
  readonly status: OffloadNodeStatus;
  readonly summary: string;
  readonly timestamp: string | null;
}

export interface OffloadReference {
  readonly toolCallId: string;
  readonly nodeId: string | null;
  readonly toolCall: string;
  readonly summary: string;
  readonly resultRef: string;
  readonly timestamp: string;
  readonly sessionKey: string | null;
  readonly score: number | null;
}

export interface OffloadCanvas {
  readonly canvasId: string;
  readonly filename: string;
  readonly path: string;
  readonly taskGoal: string;
  readonly createdTime: string | null;
  readonly updatedTime: string | null;
  readonly doneCount: number;
  readonly doingCount: number;
  readonly todoCount: number;
  readonly nodes: readonly OffloadCanvasNode[];
  readonly refs: readonly OffloadReference[];
  readonly rawMetadata: JsonValue | null;
}

export interface GatewayDebugPayload<T> {
  readonly ok: boolean;
  readonly endpoint: "/health" | "/recall" | "/search/memories" | "/search/conversations";
  readonly checkedAt: string;
  readonly latencyMs: number | null;
  readonly httpStatus: number | null;
  readonly data: T | null;
  readonly warning: string | null;
}

export interface HealthDebugData {
  readonly status: "ok" | "degraded";
  readonly version: string;
  readonly uptime: number;
  readonly stores: {
    readonly vectorStore: boolean;
    readonly embeddingService: boolean;
  };
}

export interface RecallDebugData {
  readonly context: string;
  readonly strategy?: string;
  readonly memory_count?: number;
}

export interface MemorySearchDebugData {
  readonly results: string;
  readonly total: number;
  readonly strategy: string;
}

export interface ConversationSearchDebugData {
  readonly results: string;
  readonly total: number;
}

export interface GatewayDebugState {
  readonly status: CapabilityStatusValue;
  readonly label: string;
  readonly checkedAt: string | null;
  readonly latencyMs: number | null;
  readonly httpStatus: number | null;
  readonly detail: string | null;
}

export interface GatewayStatus {
  readonly baseUrl: string | null;
  readonly health: GatewayDebugState;
  readonly search: GatewayDebugState;
  readonly recall: GatewayDebugState;
}

export interface ParserWarning {
  readonly source: string;
  readonly code: string;
  readonly severity: ParserWarningSeverity;
  readonly message: string;
  readonly location: string | null;
  readonly rawValue: JsonValue | null;
}

/** Serializable read-only dashboard payload intended for future /api/* responses. */
export interface DashboardSnapshot {
  readonly snapshotId: string;
  readonly generatedAt: string;
  readonly dataSource: DataSourceConfig;
  readonly capabilityReport: CapabilityReport;
  readonly persona: PersonaSummary | null;
  readonly scenes: readonly SceneBlockSummary[];
  readonly structuredMemories: readonly StructuredMemorySummary[];
  readonly conversationEvidence: readonly ConversationEvidence[];
  readonly offloadCanvases: readonly OffloadCanvas[];
  readonly gateway: GatewayStatus;
  readonly warnings: readonly ParserWarning[];
}

export function createDefaultDataSourceConfig(
  overrides: Partial<Omit<DataSourceConfig, "readOnly">> = {},
): DataSourceConfig {
  return {
    sourceLabel: "local-memory",
    memoryRootPath: "",
    profilesPath: "",
    scenesPath: "",
    l1DatabasePath: "",
    l0DatabasePath: "",
    offloadRootPath: "",
    gatewayBaseUrl: null,
    gatewayApiKeyEnv: null,
    readOnly: true,
    environmentInputs: [],
    ...overrides,
  };
}

export function createCapabilityState(
  label: string,
  status: CapabilityStatusValue = "missing",
  detail: string | null = null,
): CapabilityState {
  return {
    status,
    label,
    detail,
    checkedAt: null,
    sourcePath: null,
    warningCodes: [],
  };
}

export function createDefaultCapabilityReport(generatedAt: string): CapabilityReport {
  return {
    generatedAt,
    persona: createCapabilityState("Persona profile"),
    scenes: createCapabilityState("Scene blocks"),
    structuredMemories: createCapabilityState("Structured L1 memories"),
    conversationEvidence: createCapabilityState("Conversation L0 evidence"),
    offloadCanvas: createCapabilityState("Offload canvas"),
    gatewayHealth: createCapabilityState("Gateway health", "disabled"),
    gatewaySearch: createCapabilityState("Gateway search", "disabled"),
    gatewayRecall: createCapabilityState("Gateway recall", "disabled"),
  };
}

export function createDefaultGatewayStatus(baseUrl: string | null = null): GatewayStatus {
  const disabledState: GatewayDebugState = {
    status: "disabled",
    label: "Gateway not configured",
    checkedAt: null,
    latencyMs: null,
    httpStatus: null,
    detail: null,
  };

  return {
    baseUrl,
    health: disabledState,
    search: disabledState,
    recall: disabledState,
  };
}

export function createEmptyDashboardSnapshot(
  generatedAt: string,
  dataSource: DataSourceConfig = createDefaultDataSourceConfig(),
): DashboardSnapshot {
  return {
    snapshotId: `snapshot:${generatedAt}`,
    generatedAt,
    dataSource,
    capabilityReport: createDefaultCapabilityReport(generatedAt),
    persona: null,
    scenes: [],
    structuredMemories: [],
    conversationEvidence: [],
    offloadCanvases: [],
    gateway: createDefaultGatewayStatus(dataSource.gatewayBaseUrl),
    warnings: [],
  };
}
