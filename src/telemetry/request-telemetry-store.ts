import fs from "node:fs/promises";
import path from "node:path";

import {
  REQUEST_TELEMETRY_AUTH_TYPES,
  REQUEST_TELEMETRY_OUTCOMES,
  REQUEST_TELEMETRY_QUERY_KEY_ALLOWLIST,
  REQUEST_TELEMETRY_SOURCES,
} from "./request-telemetry.js";

import type {
  JsonValue,
  RequestTelemetryAuthType,
  RequestTelemetryOutcome,
  RequestTelemetryPage,
  RequestTelemetryQueryKey,
  RequestTelemetrySource,
  RequestTelemetrySummary,
  RequestTelemetrySummaryBucket,
  RequestTelemetryWarning,
  SanitizedRequestLog,
} from "./request-telemetry.js";

export const REQUEST_TELEMETRY_GATEWAY_FILE = "request-logs.gateway.jsonl";
export const REQUEST_TELEMETRY_VISUALIZER_FILE = "request-logs.visualizer.jsonl";
export const REQUEST_TELEMETRY_MAX_FILE_BYTES = 10 * 1024 * 1024;
export const REQUEST_TELEMETRY_MAX_VALID_RECORDS_PER_FILE = 10_000;
export const REQUEST_TELEMETRY_DEFAULT_LIMIT = 50;
export const REQUEST_TELEMETRY_MAX_LIMIT = 200;

export type RequestTelemetryDirectorySource = RequestTelemetrySource | "shared";

export interface RequestTelemetryEnv {
  readonly TDAI_GATEWAY_TELEMETRY_DIR?: string | undefined;
  readonly TDAI_VIS_TELEMETRY_DIR?: string | undefined;
  readonly TDAI_TELEMETRY_DIR?: string | undefined;
  readonly [key: string]: string | undefined;
}

export interface RequestTelemetryDirectoryOptions {
  readonly source?: RequestTelemetryDirectorySource;
  readonly telemetryDir?: string | null;
  readonly env?: RequestTelemetryEnv;
  readonly fallbackDir?: string | null;
  readonly unsafeRootDirs?: readonly (string | null | undefined)[];
}

export interface RequestTelemetryDirectoryResolution {
  readonly ok: boolean;
  readonly dir: string | null;
  readonly envKey: string | null;
  readonly warnings: readonly RequestTelemetryWarning[];
}

export interface RequestTelemetryWriteOptions extends RequestTelemetryDirectoryOptions {
  readonly source: RequestTelemetrySource;
  readonly fileSystem?: RequestTelemetryFileSystem;
}

export interface RequestTelemetryWriteResult {
  readonly ok: boolean;
  readonly filePath: string | null;
  readonly warnings: readonly RequestTelemetryWarning[];
}

export interface RequestTelemetryReadOptions extends RequestTelemetryDirectoryOptions {
  readonly limit?: unknown;
  readonly offset?: unknown;
  readonly sources?: readonly RequestTelemetrySource[];
  readonly fileSystem?: RequestTelemetryFileSystem;
}

export interface RequestTelemetrySummaryOptions extends RequestTelemetryDirectoryOptions {
  readonly now?: Date;
  readonly sources?: readonly RequestTelemetrySource[];
  readonly fileSystem?: RequestTelemetryFileSystem;
}

export interface RequestTelemetryValidationError {
  readonly code: "invalid-telemetry-pagination";
  readonly field: "limit" | "offset";
  readonly message: string;
  readonly detail: JsonValue;
}

export type RequestTelemetryReadResult =
  | { readonly ok: true; readonly page: RequestTelemetryPage }
  | { readonly ok: false; readonly error: RequestTelemetryValidationError; readonly warnings: readonly RequestTelemetryWarning[] };

export interface RequestTelemetryFileSystem {
  readonly mkdir: typeof fs.mkdir;
  readonly appendFile: typeof fs.appendFile;
  readonly readFile: typeof fs.readFile;
  readonly stat: typeof fs.stat;
  readonly open?: typeof fs.open;
}

interface PaginationResult {
  readonly ok: true;
  readonly offset: number;
  readonly limit: number;
  readonly warnings: readonly RequestTelemetryWarning[];
}

interface SourceReadResult {
  readonly records: readonly SanitizedRequestLog[];
  readonly warnings: readonly RequestTelemetryWarning[];
}

