import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

import { createDefaultDataSourceConfig } from "../contracts/dashboard";

import type {
  ConversationEvidence,
  DataSourceConfig,
  JsonValue,
  OffloadCanvas,
  OffloadCanvasNode,
  OffloadNodeStatus,
  OffloadReference,
  ParserWarning,
  ParserWarningSeverity,
  PersonaSummary,
  SceneBlockSummary,
  StructuredMemorySummary,
} from "../contracts/dashboard";

export interface ParserResult<T> {
  readonly data: T;
  readonly warnings: readonly ParserWarning[];
}

export interface MetadataSummary {
  readonly manifest: JsonValue | null;
  readonly checkpoint: JsonValue | null;
}

export interface LocalMemoryParseResult {
  readonly metadata: MetadataSummary;
  readonly persona: PersonaSummary | null;
  readonly scenes: readonly SceneBlockSummary[];
  readonly structuredMemories: readonly StructuredMemorySummary[];
  readonly conversationEvidence: readonly ConversationEvidence[];
  readonly offloadCanvases: readonly OffloadCanvas[];
  readonly warnings: readonly ParserWarning[];
}

const META_START = "-----META-START-----";
const META_END = "-----META-END-----";
const require = createRequire(import.meta.url);

interface SqliteDatabase {
  readonly prepare: (sql: string) => SqliteStatement;
  readonly close: () => void;
}

interface SqliteStatement {
  readonly all: (...params: readonly unknown[]) => unknown[];
}

interface SqliteModule {
  readonly DatabaseSync: new (filename: string, options?: { readonly readOnly?: boolean }) => SqliteDatabase;
}

export function createDataSourceConfigFromRoot(
  rootPath: string,
  overrides: Partial<Omit<DataSourceConfig, "readOnly">> = {},
): DataSourceConfig {
  return createDefaultDataSourceConfig({
    sourceLabel: path.basename(rootPath) || "local-memory",
    memoryRootPath: rootPath,
    profilesPath: path.join(rootPath, "profiles"),
    scenesPath: path.join(rootPath, "scene_blocks"),
    l1DatabasePath: path.join(rootPath, "records"),
    l0DatabasePath: path.join(rootPath, "conversations"),
    offloadRootPath: path.join(rootPath, "offload"),
    environmentInputs: [],
    ...overrides,
  });
}

export async function parseLocalMemorySource(
  config: DataSourceConfig,
): Promise<LocalMemoryParseResult> {
  const [metadata, persona, scenes, structuredMemories, conversationEvidence, offloadCanvases] =
    await Promise.all([
      parseMetadata(config),
      parsePersona(config),
      parseSceneBlocks(config),
      parseStructuredMemories(config),
      parseConversationEvidence(config),
      parseOffloadCanvases(config),
    ]);
  const warnings = [
    ...metadata.warnings,
    ...persona.warnings,
    ...scenes.warnings,
    ...structuredMemories.warnings,
    ...conversationEvidence.warnings,
    ...offloadCanvases.warnings,
  ];

  return {
    metadata: metadata.data,
    persona: persona.data,
    scenes: scenes.data,
    structuredMemories: structuredMemories.data,
    conversationEvidence: conversationEvidence.data,
    offloadCanvases: offloadCanvases.data,
    warnings,
  };
}

export async function parseMetadata(config: DataSourceConfig): Promise<ParserResult<MetadataSummary>> {
  const manifest = await readJsonFile(path.join(config.memoryRootPath, ".metadata", "manifest.json"), {
    missingCode: "metadata-manifest-missing",
    corruptCode: "metadata-manifest-corrupt",
  });
  const checkpoint = await readJsonFile(path.join(config.memoryRootPath, ".metadata", "checkpoint.json"), {
    missingCode: "metadata-checkpoint-missing",
    corruptCode: "metadata-checkpoint-corrupt",
  });

  return {
    data: {
      manifest: manifest.data,
      checkpoint: checkpoint.data,
    },
    warnings: [...manifest.warnings, ...checkpoint.warnings],
  };
}

