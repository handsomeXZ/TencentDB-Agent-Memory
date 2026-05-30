import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  createDataSourceConfigFromRoot,
  parseConversationEvidence,
  parseLocalMemorySource,
  parseMetadata,
  parseOffloadCanvases,
  parsePersona,
  parseSceneBlocks,
  parseStructuredMemories,
} from "./index";

const appRoot = fileURLToPath(new URL("../..", import.meta.url));
const fixturesRoot = path.join(appRoot, "fixtures");

const fixtureNames = [
  "complete-data-dir",
  "missing-metadata",
  "corrupt-json",
  "empty-scenes",
  "missing-persona",
  "empty-conversations",
  "offload-invalid-mermaid",
  "offload-missing-refs",
  "missing-evidence",
  "windows-paths",
] as const;

function configForFixture(name: (typeof fixtureNames)[number]) {
  return createDataSourceConfigFromRoot(path.join(fixturesRoot, name));
}

function warningCodes(warnings: readonly { readonly code: string }[]) {
  return warnings.map((item) => item.code);
}

describe("local memory parsers", () => {
  it("parsers complete-data-dir into every major dashboard layer", async () => {
    const result = await parseLocalMemorySource(configForFixture("complete-data-dir"));

    expect(result.metadata.manifest).toMatchObject({ version: 1 });
    expect(result.metadata.checkpoint).toMatchObject({ l1: { completedAt: "2026-05-30T00:00:02.000Z" } });
    expect(result.persona).toMatchObject({
      profileId: "profile:v1:fixture",
      title: "Coding preferences",
      sceneIds: ["scene:contracts"],
    });
    expect(result.scenes).toHaveLength(1);
    expect(result.scenes[0]).toMatchObject({ sceneId: "scene:contracts", heatScore: 0.82, memoryCount: 4 });
    expect(result.structuredMemories).toHaveLength(4);
    expect(result.structuredMemories[0]).toMatchObject({ recordId: "l1:memory:1", evidenceIds: ["l0:message:1"] });
    expect(result.structuredMemories).toEqual(expect.arrayContaining([expect.objectContaining({ recordId: "l1:memory:3", type: "persona", priority: 85 })]));
    expect(result.conversationEvidence).toHaveLength(6);
    expect(result.offloadCanvases).toHaveLength(1);
    expect(result.offloadCanvases[0]).toMatchObject({
      canvasId: "mmd:001",
      doneCount: 1,
      todoCount: 1,
      refs: [{ toolCallId: "call-001" }],
    });
    expect(JSON.parse(JSON.stringify(result)).persona.profileId).toBe("profile:v1:fixture");
    expect(warningCodes(result.warnings)).not.toContain("metadata-manifest-corrupt");
    expect(warningCodes(result.warnings)).not.toContain("memory-jsonl-corrupt");
    expect(warningCodes(result.warnings)).not.toContain("offload-mermaid-invalid");
  });

  it.each(fixtureNames)("parses fixture %s without uncaught exceptions", async (fixtureName) => {
    const result = await parseLocalMemorySource(configForFixture(fixtureName));

    expect(JSON.parse(JSON.stringify(result))).toMatchObject({ warnings: expect.any(Array) });
  });

  it("warns for missing metadata while keeping available persona data", async () => {
    const config = configForFixture("missing-metadata");
    const [metadata, persona] = await Promise.all([parseMetadata(config), parsePersona(config)]);

    expect(metadata.data.manifest).toBeNull();
    expect(warningCodes(metadata.warnings)).toContain("metadata-manifest-missing");
    expect(persona.data?.available).toBe(true);
  });

  it("returns partial L1 data and line-specific warnings for corrupt JSON/JSONL", async () => {
    const config = configForFixture("corrupt-json");
    const [metadata, memories, result] = await Promise.all([
      parseMetadata(config),
      parseStructuredMemories(config),
      parseLocalMemorySource(config),
    ]);

    expect(warningCodes(metadata.warnings)).toContain("metadata-manifest-corrupt");
    expect(memories.data).toHaveLength(1);
    expect(memories.data[0]?.recordId).toBe("l1:broken:1");
    expect(memories.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "memory-jsonl-corrupt", location: "line:2" }),
      ]),
    );
    expect(JSON.parse(JSON.stringify(result)).structuredMemories).toHaveLength(1);
  });

  it("degrades gracefully when persona is missing", async () => {
    const persona = await parsePersona(configForFixture("missing-persona"));

    expect(persona.data).toBeNull();
    expect(warningCodes(persona.warnings)).toContain("persona-missing");
  });

  it("keeps scene index entries available when persona is missing", async () => {
    const scenes = await parseSceneBlocks(configForFixture("missing-persona"));

    expect(scenes.data).toHaveLength(1);
    expect(scenes.data[0]).toMatchObject({
      sceneId: "scene:no-persona",
      title: "Persona omitted",
      filename: "no-persona.md",
    });
  });

  it("prefers canonical metadata scene index entries over legacy scene_blocks index entries", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "tdai-vis-scenes-"));
    const scenesDir = path.join(root, "scene_blocks");
    await Promise.all([
      mkdir(path.join(root, ".metadata"), { recursive: true }),
      mkdir(scenesDir, { recursive: true }),
    ]);
    await writeFile(path.join(scenesDir, "contracts.md"), [
      "-----META-START-----",
      "summary: markdown summary",
      "heat: 0.1",
      "updated: 2026-05-30T00:00:00.000Z",
      "-----META-END-----",
      "# Markdown title",
      "Scene content.",
    ].join("\n"), "utf8");
    await writeFile(path.join(root, ".metadata", "scene_index.json"), JSON.stringify([
      { filename: "contracts.md", sceneId: "scene:canonical", title: "Canonical title", summary: "Canonical summary", heat: 0.82, memoryCount: 4 },
    ]), "utf8");
    await writeFile(path.join(scenesDir, "index.json"), JSON.stringify([
      { filename: "contracts.md", sceneId: "scene:legacy", title: "Legacy title", summary: "Legacy summary", heat: 0.2, memoryCount: 1 },
    ]), "utf8");

    const scenes = await parseSceneBlocks(createDataSourceConfigFromRoot(root));

    expect(scenes.data).toHaveLength(1);
    expect(scenes.data[0]).toMatchObject({
      sceneId: "scene:canonical",
      title: "Canonical title",
      contentSummary: "Canonical summary",
      heatScore: 0.82,
      memoryCount: 4,
    });
  });

  it("ignores empty scene files without inventing scene data", async () => {
    const scenes = await parseSceneBlocks(configForFixture("empty-scenes"));

    expect(scenes.data).toEqual([]);
  });

  it("parses empty conversation JSONL as an empty evidence set", async () => {
    const evidence = await parseConversationEvidence(configForFixture("empty-conversations"));

    expect(evidence.data).toEqual([]);
    expect(warningCodes(evidence.warnings)).not.toContain("conversation-jsonl-corrupt");
  });

  it("preserves invalid Mermaid fallback text and warns instead of crashing", async () => {
    const offload = await parseOffloadCanvases(configForFixture("offload-invalid-mermaid"));

    expect(offload.data).toHaveLength(1);
    expect(offload.data[0]?.nodes[0]).toMatchObject({ status: "unknown" });
    expect(offload.data[0]?.rawMetadata).toMatchObject({ fallbackText: expect.stringContaining("not mermaid") });
    expect(warningCodes(offload.warnings)).toContain("offload-mermaid-invalid");
    expect(JSON.parse(JSON.stringify(offload.data[0]))).toMatchObject({ refs: [{ toolCallId: "call-invalid-001" }] });
  });

  it("warns when offload result refs are missing but keeps canvas data", async () => {
    const offload = await parseOffloadCanvases(configForFixture("offload-missing-refs"));

    expect(offload.data).toHaveLength(1);
    expect(offload.data[0]).toMatchObject({ doneCount: 1, refs: [{ resultRef: "refs/absent.md" }] });
    expect(warningCodes(offload.warnings)).toContain("offload-ref-missing");
  });

  it("keeps missing-evidence memories while leaving referenced L0 ids unresolved", async () => {
    const result = await parseLocalMemorySource(configForFixture("missing-evidence"));

    expect(result.structuredMemories).toHaveLength(1);
    expect(result.structuredMemories[0]).toMatchObject({ recordId: "l1:memory:missing-1", evidenceIds: ["l0:message:missing-404"] });
    expect(result.conversationEvidence).toHaveLength(1);
    expect(result.conversationEvidence[0]?.recordId).toBe("l0:message:present-1");
  });

  it("reads structured memory and conversation metadata from vectors.db when JSONL files are absent", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "tdai-vis-sqlite-"));
    await Promise.all([
      mkdir(path.join(root, ".metadata"), { recursive: true }),
      mkdir(path.join(root, "records"), { recursive: true }),
      mkdir(path.join(root, "conversations"), { recursive: true }),
    ]);
    await writeFile(path.join(root, ".metadata", "manifest.json"), JSON.stringify({ version: 1, store: { type: "sqlite", sqlite: { path: "vectors.db" } } }), "utf8");
    await writeFile(path.join(root, ".metadata", "checkpoint.json"), JSON.stringify({}), "utf8");

    const db = new DatabaseSync(path.join(root, "vectors.db"));
    try {
      db.exec(`
        CREATE TABLE l1_records (
          record_id TEXT PRIMARY KEY,
          content TEXT NOT NULL,
          type TEXT DEFAULT '',
          priority INTEGER DEFAULT 50,
          scene_name TEXT DEFAULT '',
          session_key TEXT DEFAULT '',
          session_id TEXT DEFAULT '',
          timestamp_str TEXT DEFAULT '',
          timestamp_start TEXT DEFAULT '',
          timestamp_end TEXT DEFAULT '',
          created_time TEXT DEFAULT '',
          updated_time TEXT DEFAULT '',
          metadata_json TEXT DEFAULT '{}'
        );
        CREATE TABLE l0_conversations (
          record_id TEXT PRIMARY KEY,
          session_key TEXT NOT NULL,
          session_id TEXT DEFAULT '',
          role TEXT NOT NULL DEFAULT '',
          message_text TEXT NOT NULL,
          recorded_at TEXT DEFAULT '',
          timestamp INTEGER DEFAULT 0
        );
      `);
      db.prepare(`
        INSERT INTO l1_records (
          record_id, content, type, priority, scene_name, session_key, session_id,
          timestamp_str, timestamp_start, timestamp_end, created_time, updated_time, metadata_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        "l1:sqlite:1",
        "Remember that OpenCode uses explicit memory tools.",
        "constraint",
        88,
        "opencode",
        "agent:opencode:session-1",
        "session-1",
        "2026-05-30T01:00:00.000Z",
        "2026-05-30T01:00:00.000Z",
        "2026-05-30T01:05:00.000Z",
        "2026-05-30T01:00:00.000Z",
        "2026-05-30T01:05:00.000Z",
        JSON.stringify({ source_message_ids: ["l0:sqlite:1"] }),
      );
      db.prepare(`
        INSERT INTO l0_conversations (record_id, session_key, session_id, role, message_text, recorded_at, timestamp)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        "l0:sqlite:1",
        "agent:opencode:session-1",
        "session-1",
        "user",
        "Use the explicit memory tools for OpenCode verification.",
        "2026-05-30T01:00:00.000Z",
        1770000000000,
      );
    } finally {
      db.close();
    }

    const result = await parseLocalMemorySource(createDataSourceConfigFromRoot(root));

    expect(result.structuredMemories).toEqual([
      expect.objectContaining({ recordId: "l1:sqlite:1", evidenceIds: ["l0:sqlite:1"], priority: 88 }),
    ]);
    expect(result.conversationEvidence).toEqual([
      expect.objectContaining({ recordId: "l0:sqlite:1", role: "user" }),
    ]);
    expect(warningCodes(result.warnings)).not.toContain("sqlite-metadata-reader-disabled");
  });

  it("keeps Windows-style path text as safe serializable content", async () => {
    const result = await parseLocalMemorySource(configForFixture("windows-paths"));

    expect(result.persona?.contentPreview).toContain("C:\\\\fixture-root");
    expect(result.conversationEvidence[0]?.snippet).toContain("C:\\fixture-root");
    expect(JSON.stringify(result)).toContain("fixture-root");
  });
});