const DEFAULT_FILE_SYSTEM: RequestTelemetryFileSystem = fs;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export function resolveRequestTelemetryDirectory(options: RequestTelemetryDirectoryOptions = {}): RequestTelemetryDirectoryResolution {
  const source = options.source ?? "shared";
  const candidate = firstTelemetryDirCandidate(options, source);
  if (!candidate) {
    return {
      ok: false,
      dir: null,
      envKey: null,
      warnings: [warning("telemetry-dir-unconfigured", "Telemetry directory is not configured.", source, null)],
    };
  }

  const resolved = path.resolve(candidate.value);
  const unsafeRoot = findUnsafeRoot(resolved, options.unsafeRootDirs ?? []);
  if (unsafeRoot) {
    return {
      ok: false,
      dir: resolved,
      envKey: candidate.envKey,
      warnings: [warning("telemetry-dir-unsafe", "Telemetry directory overlaps a protected data root.", source, {
        telemetryDir: resolved,
        unsafeRoot,
      })],
    };
  }

  return { ok: true, dir: resolved, envKey: candidate.envKey, warnings: [] };
}

export function requestTelemetryFileNameForSource(source: RequestTelemetrySource): string {
  return source === "gateway" ? REQUEST_TELEMETRY_GATEWAY_FILE : REQUEST_TELEMETRY_VISUALIZER_FILE;
}

export async function appendRequestTelemetryLog(
  log: SanitizedRequestLog,
  options: RequestTelemetryWriteOptions,
): Promise<RequestTelemetryWriteResult> {
  const fileSystem = options.fileSystem ?? DEFAULT_FILE_SYSTEM;
  const resolution = resolveRequestTelemetryDirectory({ ...options, source: options.source });
  if (!resolution.ok || !resolution.dir) return { ok: false, filePath: null, warnings: resolution.warnings };

  const filePath = path.join(resolution.dir, requestTelemetryFileNameForSource(options.source));
  try {
    await fileSystem.mkdir(resolution.dir, { recursive: true });
    await fileSystem.appendFile(filePath, `${JSON.stringify(log)}\n`, "utf-8");
    return { ok: true, filePath, warnings: [] };
  } catch (error) {
    return {
      ok: false,
      filePath,
      warnings: [warning("telemetry-write-failed", "Telemetry append failed; request handling should continue.", options.source, errorDetail(error))],
    };
  }
}

export async function readRequestTelemetryPage(options: RequestTelemetryReadOptions = {}): Promise<RequestTelemetryReadResult> {
  const pagination = validateTelemetryPagination(options.limit, options.offset);
  if (!pagination.ok) return { ok: false, error: pagination.error, warnings: [] };

  const readResult = await readBoundedRequestTelemetryRecords(options);
  const start = pagination.offset;
  const end = start + pagination.limit;
  return {
    ok: true,
    page: {
      items: readResult.records.slice(start, end),
      total: readResult.records.length,
      offset: pagination.offset,
      limit: pagination.limit,
      warnings: [...pagination.warnings, ...readResult.warnings],
    },
  };
}

export async function readRequestTelemetrySummary(options: RequestTelemetrySummaryOptions = {}): Promise<RequestTelemetrySummary> {
  const now = options.now ?? new Date();
  const readResult = await readBoundedRequestTelemetryRecords(options);
  const records = readResult.records;
  const errorCount = records.filter(isErrorRecord).length;
  const cutoff = now.getTime() - ONE_DAY_MS;

  return {
    generatedAt: now.toISOString(),
    total: records.length,
    last24h: records.filter((record) => createdAtMs(record) >= cutoff).length,
    errorRate: records.length === 0 ? 0 : roundRatio(errorCount / records.length),
    p95LatencyMs: percentileLatency(records, 0.95),
    recent5xx: records.filter(is5xxRecord).slice(0, 5),
    sources: summarizeSources(records),
    warnings: readResult.warnings,
  };
}

