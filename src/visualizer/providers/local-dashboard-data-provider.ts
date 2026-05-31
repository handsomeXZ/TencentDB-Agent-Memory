import { stat } from "node:fs/promises";
import path from "node:path";

import {
  createDefaultCapabilityReport,
  createDefaultDataSourceConfig,
  createDefaultGatewayStatus,
  createEmptyDashboardSnapshot,
} from "../contracts/dashboard";
import { createDataSourceConfigFromRoot, parseLocalMemorySource } from "../parsers";

import type {
  CapabilityReport,
  CapabilityState,
  CapabilityStatusValue,
  ConversationEvidence,
  DashboardDataProvider,
  DashboardSnapshot,
  DataSourceConfig,
  JsonValue,
  OffloadCanvas,
  OffloadReference,
  ParserWarning,
  SceneBlockSummary,
  StructuredMemorySummary,
} from "../contracts/dashboard";

export interface LocalDashboardProviderConfig {
  readonly dataDir?: string;
  readonly offloadRootPath?: string;
  readonly sourceLabel?: string;
  readonly gatewayBaseUrl?: string | null;
  readonly gatewayApiKeyEnv?: string | null;
}

export interface LocalDashboardRequestConfig extends LocalDashboardProviderConfig {
  readonly generatedAt?: string;
  readonly snapshotId?: string;
}

export interface DashboardPage<T> {
  readonly items: readonly T[];
  readonly total: number;
  readonly offset: number;
  readonly limit: number;
}

export interface DistributionBucket {
  readonly label: string;
  readonly count: number;
}

export interface PriorityDistributionBucket {
  readonly priority: number;
  readonly count: number;
}

export interface SceneHeatItem {
  readonly sceneId: string;
  readonly title: string;
  readonly heatScore: number;
  readonly memoryCount: number;
}

export interface RecentUpdateItem {
  readonly id: string;
  readonly layer: "persona" | "scene" | "memory" | "conversation" | "offload";
  readonly label: string;
  readonly timestamp: string;
}

export interface EvidenceLinkIndexEntry {
  readonly memoryRecordId: string;
  readonly evidenceIds: readonly string[];
  readonly evidenceRecords: readonly ConversationEvidence[];
}

export interface OffloadCanvasSummary {
  readonly canvasId: string;
  readonly taskGoal: string;
  readonly nodeCount: number;
  readonly referenceCount: number;
  readonly doneCount: number;
  readonly doingCount: number;
  readonly todoCount: number;
  readonly updatedTime: string | null;
}

export interface DashboardAggregationSummary {
  readonly counts: {
    readonly persona: number;
    readonly scenes: number;
    readonly structuredMemories: number;
    readonly conversationEvidence: number;
    readonly offloadCanvases: number;
    readonly offloadReferences: number;
    readonly warnings: number;
  };
  readonly typeDistribution: readonly DistributionBucket[];
  readonly priorityDistribution: readonly PriorityDistributionBucket[];
  readonly sceneHeatList: readonly SceneHeatItem[];
  readonly recentUpdateTimeline: readonly RecentUpdateItem[];
  readonly capabilityStatuses: CapabilityReport;
  readonly evidenceLinkIndex: readonly EvidenceLinkIndexEntry[];
  readonly offloadCanvasSummaries: readonly OffloadCanvasSummary[];
  readonly warningCodes: readonly DistributionBucket[];
}

const DATA_DIR_ENV_KEYS = [
  "TDAI_VIS_DATA_DIR",
  "MEMORY_VISUALIZER_DATA_DIR",
  "MEMORY_TENCENTDB_HOME",
  "MEMORY_TENCENTDB_DATA_DIR",
  "TDAI_MEMORY_ROOT",
] as const;