export async function parsePersona(config: DataSourceConfig): Promise<ParserResult<PersonaSummary | null>> {
  const candidates = [path.join(config.profilesPath, "persona.md"), path.join(config.memoryRootPath, "persona.md")];
  const warnings: ParserWarning[] = [];
  let selectedPath: string | null = null;
  let content = "";

  for (const candidate of candidates) {
    const file = await readTextFile(candidate, false);
    warnings.push(...file.warnings);
    if (file.data !== null) {
      selectedPath = candidate;
      content = file.data;
      break;
    }
  }

  if (selectedPath === null) {
    return {
      data: null,
      warnings: [
        warning(candidates[0] ?? config.profilesPath, "persona-missing", "warning", "Persona file was not found.", null),
      ],
    };
  }

  const metadata = parseMarkdownKeyValues(content);
  const title = extractMarkdownTitle(content) || "Persona";
  const sceneIds = readStringList(metadata.scene_ids ?? metadata.sceneIds);
  return {
    data: {
      profileId: readString(metadata.profile_id ?? metadata.profileId) || `persona:${hashText(selectedPath).slice(0, 12)}`,
      filename: path.basename(selectedPath),
      available: true,
      title,
      contentSummary: summarize(content),
      contentPreview: preview(content),
      contentMd5: hashText(content),
      agentId: nullableString(metadata.agent_id ?? metadata.agentId),
      version: readNumber(metadata.version) ?? 0,
      createdAtMs: readNumber(metadata.createdAtMs ?? metadata.created_at_ms),
      updatedAtMs: readNumber(metadata.updatedAtMs ?? metadata.updated_at_ms),
      sourcePath: selectedPath,
      sceneIds,
      rawMetadata: jsonObjectOrNull(metadata),
    },
    warnings,
  };
}

export async function parseSceneBlocks(config: DataSourceConfig): Promise<ParserResult<SceneBlockSummary[]>> {
  const warnings: ParserWarning[] = [];
  const indexByFilename = new Map<string, Record<string, unknown>>();
  const indexFiles = [
    path.join(config.memoryRootPath, ".metadata", "scene_index.json"),
    path.join(config.scenesPath, "index.json"),
  ];

  for (const indexFile of indexFiles) {
    if (!(await exists(indexFile))) continue;
    const parsed = await readJsonFile(indexFile, {
      missingCode: "scene-index-missing",
      corruptCode: "scene-index-corrupt",
    });
    warnings.push(...parsed.warnings);
    if (Array.isArray(parsed.data)) {
      for (const item of parsed.data) {
        if (isRecord(item)) {
          const filename = readString(item.filename);
          if (filename && !indexByFilename.has(filename)) indexByFilename.set(filename, item);
        }
      }
    }
  }

  const files = await listFiles(config.scenesPath, ".md");
  warnings.push(...files.warnings);
  const scenes: SceneBlockSummary[] = [];
  const seenFilenames = new Set<string>();
  for (const filename of files.data) {
    seenFilenames.add(filename);
    const sourcePath = path.join(config.scenesPath, filename);
    const file = await readTextFile(sourcePath, true);
    warnings.push(...file.warnings);
    if (file.data === null || file.data.trim() === "") continue;
    const parsed = parseSceneMarkdown(file.data);
    if (!parsed.hasMeta) {
      warnings.push(warning(sourcePath, "scene-meta-missing", "warning", "Scene block has no META section.", null));
    }
    const index = indexByFilename.get(filename);
    const title = readString(index?.title) || extractMarkdownTitle(parsed.content) || stripExtension(filename);
    const sceneId = readString(index?.sceneId ?? index?.scene_id) || `scene:${stripExtension(filename)}`;
    const heatScore = readNumber(index?.heatScore ?? index?.heat) ?? parsed.heat;
    const memoryCount = readNumber(index?.memoryCount ?? index?.memory_count) ?? 0;
    scenes.push({
      sceneId,
      filename,
      title,
      contentSummary: readString(index?.summary) || parsed.summary || summarize(parsed.content),
      contentPreview: preview(parsed.content),
      heatScore,
      memoryCount,
      updatedAtMs: dateToMs(parsed.updated || readString(index?.updated)),
      sourcePath,
      relatedPersonaIds: readStringList(index?.relatedPersonaIds ?? index?.related_persona_ids),
      evidenceRecordIds: readStringList(index?.evidenceRecordIds ?? index?.evidence_record_ids),
      rawMetadata: jsonObjectOrNull({ ...parsed.meta, ...(index ?? {}) }),
    });
  }

  for (const [filename, index] of indexByFilename.entries()) {
    if (seenFilenames.has(filename)) continue;

    const sourcePath = path.join(config.scenesPath, filename);
    const title = readString(index.title) || stripExtension(filename);
    const summary = readString(index.summary) || title;
    scenes.push({
      sceneId: readString(index.sceneId ?? index.scene_id) || `scene:${stripExtension(filename)}`,
      filename,
      title,
      contentSummary: summary,
      contentPreview: preview(summary),
      heatScore: readNumber(index.heatScore ?? index.heat) ?? 0,
      memoryCount: readNumber(index.memoryCount ?? index.memory_count) ?? 0,
      updatedAtMs: dateToMs(readString(index.updated)),
      sourcePath,
      relatedPersonaIds: readStringList(index.relatedPersonaIds ?? index.related_persona_ids),
      evidenceRecordIds: readStringList(index.evidenceRecordIds ?? index.evidence_record_ids),
      rawMetadata: jsonObjectOrNull({ ...index }),
    });
  }

  return { data: scenes, warnings };
}