export function validateTelemetryPagination(limitInput: unknown, offsetInput: unknown):
  | PaginationResult
  | { readonly ok: false; readonly error: RequestTelemetryValidationError } {
  const limit = parseNonNegativeInteger(limitInput, REQUEST_TELEMETRY_DEFAULT_LIMIT, "limit");
  if (!limit.ok) return { ok: false, error: limit.error };

  const offset = parseNonNegativeInteger(offsetInput, 0, "offset");
  if (!offset.ok) return { ok: false, error: offset.error };

  if (limit.value > REQUEST_TELEMETRY_MAX_LIMIT) {
    return {
      ok: true,
      offset: offset.value,
      limit: REQUEST_TELEMETRY_MAX_LIMIT,
      warnings: [warning("telemetry-limit-capped", "Telemetry page limit exceeded the maximum and was capped.", "shared", {
        requested: limit.value,
        maximum: REQUEST_TELEMETRY_MAX_LIMIT,
      })],
    };
  }

  return { ok: true, offset: offset.value, limit: limit.value, warnings: [] };
}

async function readBoundedRequestTelemetryRecords(
  options: Pick<RequestTelemetryReadOptions, "env" | "fallbackDir" | "fileSystem" | "sources" | "telemetryDir" | "unsafeRootDirs">,
): Promise<SourceReadResult> {
  const sources = normalizeSources(options.sources);
  const results = await Promise.all(sources.map((source) => readSourceFile(source, options)));
  const records = results.flatMap((result) => result.records).sort(compareNewestFirst);
  return { records, warnings: results.flatMap((result) => result.warnings) };
}

async function readSourceFile(
  source: RequestTelemetrySource,
  options: Pick<RequestTelemetryReadOptions, "env" | "fallbackDir" | "fileSystem" | "telemetryDir" | "unsafeRootDirs">,
): Promise<SourceReadResult> {
  const fileSystem = options.fileSystem ?? DEFAULT_FILE_SYSTEM;
  const resolution = resolveRequestTelemetryDirectory({ ...options, source });
  if (!resolution.ok || !resolution.dir) return { records: [], warnings: resolution.warnings };

  const dir = resolution.dir;
  try {
    const dirStat = await fileSystem.stat(dir);
    if (!dirStat.isDirectory()) {
      return { records: [], warnings: [warning("telemetry-dir-not-directory", "Telemetry path is not a directory.", source, { telemetryDir: dir })] };
    }
  } catch (error) {
    return { records: [], warnings: [warning("telemetry-dir-missing", "Telemetry directory is missing or unreadable.", source, errorDetail(error))] };
  }

  const filePath = path.join(dir, requestTelemetryFileNameForSource(source));
  let fileSize = 0;
  try {
    const fileStat = await fileSystem.stat(filePath);
    if (!fileStat.isFile()) {
      return { records: [], warnings: [warning("telemetry-file-not-file", "Telemetry path is not a file.", source, { filePath })] };
    }
    fileSize = fileStat.size;
  } catch (error) {
    return { records: [], warnings: [warning("telemetry-file-missing", "Telemetry JSONL file is missing or unreadable.", source, errorDetail(error))] };
  }

  const warnings: RequestTelemetryWarning[] = [];
  if (fileSize > REQUEST_TELEMETRY_MAX_FILE_BYTES) {
    warnings.push(warning("telemetry-file-too-large", "Telemetry JSONL file exceeded the bounded read window.", source, {
      filePath,
      maxBytes: REQUEST_TELEMETRY_MAX_FILE_BYTES,
      sizeBytes: fileSize,
    }));
  }

  try {
    const { content, droppedLeadingPartialLine } = await readNewestFileContent(filePath, fileSize, fileSystem);
    const parsed = parseTelemetryJsonl(content, source, droppedLeadingPartialLine);
    if (parsed.corruptLines > 0) {
      warnings.push(warning("telemetry-line-corrupt", "Telemetry JSONL contained corrupt or invalid lines that were skipped.", source, {
        filePath,
        corruptLines: parsed.corruptLines,
      }));
    }
    return { records: parsed.records, warnings };
  } catch (error) {
    return { records: [], warnings: [
      ...warnings,
      warning("telemetry-file-read-failed", "Telemetry JSONL file could not be read.", source, errorDetail(error)),
    ] };
  }
}