const OFFLOAD_ENV_KEYS = ["TDAI_VIS_OFFLOAD_ROOT", "MEMORY_VISUALIZER_OFFLOAD_ROOT", "TDAI_OFFLOAD_ROOT"] as const;
const GATEWAY_BASE_URL_ENV_KEYS = ["TDAI_VIS_GATEWAY_URL", "MEMORY_VISUALIZER_GATEWAY_BASE_URL", "TDAI_GATEWAY_BASE_URL"] as const;
const GATEWAY_API_KEY_ENV_KEYS = ["TDAI_VIS_GATEWAY_API_KEY", "TDAI_GATEWAY_API_KEY", "MEMORY_TENCENTDB_GATEWAY_API_KEY"] as const;

const BLOCKED_RAW_FIELD_NAME_PARTS: readonly (readonly string[])[] = [
  ["embed", "ding"],
  ["vec", "tor"],
  ["l1", "_", "vec"],
  ["l0", "_", "vec"],
] as const;

const DEFAULT_PAGE_LIMIT = 50;

export class LocalDashboardDataProvider implements DashboardDataProvider {
  private readonly appConfig: LocalDashboardProviderConfig;
  private readonly env: NodeJS.ProcessEnv;
  private readonly now: () => Date;

  public constructor(options: {
    readonly appConfig?: LocalDashboardProviderConfig;
    readonly env?: NodeJS.ProcessEnv;
    readonly now?: () => Date;
  } = {}) {
    this.appConfig = options.appConfig ?? {};
    this.env = options.env ?? process.env;
    this.now = options.now ?? (() => new Date());
  }

  public async getSnapshot(config: DataSourceConfig): Promise<DashboardSnapshot>;
  public async getSnapshot(config?: LocalDashboardRequestConfig): Promise<DashboardSnapshot>;
  public async getSnapshot(config: DataSourceConfig | LocalDashboardRequestConfig = {}): Promise<DashboardSnapshot> {
    const resolved = this.resolveConfig(config);
    const generatedAt = readGeneratedAt(config, this.now);
    const noDataWarning = await this.resolveNoDataWarning(resolved);

    if (noDataWarning !== null) {
      const snapshot = createEmptyDashboardSnapshot(generatedAt, resolved);
      const warnings = [noDataWarning];
      const capabilityReport = this.createCapabilityReport(generatedAt, resolved, {
        persona: null,
        scenes: [],
        structuredMemories: [],
        conversationEvidence: [],
        offloadCanvases: [],
        warnings,
      });
      return {
        ...snapshot,
        snapshotId: readSnapshotId(config, generatedAt),
        capabilityReport,
        warnings,
      };
    }

    const parsed = await parseLocalMemorySource(resolved);
    const offloadWarning = await this.createOffloadDisabledWarning(resolved);
    const warnings = [...parsed.warnings, ...optionalWarning(offloadWarning)].map(sanitizeWarning);
    const offloadDisabled = await this.isOffloadDisabled(resolved);
    const capabilityReport = this.createCapabilityReport(generatedAt, resolved, { ...parsed, warnings, offloadDisabled });

    return {
      snapshotId: readSnapshotId(config, generatedAt),
      generatedAt,
      dataSource: resolved,
      capabilityReport,
      persona: parsed.persona ? { ...parsed.persona, rawMetadata: sanitizeJsonValue(parsed.persona.rawMetadata) } : null,
      scenes: parsed.scenes.map((scene) => ({ ...scene, rawMetadata: sanitizeJsonValue(scene.rawMetadata) })),
      structuredMemories: parsed.structuredMemories.map((memory) => ({
        ...memory,
        rawMetadata: sanitizeJsonValue(memory.rawMetadata),
      })),
      conversationEvidence: parsed.conversationEvidence,
      offloadCanvases: parsed.offloadCanvases.map((canvas) => ({
        ...canvas,
        rawMetadata: sanitizeJsonValue(canvas.rawMetadata),
      })),
      gateway: createDefaultGatewayStatus(resolved.gatewayBaseUrl),
      warnings,
    };
  }