export async function parseStructuredMemories(
  config: DataSourceConfig,
): Promise<ParserResult<StructuredMemorySummary[]>> {
  const sqlite = await parseStructuredMemoriesFromSqlite(config);
  if (sqlite.data !== null) return { data: sqlite.data, warnings: sqlite.warnings };

  const files = await listFiles(config.l1DatabasePath, ".jsonl");
  const warnings: ParserWarning[] = [...sqlite.warnings, ...files.warnings];
  const memories: StructuredMemorySummary[] = [];
  for (const filename of files.data) {
    const parsed = await readJsonlFile(path.join(config.l1DatabasePath, filename), "memory-jsonl-corrupt");
    warnings.push(...parsed.warnings);
    for (const item of parsed.data) {
      memories.push(toStructuredMemory(item, filename));
    }
  }
  return { data: memories, warnings };
}

export async function parseConversationEvidence(
  config: DataSourceConfig,
): Promise<ParserResult<ConversationEvidence[]>> {
  const sqlite = await parseConversationEvidenceFromSqlite(config);
  if (sqlite.data !== null) return { data: sqlite.data, warnings: sqlite.warnings };

  const files = await listFiles(config.l0DatabasePath, ".jsonl");
  const warnings: ParserWarning[] = [...sqlite.warnings, ...files.warnings];
  const evidence: ConversationEvidence[] = [];
  for (const filename of files.data) {
    const parsed = await readJsonlFile(path.join(config.l0DatabasePath, filename), "conversation-jsonl-corrupt");
    warnings.push(...parsed.warnings);
    for (const item of parsed.data) {
      evidence.push(toConversationEvidence(item, filename));
    }
  }
  return { data: evidence, warnings };
}