async function readNewestFileContent(
  filePath: string,
  fileSize: number,
  fileSystem: RequestTelemetryFileSystem,
): Promise<{ readonly content: string; readonly droppedLeadingPartialLine: boolean }> {
  if (fileSize <= REQUEST_TELEMETRY_MAX_FILE_BYTES) {
    return { content: decodeFileContent(await fileSystem.readFile(filePath)), droppedLeadingPartialLine: false };
  }

  const start = Math.max(0, fileSize - REQUEST_TELEMETRY_MAX_FILE_BYTES);
  const readLength = fileSize - start;
  const buffer = Buffer.alloc(readLength);

  if (!fileSystem.open) {
    const raw = await fileSystem.readFile(filePath);
    return { content: readFileContentWindow(raw, start), droppedLeadingPartialLine: start > 0 };
  }

  const handle = await fileSystem.open(filePath, "r");
  try {
    const { bytesRead } = await handle.read(buffer, 0, readLength, start);
    return { content: buffer.subarray(0, bytesRead).toString("utf-8"), droppedLeadingPartialLine: start > 0 };
  } finally {
    await handle.close();
  }
}

function decodeFileContent(raw: string | Buffer): string {
  return Buffer.isBuffer(raw) ? raw.toString("utf-8") : raw;
}

function readFileContentWindow(raw: string | Buffer, start: number): string {
  return Buffer.isBuffer(raw) ? raw.subarray(start).toString("utf-8") : raw.slice(start);
}

function parseTelemetryJsonl(
  content: string,
  source: RequestTelemetrySource,
  droppedLeadingPartialLine: boolean,
): { readonly records: readonly SanitizedRequestLog[]; readonly corruptLines: number } {
  const lines = content.split(/\r?\n/);
  if (droppedLeadingPartialLine) lines.shift();

  const records: SanitizedRequestLog[] = [];
  let corruptLines = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const record = coerceSanitizedRequestLog(JSON.parse(trimmed), source);
      if (record) records.push(record);
      else corruptLines += 1;
    } catch {
      corruptLines += 1;
    }
  }

  return {
    records: records.sort(compareNewestFirst).slice(0, REQUEST_TELEMETRY_MAX_VALID_RECORDS_PER_FILE),
    corruptLines,
  };
}

function coerceSanitizedRequestLog(value: unknown, expectedSource: RequestTelemetrySource): SanitizedRequestLog | null {
  if (!isRecord(value)) return null;
  if (value.source !== expectedSource) return null;
  if (!isString(value.id) || !isString(value.method) || !isString(value.path) || !isString(value.routePattern) || !isString(value.createdAt)) return null;
  if (!isNullableNumber(value.statusCode) || !isNullableNumber(value.latencyMs)) return null;
  if (!isTelemetryOutcome(value.outcome) || !isTelemetryAuthType(value.authType)) return null;
  if (!isQueryKeyArray(value.queryKeys) || !isStringArray(value.warningCodes)) return null;

  return {
    id: value.id,
    source: expectedSource,
    method: value.method,
    path: value.path,
    routePattern: value.routePattern,
    statusCode: value.statusCode,
    outcome: value.outcome,
    latencyMs: value.latencyMs,
    authType: value.authType,
    createdAt: value.createdAt,
    queryKeys: value.queryKeys,
    warningCodes: value.warningCodes,
  };
}

function summarizeSources(records: readonly SanitizedRequestLog[]): readonly RequestTelemetrySummaryBucket[] {
  const buckets: RequestTelemetrySummaryBucket[] = [];
  for (const source of REQUEST_TELEMETRY_SOURCES) {
    const sourceRecords = records.filter((record) => record.source === source);
    if (sourceRecords.length === 0) continue;
    const latencies = sourceRecords.map((record) => record.latencyMs).filter(isNumber);
    buckets.push({
      key: source,
      count: sourceRecords.length,
      errorCount: sourceRecords.filter(isErrorRecord).length,
      unauthorizedCount: sourceRecords.filter(isUnauthorizedRecord).length,
      averageLatencyMs: latencies.length === 0 ? null : Math.round(latencies.reduce((sum, latency) => sum + latency, 0) / latencies.length),
    });
  }
  return buckets;
}

function firstTelemetryDirCandidate(
  options: RequestTelemetryDirectoryOptions,
  source: RequestTelemetryDirectorySource,
): { readonly value: string; readonly envKey: string | null } | null {
  if (hasText(options.telemetryDir)) return { value: options.telemetryDir.trim(), envKey: null };
  for (const envKey of envKeysForSource(source)) {
    const value = options.env?.[envKey];
    if (hasText(value)) return { value: value.trim(), envKey };
  }
  if (hasText(options.fallbackDir)) return { value: options.fallbackDir.trim(), envKey: null };
  return null;
}