  public async getCapabilities(config: DataSourceConfig): Promise<CapabilityReport>;
  public async getCapabilities(config?: LocalDashboardRequestConfig): Promise<CapabilityReport>;
  public async getCapabilities(config: DataSourceConfig | LocalDashboardRequestConfig = {}): Promise<CapabilityReport> {
    const snapshot = await this.getSnapshot(config);
    return snapshot.capabilityReport;
  }

  public resolveConfig(config: DataSourceConfig | LocalDashboardRequestConfig = {}): DataSourceConfig {
    if (isDataSourceConfig(config) && config.memoryRootPath.trim() !== "") {
      return {
        ...config,
        environmentInputs: [...config.environmentInputs, ...this.detectGatewayEnvironmentInputs(config.gatewayApiKeyEnv)],
      };
    }

    const dataDir = this.resolveFirstPath([
      isDataSourceConfig(config) ? config.memoryRootPath : config.dataDir,
      this.readEnvPath(DATA_DIR_ENV_KEYS).value,
      this.appConfig.dataDir,
    ]);
    const sourceLabel = readRequestSourceLabel(config) ?? this.appConfig.sourceLabel;
    const offloadRootPath = this.resolveFirstPath([
      isDataSourceConfig(config) ? config.offloadRootPath : config.offloadRootPath,
      this.readEnvPath(OFFLOAD_ENV_KEYS).value,
      this.appConfig.offloadRootPath,
      dataDir ? path.join(dataDir, "offload") : "",
    ]);
    const gatewayBaseUrl = readRequestGatewayBaseUrl(config) ?? this.readEnvPath(GATEWAY_BASE_URL_ENV_KEYS).value ?? this.appConfig.gatewayBaseUrl ?? null;
    const gatewayApiKeyEnv = readRequestGatewayApiKeyEnv(config) ?? this.detectFirstPresentEnvName(GATEWAY_API_KEY_ENV_KEYS) ?? this.appConfig.gatewayApiKeyEnv;
    const environmentInputs = uniqueValues([
      ...optionalString(this.readEnvPath(DATA_DIR_ENV_KEYS).key),
      ...optionalString(this.readEnvPath(OFFLOAD_ENV_KEYS).key),
      ...optionalString(this.readEnvPath(GATEWAY_BASE_URL_ENV_KEYS).key),
      ...optionalString(gatewayApiKeyEnv),
    ]);

    if (!dataDir) {
      return createDefaultDataSourceConfig({
        sourceLabel: sourceLabel ?? "local-memory",
        gatewayBaseUrl,
        gatewayApiKeyEnv,
        environmentInputs,
      });
    }

    return createDataSourceConfigFromRoot(dataDir, {
      sourceLabel: sourceLabel ?? (path.basename(dataDir) || "local-memory"),
      offloadRootPath,
      gatewayBaseUrl,
      gatewayApiKeyEnv,
      environmentInputs,
    });
  }

  public async getAggregation(config: DataSourceConfig | LocalDashboardRequestConfig = {}): Promise<DashboardAggregationSummary> {
    const snapshot = await this.getSnapshot(config);
    return createAggregationSummary(snapshot);
  }

  public async getStructuredMemoriesPage(
    config: DataSourceConfig | LocalDashboardRequestConfig = {},
    page: Partial<Pick<DashboardPage<StructuredMemorySummary>, "offset" | "limit">> = {},
  ): Promise<DashboardPage<StructuredMemorySummary>> {
    const snapshot = await this.getSnapshot(config);
    return paginate(snapshot.structuredMemories, page.offset, page.limit);
  }

  public async getConversationEvidencePage(
    config: DataSourceConfig | LocalDashboardRequestConfig = {},
    page: Partial<Pick<DashboardPage<ConversationEvidence>, "offset" | "limit">> = {},
  ): Promise<DashboardPage<ConversationEvidence>> {
    const snapshot = await this.getSnapshot(config);
    return paginate(snapshot.conversationEvidence, page.offset, page.limit);
  }