export async function parseOffloadCanvases(config: DataSourceConfig): Promise<ParserResult<OffloadCanvas[]>> {
  const roots = await findOffloadRoots(config.offloadRootPath);
  const warnings: ParserWarning[] = [...roots.warnings];
  const canvases: OffloadCanvas[] = [];

  for (const root of roots.data) {
    const refs = await parseOffloadReferences(root);
    warnings.push(...refs.warnings);
    const mmdFiles = await listFiles(path.join(root, "mmds"), ".mmd");
    warnings.push(...mmdFiles.warnings);
    for (const filename of mmdFiles.data) {
      const sourcePath = path.join(root, "mmds", filename);
      const file = await readTextFile(sourcePath, true);
      warnings.push(...file.warnings);
      if (file.data === null) continue;
      const mmd = parseMmd(filename, sourcePath, file.data);
      warnings.push(...mmd.warnings);
      const linkedRefs = refs.data.filter((ref) => ref.nodeId === null || mmd.data.nodes.some((node) => node.nodeId === ref.nodeId));
      canvases.push({
        ...mmd.data,
        refs: linkedRefs.length > 0 ? linkedRefs : refs.data,
      });
    }
  }

  return { data: canvases, warnings };
}

async function parseStructuredMemoriesFromSqlite(config: DataSourceConfig): Promise<ParserResult<StructuredMemorySummary[] | null>> {
  const sqlitePath = path.join(config.memoryRootPath, "vectors.db");
  if (!(await exists(sqlitePath))) return { data: null, warnings: [] };

  let db: SqliteDatabase | null = null;
  try {
    db = openReadOnlySqlite(sqlitePath);
    const rows = db.prepare(`
      SELECT record_id, content, type, priority, scene_name, session_key, session_id,
             timestamp_str, timestamp_start, timestamp_end, created_time, updated_time, metadata_json
      FROM l1_records
      ORDER BY updated_time ASC, record_id ASC
    `).all();
    return { data: rows.filter(isRecord).map(toStructuredMemoryFromSqlite), warnings: [] };
  } catch (error) {
    return {
      data: null,
      warnings: [warning(sqlitePath, "sqlite-metadata-read-error", "warning", messageFrom(error), null)],
    };
  } finally {
    db?.close();
  }
}

async function parseConversationEvidenceFromSqlite(config: DataSourceConfig): Promise<ParserResult<ConversationEvidence[] | null>> {
  const sqlitePath = path.join(config.memoryRootPath, "vectors.db");
  if (!(await exists(sqlitePath))) return { data: null, warnings: [] };

  let db: SqliteDatabase | null = null;
  try {
    db = openReadOnlySqlite(sqlitePath);
    const rows = db.prepare(`
      SELECT record_id, session_key, session_id, role, message_text, recorded_at, timestamp
      FROM l0_conversations
      ORDER BY recorded_at ASC, record_id ASC
    `).all();
    return { data: rows.filter(isRecord).map(toConversationEvidenceFromSqlite), warnings: [] };
  } catch (error) {
    return {
      data: null,
      warnings: [warning(sqlitePath, "sqlite-metadata-read-error", "warning", messageFrom(error), null)],
    };
  } finally {
    db?.close();
  }
}

function openReadOnlySqlite(sqlitePath: string): SqliteDatabase {
  const sqlite = require("node:sqlite") as SqliteModule;
  return new sqlite.DatabaseSync(sqlitePath, { readOnly: true });
}

async function parseOffloadReferences(root: string): Promise<ParserResult<OffloadReference[]>> {
  const files = await listFiles(root, ".jsonl", "offload-");
  const warnings: ParserWarning[] = [...files.warnings];
  const refs: OffloadReference[] = [];
  for (const filename of files.data) {
    const parsed = await readJsonlFile(path.join(root, filename), "offload-jsonl-corrupt");
    warnings.push(...parsed.warnings);
    for (const item of parsed.data) {
      const ref = toOffloadReference(item, filename);
      refs.push(ref);
      const refPath = path.join(root, ref.resultRef);
      if (!(await exists(refPath))) {
        warnings.push(warning(refPath, "offload-ref-missing", "warning", "Offload result reference was not found.", null));
      }
    }
  }
  return { data: refs, warnings };
}

