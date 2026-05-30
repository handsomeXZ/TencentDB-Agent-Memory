#!/usr/bin/env node

import { readFile, readdir, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = fileURLToPath(new URL("..", import.meta.url));
const fixturesRoot = join(appRoot, "fixtures");

const scenarioNames = [
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
];

function displayPath(path) {
  return relative(appRoot, path).replaceAll("\\", "/");
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function readText(path) {
  return readFile(path, "utf8");
}

async function readJson(path) {
  return JSON.parse(await readText(path));
}

async function readJsonl(path) {
  const content = await readText(path);
  if (content.trim() === "") {
    return [];
  }
  return content
    .split(/\r?\n/)
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line));
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function validateCompleteDataDir(root) {
  const manifest = await readJson(join(root, ".metadata", "manifest.json"));
  assert(manifest.store?.sqlite?.path === "vectors.db", "complete-data-dir manifest should point to vectors.db");

  const fixture = await readJson(join(root, "fixture.json"));
  assert(fixture.offloadAgentDir === "offload/agent-planner", "complete-data-dir fixture manifest should declare offload agent dir");

  const persona = await readText(join(root, "profiles", "persona.md"));
  assert(persona.includes("profile:v1:fixture"), "complete-data-dir persona should contain synthetic profile id");

  const scenes = await readJson(join(root, "scene_blocks", "index.json"));
  assert(Array.isArray(scenes) && scenes.length === 1, "complete-data-dir should contain exactly one indexed scene");

  const sceneBlock = await readText(join(root, "scene_blocks", "contracts.md"));
  assert(sceneBlock.includes("-----META-START-----") && sceneBlock.includes("heat: 0.82"), "complete-data-dir scene block should include META fields");

  const records = await readJsonl(join(root, "records", "memory-records.jsonl"));
  assert(records.length === 4, "complete-data-dir should contain four L1 records");
  assert(records.some((item) => item.type === "persona" && item.priority >= 80), "complete-data-dir should contain a persona memory with priority >= 80");
  assert(records[0]?.recordId === "l1:memory:1", "complete-data-dir first L1 record id mismatch");

  const conversations = await readJsonl(join(root, "conversations", "session-alpha.jsonl"));
  assert(conversations.length === 6, "complete-data-dir should contain six L0 messages");

  const offloadEntries = await readJsonl(join(root, "offload", "agent-planner", "offload-session-alpha.jsonl"));
  assert(offloadEntries.length === 1, "complete-data-dir should contain one offload entry");
  assert(offloadEntries[0]?.resultRef === "refs/call-001.md", "complete-data-dir offload entry should target refs/call-001.md");

  const refFile = await readText(join(root, "offload", "agent-planner", "refs", "call-001.md"));
  assert(refFile.includes("call-001"), "complete-data-dir ref file should match offload entry");

  const mmd = await readText(join(root, "offload", "agent-planner", "mmds", "001-contracts.mmd"));
  assert(mmd.includes("graph TD"), "complete-data-dir Mermaid canvas should be valid-ish graph content");

  const state = await readJson(join(root, "offload", "agent-planner", "state.json"));
  assert(state.activeCanvas === "001-contracts.mmd", "complete-data-dir state.json should point at 001-contracts.mmd");
}

async function validateMissingMetadata(root) {
  assert(!(await exists(join(root, ".metadata", "manifest.json"))), "missing-metadata should not contain .metadata/manifest.json");
  assert(await exists(join(root, ".metadata", "checkpoint.json")), "missing-metadata should still contain checkpoint.json");
  const persona = await readText(join(root, "profiles", "persona.md"));
  assert(persona.includes("manifest metadata is intentionally absent"), "missing-metadata persona should explain the scenario");
}

async function validateCorruptJson(root) {
  let manifestFailed = false;
  try {
    await readJson(join(root, ".metadata", "manifest.json"));
  } catch {
    manifestFailed = true;
  }
  assert(manifestFailed, "corrupt-json manifest.json should fail JSON.parse");

  let jsonlFailed = false;
  try {
    await readJsonl(join(root, "records", "broken.jsonl"));
  } catch {
    jsonlFailed = true;
  }
  assert(jsonlFailed, "corrupt-json broken.jsonl should fail JSON.parse");
}

async function validateEmptyScenes(root) {
  const scenes = await readJson(join(root, "scene_blocks", "index.json"));
  assert(Array.isArray(scenes) && scenes.length === 0, "empty-scenes index.json should be an empty array");
  const block = await readText(join(root, "scene_blocks", "empty.md"));
  assert(block.trim() === "", "empty-scenes block file should be empty");
}

async function validateMissingPersona(root) {
  assert(!(await exists(join(root, "profiles", "persona.md"))), "missing-persona should not contain profiles/persona.md");
  const manifest = await readJson(join(root, ".metadata", "manifest.json"));
  assert(manifest.version === 1, "missing-persona should keep a tiny valid manifest");
}

async function validateEmptyConversations(root) {
  const content = await readText(join(root, "conversations", "session-empty.jsonl"));
  assert(content.trim() === "", "empty-conversations session-empty.jsonl should be empty");
}

async function validateOffloadInvalidMermaid(root) {
  const mmd = await readText(join(root, "offload", "agent-planner", "mmds", "invalid.mmd"));
  assert(!/^\s*(graph|flowchart)\b/m.test(mmd), "offload-invalid-mermaid should omit a Mermaid graph header");
  const entries = await readJsonl(join(root, "offload", "agent-planner", "offload-session-beta.jsonl"));
  assert(entries[0]?.resultRef === "refs/call-invalid-001.md", "offload-invalid-mermaid should keep a matching ref path");
  assert(await exists(join(root, "offload", "agent-planner", "refs", "call-invalid-001.md")), "offload-invalid-mermaid should keep its referenced ref file");
}

async function validateOffloadMissingRefs(root) {
  const entries = await readJsonl(join(root, "offload", "agent-planner", "offload-session-gamma.jsonl"));
  assert(entries.length === 1, "offload-missing-refs should contain one offload entry");
  assert(!(await exists(join(root, "offload", "agent-planner", entries[0].resultRef))), "offload-missing-refs should point at a missing ref file");
}

async function validateMissingEvidence(root) {
  const records = await readJsonl(join(root, "records", "memory-records.jsonl"));
  const conversations = await readJsonl(join(root, "conversations", "session-missing.jsonl"));
  assert(records.length === 1, "missing-evidence should contain one L1 record");
  assert(records[0]?.evidenceIds?.[0] === "l0:message:missing-404", "missing-evidence should point at a missing evidence id");
  assert(conversations.length === 1, "missing-evidence should contain one conversation row");
  assert(!conversations.some((item) => item.recordId === "l0:message:missing-404"), "missing-evidence should omit the referenced L0 record");
}

async function validateWindowsPaths(root) {
  const persona = await readText(join(root, "profiles", "persona.md"));
  const conversation = await readText(join(root, "conversations", "session-win.jsonl"));
  assert(persona.includes("C:\\\\fixture-root\\\\memory\\\\profiles\\\\persona.md"), "windows-paths persona should contain a synthetic Windows path");
  assert(conversation.includes("C:\\\\fixture-root\\\\memory\\\\records\\\\memory-records.jsonl"), "windows-paths conversation should contain a synthetic Windows path");
}

const validators = {
  "complete-data-dir": validateCompleteDataDir,
  "missing-metadata": validateMissingMetadata,
  "corrupt-json": validateCorruptJson,
  "empty-scenes": validateEmptyScenes,
  "missing-persona": validateMissingPersona,
  "empty-conversations": validateEmptyConversations,
  "offload-invalid-mermaid": validateOffloadInvalidMermaid,
  "offload-missing-refs": validateOffloadMissingRefs,
  "missing-evidence": validateMissingEvidence,
  "windows-paths": validateWindowsPaths,
};

async function main() {
  const entries = await readdir(fixturesRoot, { withFileTypes: true });
  const actualScenarioNames = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  const expectedScenarioNames = [...scenarioNames].sort();

  assert(
    JSON.stringify(actualScenarioNames) === JSON.stringify(expectedScenarioNames),
    `fixture directories mismatch: expected ${expectedScenarioNames.join(", ")} but found ${actualScenarioNames.join(", ")}`,
  );

  for (const scenarioName of scenarioNames) {
    const root = join(fixturesRoot, scenarioName);
    assert(await exists(join(root, "fixture.json")), `${scenarioName} should contain fixture.json`);
    await validators[scenarioName](root);
    console.log(`validated ${displayPath(root)}`);
  }

  console.log(`validated ${scenarioNames.length} fixture scenarios`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