  public async getOffloadCanvasesPage(
    config: DataSourceConfig | LocalDashboardRequestConfig = {},
    page: Partial<Pick<DashboardPage<OffloadCanvas>, "offset" | "limit">> = {},
  ): Promise<DashboardPage<OffloadCanvas>> {
    const snapshot = await this.getSnapshot(config);
    return paginate(snapshot.offloadCanvases, page.offset, page.limit);
  }

  public async getOffloadReferencesPage(
    config: DataSourceConfig | LocalDashboardRequestConfig = {},
    page: Partial<Pick<DashboardPage<OffloadReference>, "offset" | "limit">> = {},
  ): Promise<DashboardPage<OffloadReference>> {
    const snapshot = await this.getSnapshot(config);
    return paginate(snapshot.offloadCanvases.flatMap((canvas) => canvas.refs), page.offset, page.limit);
  }

  public async getEvidenceLinkIndex(
    config: DataSourceConfig | LocalDashboardRequestConfig = {},
  ): Promise<readonly EvidenceLinkIndexEntry[]> {
    const snapshot = await this.getSnapshot(config);
    return createEvidenceLinkIndex(snapshot.structuredMemories, snapshot.conversationEvidence);
  }

  private createCapabilityReport(
    generatedAt: string,
    config: DataSourceConfig,
    parsed: {
      readonly persona: DashboardSnapshot["persona"];
      readonly scenes: readonly SceneBlockSummary[];
      readonly structuredMemories: readonly StructuredMemorySummary[];
      readonly conversationEvidence: readonly ConversationEvidence[];
      readonly offloadCanvases: readonly OffloadCanvas[];
      readonly warnings: readonly ParserWarning[];
      readonly offloadDisabled?: boolean;
    },
  ): CapabilityReport {
    const report = createDefaultCapabilityReport(generatedAt);
    const offloadDisabled = parsed.offloadDisabled ?? (config.offloadRootPath.trim() === "" || warningCodesFor(parsed.warnings, "offload-root-disabled").length > 0);

    return {
      generatedAt,
      persona: createLayerCapability({
        label: report.persona.label,
        sourcePath: config.profilesPath || config.memoryRootPath || null,
        hasData: parsed.persona !== null,
        warnings: warningsForLayer(parsed.warnings, config.profilesPath, ["persona"]),
      }),
      scenes: createLayerCapability({
        label: report.scenes.label,
        sourcePath: config.scenesPath || null,
        hasData: parsed.scenes.length > 0,
        warnings: warningsForLayer(parsed.warnings, config.scenesPath, ["scene"]),
      }),
      structuredMemories: createLayerCapability({
        label: report.structuredMemories.label,
        sourcePath: config.l1DatabasePath || null,
        hasData: parsed.structuredMemories.length > 0,
        warnings: warningsForLayer(parsed.warnings, config.l1DatabasePath, ["memory"]),
      }),
      conversationEvidence: createLayerCapability({
        label: report.conversationEvidence.label,
        sourcePath: config.l0DatabasePath || null,
        hasData: parsed.conversationEvidence.length > 0,
        warnings: warningsForLayer(parsed.warnings, config.l0DatabasePath, ["conversation"]),
      }),
      offloadCanvas: offloadDisabled
        ? {
            status: "disabled",
            label: report.offloadCanvas.label,
            detail: "Offload root is not configured or not present.",
            checkedAt: generatedAt,
            sourcePath: config.offloadRootPath || null,
            warningCodes: warningCodesFor(parsed.warnings, "offload-root-disabled"),
          }
        : createLayerCapability({
            label: report.offloadCanvas.label,
            sourcePath: config.offloadRootPath || null,
            hasData: parsed.offloadCanvases.length > 0,
            warnings: warningsForLayer(parsed.warnings, config.offloadRootPath, ["offload"]),
          }),
      gatewayHealth: createGatewayCapability(report.gatewayHealth.label, config.gatewayBaseUrl, generatedAt),
      gatewaySearch: createGatewayCapability(report.gatewaySearch.label, config.gatewayBaseUrl, generatedAt),
      gatewayRecall: createGatewayCapability(report.gatewayRecall.label, config.gatewayBaseUrl, generatedAt),
    };
  }