async function findOffloadRoots(offloadRootPath: string): Promise<ParserResult<string[]>> {
  if (await exists(path.join(offloadRootPath, "mmds"))) return { data: [offloadRootPath], warnings: [] };
  const entries = await listDirectories(offloadRootPath);
  return { data: entries.data.map((entry) => path.join(offloadRootPath, entry)), warnings: entries.warnings };
}

function parseMmd(filename: string, sourcePath: string, content: string): ParserResult<OffloadCanvas> {
  const warnings: ParserWarning[] = [];
  const frontMatter = parseFrontMatter(content);
  const mermaidBody = extractMermaidBody(content);
  const graphLike = /\b(graph|flowchart)\s+(TD|LR|BT|RL)/i.test(mermaidBody);
  const nodes = extractMmdNodes(mermaidBody);
  if (!graphLike) {
    warnings.push(warning(sourcePath, "offload-mermaid-invalid", "warning", "Mermaid graph header was not found; raw fallback text was preserved.", null, preview(content)));
  }
  const canvasNodes = nodes.length > 0 ? nodes : [{
    nodeId: `raw:${stripExtension(filename)}`,
    label: "Raw Mermaid fallback",
    status: "unknown" as const,
    summary: preview(content),
    timestamp: null,
  }];
  return {
    data: {
      canvasId: readString(frontMatter.canvasId ?? frontMatter.canvas_id) || `mmd:${stripExtension(filename)}`,
      filename,
      path: sourcePath,
      taskGoal: readString(frontMatter.taskGoal ?? frontMatter.task_goal) || summarize(content),
      createdTime: nullableString(frontMatter.createdTime ?? frontMatter.created_time),
      updatedTime: nullableString(frontMatter.updatedTime ?? frontMatter.updated_time),
       doneCount: canvasNodes.filter((node) => node.status === "done").length,
       doingCount: canvasNodes.filter((node) => node.status === "doing").length,
       todoCount: canvasNodes.filter((node) => node.status === "todo").length,
       nodes: canvasNodes,
       refs: [],
       rawMetadata: jsonObjectOrNull({ ...frontMatter, mermaidSource: graphLike ? mermaidBody.trim() : "", fallbackText: graphLike ? "" : preview(content) }),
     },
     warnings,
   };
}

function extractMermaidBody(raw: string): string {
  if (raw.startsWith("---")) {
    const end = raw.indexOf("\n---", 3);
    if (end > 0) return raw.slice(end + 4).trim();
  }
  const metaMatch = raw.match(/^%%\{\s*[\s\S]*?\s*\}%%\s*/);
  if (metaMatch?.[0]) return raw.slice(metaMatch[0].length).trim();
  return raw.trim();
}

function extractMmdNodes(content: string): OffloadCanvasNode[] {
  const nodes: OffloadCanvasNode[] = [];
  const nodePattern = /([A-Za-z0-9_-]+)\["([^"\r\n]+)"\]/g;
  let match: RegExpExecArray | null;
  while ((match = nodePattern.exec(content)) !== null) {
    const nodeId = match[1] ?? "";
    const text = match[2] ?? "";
    const parts = text.split("|").map((part) => part.trim()).filter(Boolean);
    const explicitNodeId = parts.find((part) => /^[A-Za-z0-9_-]+$/.test(part) && part.includes("-N"));
    const status = normalizeStatus(parts.find((part) => ["done", "doing", "todo"].includes(part.toLowerCase())));
    const label = parts.find((part) => part !== explicitNodeId && normalizeStatus(part) === "unknown") || text;
    nodes.push({
      nodeId: explicitNodeId || nodeId,
      label,
      status,
      summary: label,
      timestamp: null,
    });
  }
  return nodes;
}