function envKeysForSource(source: RequestTelemetryDirectorySource): readonly string[] {
  if (source === "gateway") return ["TDAI_GATEWAY_TELEMETRY_DIR", "TDAI_TELEMETRY_DIR"];
  if (source === "visualizer-api") return ["TDAI_VIS_TELEMETRY_DIR", "TDAI_TELEMETRY_DIR"];
  return ["TDAI_TELEMETRY_DIR"];
}

function findUnsafeRoot(dir: string, roots: readonly (string | null | undefined)[]): string | null {
  for (const root of roots) {
    if (!hasText(root)) continue;
    const resolvedRoot = path.resolve(root);
    const relative = path.relative(resolvedRoot, dir);
    if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) return resolvedRoot;
  }
  return null;
}

function normalizeSources(sources: readonly RequestTelemetrySource[] | undefined): readonly RequestTelemetrySource[] {
  if (!sources || sources.length === 0) return REQUEST_TELEMETRY_SOURCES;
  return REQUEST_TELEMETRY_SOURCES.filter((source) => sources.includes(source));
}

function parseNonNegativeInteger(
  input: unknown,
  defaultValue: number,
  field: "limit" | "offset",
): { readonly ok: true; readonly value: number } | { readonly ok: false; readonly error: RequestTelemetryValidationError } {
  if (input === undefined || input === null || input === "") return { ok: true, value: defaultValue };
  const value = typeof input === "number" ? input : typeof input === "string" && /^\d+$/.test(input.trim()) ? Number(input.trim()) : Number.NaN;
  if (!Number.isInteger(value) || value < 0) {
    return { ok: false, error: {
      code: "invalid-telemetry-pagination",
      field,
      message: `Telemetry ${field} must be a non-negative integer.`,
      detail: { value: String(input) },
    } };
  }
  return { ok: true, value };
}

function compareNewestFirst(left: SanitizedRequestLog, right: SanitizedRequestLog): number {
  const delta = createdAtMs(right) - createdAtMs(left);
  return delta === 0 ? right.id.localeCompare(left.id) : delta;
}

function percentileLatency(records: readonly SanitizedRequestLog[], percentile: number): number | null {
  const latencies = records.map((record) => record.latencyMs).filter(isNumber).sort((left, right) => left - right);
  if (latencies.length === 0) return null;
  const index = Math.min(latencies.length - 1, Math.max(0, Math.ceil(percentile * latencies.length) - 1));
  return latencies[index];
}

function createdAtMs(record: SanitizedRequestLog): number {
  const ms = Date.parse(record.createdAt);
  return Number.isFinite(ms) ? ms : 0;
}

function isErrorRecord(record: SanitizedRequestLog): boolean {
  return record.outcome === "error" || is5xxRecord(record);
}

function is5xxRecord(record: SanitizedRequestLog): boolean {
  return typeof record.statusCode === "number" && record.statusCode >= 500 && record.statusCode <= 599;
}

function isUnauthorizedRecord(record: SanitizedRequestLog): boolean {
  return record.outcome === "unauthorized" || record.statusCode === 401 || record.statusCode === 403;
}

function roundRatio(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}

function warning(code: string, message: string, source: RequestTelemetryDirectorySource, detail: JsonValue | null): RequestTelemetryWarning {
  return { code, message, source, detail };
}

function errorDetail(error: unknown): JsonValue {
  return { message: error instanceof Error ? error.message : String(error) };
}

function hasText(value: string | null | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isNullableNumber(value: unknown): value is number | null {
  return value === null || isNumber(value);
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every(isString);
}

function isTelemetryOutcome(value: unknown): value is RequestTelemetryOutcome {
  return REQUEST_TELEMETRY_OUTCOMES.includes(value as RequestTelemetryOutcome);
}

function isTelemetryAuthType(value: unknown): value is RequestTelemetryAuthType {
  return REQUEST_TELEMETRY_AUTH_TYPES.includes(value as RequestTelemetryAuthType);
}

function isQueryKeyArray(value: unknown): value is readonly RequestTelemetryQueryKey[] {
  return Array.isArray(value) && value.every((key) => REQUEST_TELEMETRY_QUERY_KEY_ALLOWLIST.includes(key as RequestTelemetryQueryKey));
}