  private async resolveNoDataWarning(config: DataSourceConfig): Promise<ParserWarning | null> {
    if (config.memoryRootPath.trim() === "") {
      return createProviderWarning("", "data-dir-missing", "Memory data directory is not configured.", null);
    }

    if (!(await pathExists(config.memoryRootPath))) {
      return createProviderWarning(config.memoryRootPath, "data-dir-missing", "Memory data directory was not found.", null);
    }

    return null;
  }

  private async createOffloadDisabledWarning(config: DataSourceConfig): Promise<ParserWarning | null> {
    if (config.offloadRootPath.trim() === "") {
      return createProviderWarning("", "offload-root-disabled", "Offload root is not configured.", null, "info");
    }

    return null;
  }

  private async isOffloadDisabled(config: DataSourceConfig): Promise<boolean> {
    return config.offloadRootPath.trim() === "" || !(await pathExists(config.offloadRootPath));
  }

  private resolveFirstPath(values: readonly (string | null | undefined)[]): string {
    const value = values.find((item) => typeof item === "string" && item.trim() !== "");
    return value ? path.resolve(value) : "";
  }

  private readEnvPath(keys: readonly string[]): { readonly key: string | null; readonly value: string | null } {
    for (const key of keys) {
      const value = this.env[key];
      if (typeof value === "string" && value.trim() !== "") return { key, value };
    }
    return { key: null, value: null };
  }

  private detectFirstPresentEnvName(keys: readonly string[]): string | null {
    return this.readEnvPath(keys).key;
  }

  private detectGatewayEnvironmentInputs(gatewayApiKeyEnv: string | null): readonly string[] {
    return gatewayApiKeyEnv && this.env[gatewayApiKeyEnv] ? [gatewayApiKeyEnv] : [];
  }
}

export function createLocalDashboardDataProvider(options?: {
  readonly appConfig?: LocalDashboardProviderConfig;
  readonly env?: NodeJS.ProcessEnv;
  readonly now?: () => Date;
}): LocalDashboardDataProvider {
  return new LocalDashboardDataProvider(options);
}

export function createAggregationSummary(snapshot: DashboardSnapshot): DashboardAggregationSummary {
  return {
    counts: {
      persona: snapshot.persona ? 1 : 0,
      scenes: snapshot.scenes.length,
      structuredMemories: snapshot.structuredMemories.length,
      conversationEvidence: snapshot.conversationEvidence.length,
      offloadCanvases: snapshot.offloadCanvases.length,
      offloadReferences: snapshot.offloadCanvases.reduce((sum, canvas) => sum + canvas.refs.length, 0),
      warnings: snapshot.warnings.length,
    },
    typeDistribution: countByLabel(snapshot.structuredMemories.map((memory) => memory.type || "unknown")),
    priorityDistribution: countByPriority(snapshot.structuredMemories.map((memory) => memory.priority)),
    sceneHeatList: snapshot.scenes
      .map((scene) => ({
        sceneId: scene.sceneId,
        title: scene.title,
        heatScore: scene.heatScore,
        memoryCount: scene.memoryCount,
      }))
      .sort((left, right) => right.heatScore - left.heatScore || left.sceneId.localeCompare(right.sceneId)),
    recentUpdateTimeline: createRecentUpdateTimeline(snapshot),
    capabilityStatuses: snapshot.capabilityReport,
    evidenceLinkIndex: createEvidenceLinkIndex(snapshot.structuredMemories, snapshot.conversationEvidence),
    offloadCanvasSummaries: snapshot.offloadCanvases.map((canvas) => ({
      canvasId: canvas.canvasId,
      taskGoal: canvas.taskGoal,
      nodeCount: canvas.nodes.length,
      referenceCount: canvas.refs.length,
      doneCount: canvas.doneCount,
      doingCount: canvas.doingCount,
      todoCount: canvas.todoCount,
      updatedTime: canvas.updatedTime,
    })),
    warningCodes: countByLabel(snapshot.warnings.map((warning) => warning.code)),
  };
}