async function readJsonFile(
  filePath: string,
  codes: { readonly missingCode: string; readonly corruptCode: string },
): Promise<ParserResult<JsonValue | null>> {
  const file = await readTextFile(filePath, false);
  if (file.data === null) {
    return { data: null, warnings: [warning(filePath, codes.missingCode, "warning", "JSON file was not found.", null)] };
  }
  try {
    return { data: toJsonValue(JSON.parse(file.data)), warnings: [] };
  } catch (error) {
    return { data: null, warnings: [warning(filePath, codes.corruptCode, "error", messageFrom(error), null, preview(file.data))] };
  }
}

async function readJsonlFile(filePath: string, corruptCode: string): Promise<ParserResult<Record<string, unknown>[]>> {
  const file = await readTextFile(filePath, true);
  if (file.data === null) return { data: [], warnings: file.warnings };
  const warnings: ParserWarning[] = [...file.warnings];
  const records: Record<string, unknown>[] = [];
  const lines = file.data.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]?.trim() ?? "";
    if (!line) continue;
    try {
      const parsed = JSON.parse(line);
      if (isRecord(parsed)) records.push(parsed);
    } catch (error) {
      warnings.push(warning(filePath, corruptCode, "error", messageFrom(error), `line:${index + 1}`, preview(line)));
    }
  }
  return { data: records, warnings };
}

async function readTextFile(filePath: string, warnMissing: boolean): Promise<ParserResult<string | null>> {
  try {
    return { data: await readFile(filePath, "utf8"), warnings: [] };
  } catch (error) {
    if (isNotFound(error)) {
      return {
        data: null,
        warnings: warnMissing ? [warning(filePath, "file-missing", "warning", "File was not found.", null)] : [],
      };
    }
    return { data: null, warnings: [warning(filePath, "file-read-error", "error", messageFrom(error), null)] };
  }
}

async function listFiles(directory: string, extension: string, prefix = ""): Promise<ParserResult<string[]>> {
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    return {
      data: entries
        .filter((entry) => entry.isFile() && entry.name.endsWith(extension) && entry.name.startsWith(prefix))
        .map((entry) => entry.name)
        .sort(),
      warnings: [],
    };
  } catch (error) {
    if (isNotFound(error)) return { data: [], warnings: [] };
    return { data: [], warnings: [warning(directory, "directory-read-error", "error", messageFrom(error), null)] };
  }
}

async function listDirectories(directory: string): Promise<ParserResult<string[]>> {
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    return { data: entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort(), warnings: [] };
  } catch (error) {
    if (isNotFound(error)) return { data: [], warnings: [] };
    return { data: [], warnings: [warning(directory, "directory-read-error", "error", messageFrom(error), null)] };
  }
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

function toStructuredMemory(item: Record<string, unknown>, filename: string): StructuredMemorySummary {
  const metadata = isRecord(item.metadata) ? item.metadata : {};
  const timestamps = readStringList(item.timestamps);
  const timestampStart = readString(item.timestampStart ?? metadata.activity_start_time) || timestamps[0] || "";
  const timestampEnd = readString(item.timestampEnd ?? metadata.activity_end_time) || timestamps[timestamps.length - 1] || timestampStart;
  return {
    recordId: readString(item.recordId ?? item.id) || `memory:${filename}:${hashText(JSON.stringify(toJsonValue(item))).slice(0, 8)}`,
    content: readString(item.content),
    contentPreview: preview(readString(item.content)),
    type: readString(item.type) || "unknown",
    priority: readNumber(item.priority) ?? 0,
    sceneName: readString(item.sceneName ?? item.scene_name),
    sessionKey: readString(item.sessionKey),
    sessionId: readString(item.sessionId),
    sourceId: readString(item.sourceId) || readStringList(item.source_message_ids)[0] || "",
    timestampLabel: readString(item.timestampLabel) || timestampStart.slice(0, 10),
    timestampStart,
    timestampEnd,
    createdTime: readString(item.createdTime ?? item.createdAt),
    updatedTime: readString(item.updatedTime ?? item.updatedAt),
    score: readNumber(item.score),
    evidenceIds: readStringList(item.evidenceIds ?? item.source_message_ids),
    rawMetadata: jsonObjectOrNull(item.rawMetadata ?? metadata),
  };
}

function toStructuredMemoryFromSqlite(row: Record<string, unknown>): StructuredMemorySummary {
  const metadata = parseJsonObject(readString(row.metadata_json));
  const timestamps = readStringList(isRecord(metadata) ? metadata.timestamps : null);
  const timestampStart = readString(row.timestamp_start) || timestamps[0] || readString(row.timestamp_str);
  const timestampEnd = readString(row.timestamp_end) || timestamps[timestamps.length - 1] || timestampStart;
  const evidenceIds = isRecord(metadata) ? readStringList(metadata.source_message_ids ?? metadata.sourceMessageIds ?? metadata.evidenceIds) : [];

  return {
    recordId: readString(row.record_id) || `memory:sqlite:${hashText(JSON.stringify(toJsonValue(row))).slice(0, 8)}`,
    content: readString(row.content),
    contentPreview: preview(readString(row.content)),
    type: readString(row.type) || "unknown",
    priority: readNumber(row.priority) ?? 0,
    sceneName: readString(row.scene_name),
    sessionKey: readString(row.session_key),
    sessionId: readString(row.session_id),
    sourceId: evidenceIds[0] || "",
    timestampLabel: readString(row.timestamp_str) || timestampStart.slice(0, 10),
    timestampStart,
    timestampEnd,
    createdTime: readString(row.created_time),
    updatedTime: readString(row.updated_time),
    score: null,
    evidenceIds,
    rawMetadata: jsonObjectOrNull(metadata),
  };
}

function toConversationEvidence(item: Record<string, unknown>, filename: string): ConversationEvidence {
  const content = readString(item.snippet ?? item.content);
  return {
    recordId: readString(item.recordId ?? item.id) || `conversation:${filename}:${hashText(JSON.stringify(toJsonValue(item))).slice(0, 8)}`,
    sessionKey: readString(item.sessionKey),
    sessionId: readString(item.sessionId),
    role: readString(item.role) || "unknown",
    snippet: preview(content),
    recordedAt: readString(item.recordedAt),
    timestamp: readNumber(item.timestamp) ?? 0,
    score: readNumber(item.score),
    sourceMemoryIds: readStringList(item.sourceMemoryIds ?? item.source_memory_ids),
  };
}

function toConversationEvidenceFromSqlite(row: Record<string, unknown>): ConversationEvidence {
  const content = readString(row.message_text);
  return {
    recordId: readString(row.record_id) || `conversation:sqlite:${hashText(JSON.stringify(toJsonValue(row))).slice(0, 8)}`,
    sessionKey: readString(row.session_key),
    sessionId: readString(row.session_id),
    role: readString(row.role) || "unknown",
    snippet: preview(content),
    recordedAt: readString(row.recorded_at),
    timestamp: readNumber(row.timestamp) ?? 0,
    score: null,
    sourceMemoryIds: [],
  };
}

function toOffloadReference(item: Record<string, unknown>, filename: string): OffloadReference {
  return {
    toolCallId: readString(item.toolCallId ?? item.tool_call_id) || `tool:${filename}:${hashText(JSON.stringify(toJsonValue(item))).slice(0, 8)}`,
    nodeId: nullableString(item.nodeId ?? item.node_id),
    toolCall: readString(item.toolCall ?? item.tool_call),
    summary: readString(item.summary),
    resultRef: normalizeRelativePath(readString(item.resultRef ?? item.result_ref)),
    timestamp: readString(item.timestamp),
    sessionKey: nullableString(item.sessionKey ?? item.session_key),
    score: readNumber(item.score),
  };
}