function createEvidenceLinkIndex(
  memories: readonly StructuredMemorySummary[],
  evidence: readonly ConversationEvidence[],
): readonly EvidenceLinkIndexEntry[] {
  const evidenceById = new Map(evidence.map((item) => [item.recordId, item]));
  return memories.map((memory) => ({
    memoryRecordId: memory.recordId,
    evidenceIds: memory.evidenceIds,
    evidenceRecords: memory.evidenceIds.map((id) => evidenceById.get(id)).filter(isDefined),
  }));
}

function createRecentUpdateTimeline(snapshot: DashboardSnapshot): readonly RecentUpdateItem[] {
  const items: RecentUpdateItem[] = [];
  if (snapshot.persona?.updatedAtMs) {
    items.push({
      id: snapshot.persona.profileId,
      layer: "persona",
      label: snapshot.persona.title,
      timestamp: new Date(snapshot.persona.updatedAtMs).toISOString(),
    });
  }
  for (const scene of snapshot.scenes) {
    if (scene.updatedAtMs) items.push({ id: scene.sceneId, layer: "scene", label: scene.title, timestamp: new Date(scene.updatedAtMs).toISOString() });
  }
  for (const memory of snapshot.structuredMemories) {
    if (memory.updatedTime) items.push({ id: memory.recordId, layer: "memory", label: memory.contentPreview, timestamp: memory.updatedTime });
  }
  for (const evidence of snapshot.conversationEvidence) {
    if (evidence.recordedAt) items.push({ id: evidence.recordId, layer: "conversation", label: evidence.snippet, timestamp: evidence.recordedAt });
  }
  for (const canvas of snapshot.offloadCanvases) {
    if (canvas.updatedTime) items.push({ id: canvas.canvasId, layer: "offload", label: canvas.taskGoal, timestamp: canvas.updatedTime });
  }
  return items.sort((left, right) => timestampMs(right.timestamp) - timestampMs(left.timestamp) || left.id.localeCompare(right.id));
}

function paginate<T>(items: readonly T[], offsetInput = 0, limitInput = DEFAULT_PAGE_LIMIT): DashboardPage<T> {
  const offset = Math.max(0, Math.floor(offsetInput));
  const limit = Math.max(0, Math.floor(limitInput));
  return {
    items: items.slice(offset, offset + limit),
    total: items.length,
    offset,
    limit,
  };
}

function createLayerCapability(options: {
  readonly label: string;
  readonly sourcePath: string | null;
  readonly hasData: boolean;
  readonly warnings: readonly ParserWarning[];
}): CapabilityState {
  const warningCodes = uniqueValues(options.warnings.map((warning) => warning.code));
  const hasError = options.warnings.some((warning) => warning.severity === "error");
  const status: CapabilityStatusValue = hasError ? "error" : options.warnings.length > 0 && options.hasData ? "partial" : options.hasData ? "available" : "missing";
  return {
    status,
    label: options.label,
    detail: status === "available" ? null : capabilityDetail(status, warningCodes),
    checkedAt: null,
    sourcePath: options.sourcePath,
    warningCodes,
  };
}

function createGatewayCapability(label: string, gatewayBaseUrl: string | null, checkedAt: string): CapabilityState {
  return {
    status: gatewayBaseUrl ? "partial" : "disabled",
    label,
    detail: gatewayBaseUrl ? "Gateway debug route is configured; run a live probe in Search/Recall Debug." : "Gateway is not configured.",
    checkedAt,
    sourcePath: gatewayBaseUrl,
    warningCodes: [],
  };
}

function capabilityDetail(status: CapabilityStatusValue, warningCodes: readonly string[]): string | null {
  if (status === "missing") return warningCodes.length > 0 ? `Missing data: ${warningCodes.join(", ")}` : "No data was parsed.";
  if (status === "partial") return `Parsed with warnings: ${warningCodes.join(", ")}`;
  if (status === "error") return `Parser errors: ${warningCodes.join(", ")}`;
  return null;
}