function parseSceneMarkdown(raw: string): {
  readonly hasMeta: boolean;
  readonly meta: Record<string, string>;
  readonly content: string;
  readonly summary: string;
  readonly heat: number;
  readonly updated: string;
} {
  const startIndex = raw.indexOf(META_START);
  const endIndex = raw.indexOf(META_END);
  if (startIndex < 0 || endIndex < 0 || endIndex < startIndex) {
    return { hasMeta: false, meta: {}, content: raw.trim(), summary: "", heat: 0, updated: "" };
  }
  const meta = parseKeyValueBlock(raw.slice(startIndex + META_START.length, endIndex));
  const content = raw.slice(endIndex + META_END.length).trim();
  return {
    hasMeta: true,
    meta,
    content,
    summary: readString(meta.summary),
    heat: readNumber(meta.heat) ?? 0,
    updated: readString(meta.updated),
  };
}

function parseFrontMatter(raw: string): Record<string, string> {
  if (raw.startsWith("---")) {
    const end = raw.indexOf("\n---", 3);
    if (end > 0) return parseKeyValueBlock(raw.slice(3, end));
  }
  const metaMatch = raw.match(/^%%\{\s*([\s\S]*?)\s*\}%%/);
  if (!metaMatch) return {};
  try {
    const parsed = JSON.parse(`{${metaMatch[1] ?? ""}}`);
    return isRecord(parsed) ? stringifyRecord(parsed) : {};
  } catch {
    return {};
  }
}

function parseMarkdownKeyValues(raw: string): Record<string, string> {
  const metadata: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const match = line.match(/^\s*-\s*([A-Za-z0-9_-]+):\s*`?([^`]+?)`?\s*$/);
    if (match) metadata[match[1] ?? ""] = (match[2] ?? "").trim();
  }
  return metadata;
}

function parseKeyValueBlock(raw: string): Record<string, string> {
  const metadata: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z0-9_-]+):\s*(.*?)\s*$/);
    if (match) metadata[match[1] ?? ""] = (match[2] ?? "").trim();
  }
  return metadata;
}

function warning(
  source: string,
  code: string,
  severity: ParserWarningSeverity,
  message: string,
  location: string | null,
  rawValue: JsonValue | null = null,
): ParserWarning {
  return { source, code, severity, message, location, rawValue };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNotFound(error: unknown): boolean {
  return isRecord(error) && error.code === "ENOENT";
}

function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function readString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function nullableString(value: unknown): string | null {
  const text = readString(value);
  return text ? text : null;
}

function readNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function readStringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  if (typeof value === "string" && value.trim() !== "") return value.split(",").map((item) => item.trim()).filter(Boolean);
  return [];
}

function parseJsonObject(raw: string): Record<string, unknown> {
  if (!raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function toJsonValue(value: unknown): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map((item) => toJsonValue(item));
  if (isRecord(value)) {
    const output: Record<string, JsonValue> = {};
    for (const [key, item] of Object.entries(value)) output[key] = toJsonValue(item);
    return output;
  }
  return null;
}

function jsonObjectOrNull(value: unknown): JsonValue | null {
  if (!isRecord(value)) return null;
  return toJsonValue(value);
}

function stringifyRecord(value: Record<string, unknown>): Record<string, string> {
  const output: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === "string") output[key] = item;
    else if (typeof item === "number" || typeof item === "boolean") output[key] = String(item);
  }
  return output;
}

function preview(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, 160);
}

function summarize(text: string): string {
  return preview(text).slice(0, 96);
}

function extractMarkdownTitle(raw: string): string {
  const title = raw.match(/^#\s+(.+)$/m);
  return title ? (title[1] ?? "").trim() : "";
}

function hashText(text: string): string {
  return createHash("md5").update(text).digest("hex");
}

function stripExtension(filename: string): string {
  return filename.replace(/\.[^.]+$/, "");
}

function dateToMs(value: string): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeStatus(value: string | undefined): OffloadNodeStatus {
  const lowered = value?.toLowerCase();
  if (lowered === "done" || lowered === "doing" || lowered === "todo") return lowered;
  return "unknown";
}

function normalizeRelativePath(value: string): string {
  return value.replaceAll("\\", "/");
}