function warningsForLayer(warnings: readonly ParserWarning[], sourcePath: string, codePrefixes: readonly string[]): readonly ParserWarning[] {
  return warnings.filter((warning) => {
    const sourceMatches = sourcePath.trim() !== "" && pathIsWithin(warning.source, sourcePath);
    return sourceMatches || codePrefixes.some((prefix) => warning.code.startsWith(prefix));
  });
}

function warningCodesFor(warnings: readonly ParserWarning[], code: string): readonly string[] {
  return uniqueValues(warnings.filter((warning) => warning.code === code).map((warning) => warning.code));
}

function pathIsWithin(source: string, parent: string): boolean {
  const normalizedSource = path.resolve(source).toLowerCase();
  const normalizedParent = path.resolve(parent).toLowerCase();
  return normalizedSource === normalizedParent || normalizedSource.startsWith(`${normalizedParent}${path.sep}`);
}

function countByLabel(values: readonly string[]): readonly DistributionBucket[] {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label));
}

function countByPriority(values: readonly number[]): readonly PriorityDistributionBucket[] {
  const counts = new Map<number, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()]
    .map(([priority, count]) => ({ priority, count }))
    .sort((left, right) => right.count - left.count || right.priority - left.priority);
}

function sanitizeWarning(warning: ParserWarning): ParserWarning {
  return { ...warning, rawValue: sanitizeJsonValue(warning.rawValue) };
}

function sanitizeJsonValue(value: JsonValue | null): JsonValue | null {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map((item) => sanitizeJsonValue(item) ?? null);

  const output: Record<string, JsonValue> = {};
  for (const [key, item] of Object.entries(value)) {
    if (isBlockedRawFieldName(key)) continue;
    output[key] = sanitizeJsonValue(item) ?? null;
  }
  return output;
}

function isBlockedRawFieldName(key: string): boolean {
  const lowered = key.toLowerCase();
  return BLOCKED_RAW_FIELD_NAME_PARTS.some((parts) => lowered === parts.join(""));
}

function isDataSourceConfig(config: DataSourceConfig | LocalDashboardRequestConfig): config is DataSourceConfig {
  return "readOnly" in config && config.readOnly === true;
}

function readGeneratedAt(config: DataSourceConfig | LocalDashboardRequestConfig, now: () => Date): string {
  return isDataSourceConfig(config) ? now().toISOString() : config.generatedAt ?? now().toISOString();
}

function readSnapshotId(config: DataSourceConfig | LocalDashboardRequestConfig, generatedAt: string): string {
  return isDataSourceConfig(config) ? `snapshot:${generatedAt}` : config.snapshotId ?? `snapshot:${generatedAt}`;
}

function readRequestSourceLabel(config: DataSourceConfig | LocalDashboardRequestConfig): string | undefined {
  return isDataSourceConfig(config) ? config.sourceLabel : config.sourceLabel;
}

function readRequestGatewayBaseUrl(config: DataSourceConfig | LocalDashboardRequestConfig): string | null | undefined {
  return isDataSourceConfig(config) ? config.gatewayBaseUrl : config.gatewayBaseUrl;
}

function readRequestGatewayApiKeyEnv(config: DataSourceConfig | LocalDashboardRequestConfig): string | null | undefined {
  return isDataSourceConfig(config) ? config.gatewayApiKeyEnv : config.gatewayApiKeyEnv;
}

function createProviderWarning(
  source: string,
  code: string,
  message: string,
  rawValue: JsonValue | null,
  severity: ParserWarning["severity"] = "warning",
): ParserWarning {
  return { source, code, severity, message, location: null, rawValue };
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    void error;
    return false;
  }
}

function optionalWarning(warning: ParserWarning | null): readonly ParserWarning[] {
  return warning ? [warning] : [];
}

function optionalString(value: string | null | undefined): readonly string[] {
  return value ? [value] : [];
}

function uniqueValues(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort();
}

function timestampMs(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}
