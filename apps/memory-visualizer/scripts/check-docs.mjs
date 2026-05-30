#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = fileURLToPath(new URL("..", import.meta.url));
const repoRoot = path.resolve(appRoot, "..", "..");

const docsPath = path.join(repoRoot, "docs", "visualization-web.md");
const readmePath = path.join(appRoot, "README.md");

const requiredHeadings = [
  "## Overview",
  "## Run Locally",
  "## Data Sources",
  "## Read-only Boundary",
  "## Supported Views",
  "## Limitations",
  "## Official Tool Replacement Strategy",
  "## QA Commands",
];

const requiredCommands = [
  "node apps/memory-visualizer/scripts/check-docs.mjs",
  "npm --prefix apps/memory-visualizer install",
  "npm --prefix apps/memory-visualizer run dev",
  "npm --prefix apps/memory-visualizer run typecheck",
  "npm --prefix apps/memory-visualizer test",
  "npm --prefix apps/memory-visualizer run build",
  "npm --prefix apps/memory-visualizer run start",
  "npm --prefix apps/memory-visualizer run safety:readonly",
  "npm --prefix apps/memory-visualizer run check:docker",
];

const requiredEnvVars = [
  "TDAI_VIS_DATA_DIR",
  "TDAI_VIS_OFFLOAD_ROOT",
  "TDAI_VIS_GATEWAY_URL",
  "TDAI_VIS_GATEWAY_API_KEY",
];

const requiredViews = [
  "Overview",
  "Scene Map",
  "Memory Explorer",
  "Evidence Drill-down",
  "Offload Task Canvas",
  "Search/Recall Debug",
  "Settings/Status",
];

const requiredBoundaryPhrases = [
  "no edit",
  "no delete",
  "no merge",
  "no reindex",
  "no capture",
  "no seed",
  "no session-end",
  "no profile sync writes",
  "no persona writes",
  "no scene writes",
  "no DB migrations",
];

const requiredDocPhrases = [
  "request or ui path",
  "environment variables",
  "app-local config",
  "empty state",
  "gateway `/search/*` output is raw formatted debug text, not structured primary data",
  "local-only",
  "read-only",
  "app-local",
  "replaceable",
  "`tdai_memory_data`",
  "read-only at `/data/memory-tdai:ro`",
  "direct `npm --prefix apps/memory-visualizer run start` listens on `127.0.0.1:8421` by default",
  "TDAI_VIS_OFFLOAD_ROOT=/data/memory-tdai/offload",
  "leaves `TDAI_VIS_GATEWAY_URL` unset by default",
];

const forbiddenPositivePatterns = [
  /supports production hosting/i,
  /offers production hosting/i,
  /supports remote multi-user access/i,
  /offers remote multi-user access/i,
  /supports auth(?:entication)?/i,
  /edit memory from the ui/i,
  /delete memory from the ui/i,
  /reindex from the ui/i,
  /capture conversations from the ui/i,
  /run seed imports from the ui/i,
  /session-end action in the ui/i,
];

function assertContainsAll(label, text, values, failures) {
  for (const value of values) {
    if (!text.includes(value)) {
      failures.push(`${label} missing: ${value}`);
    }
  }
}

function assertContainsAllInsensitive(label, text, values, failures) {
  const normalized = text.toLowerCase();
  for (const value of values) {
    if (!normalized.includes(value.toLowerCase())) {
      failures.push(`${label} missing: ${value}`);
    }
  }
}

function assertForbiddenPatterns(label, text, patterns, failures) {
  for (const pattern of patterns) {
    if (pattern.test(text)) {
      failures.push(`${label} contains forbidden claim: ${pattern}`);
    }
  }
}

async function main() {
  const [docsText, readmeText] = await Promise.all([
    readFile(docsPath, "utf8"),
    readFile(readmePath, "utf8"),
  ]);

  const combined = `${docsText}\n${readmeText}`;
  const failures = [];

  assertContainsAll("docs headings", docsText, requiredHeadings, failures);
  assertContainsAll("combined commands", combined, requiredCommands, failures);
  assertContainsAll("docs env vars", docsText, requiredEnvVars, failures);
  assertContainsAll("docs views", docsText, requiredViews, failures);
  assertContainsAll("docs boundary phrases", docsText, requiredBoundaryPhrases, failures);
  assertContainsAllInsensitive("docs required phrases", docsText, requiredDocPhrases, failures);

  if (!docsText.includes("This app is read-only by design.")) {
    failures.push("docs missing explicit read-only design sentence");
  }

  if (!docsText.includes("It does not edit memory, delete memory, merge memory, reindex data, capture conversations, run seed imports, trigger session-end flushes")) {
    failures.push("docs missing explicit no-write exclusion sentence");
  }

  if (!readmeText.includes("node apps/memory-visualizer/scripts/check-docs.mjs")) {
    failures.push("README missing docs checker command");
  }

  if (!readmeText.includes("Gateway `/search/*` is debug text, not structured primary data.")) {
    failures.push("README missing Gateway debug text note");
  }

  assertForbiddenPatterns("combined docs", combined, forbiddenPositivePatterns, failures);

  if (failures.length > 0) {
    console.error("Documentation checks failed:");
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log("Documentation checks passed.");
  console.log(`Validated headings: ${requiredHeadings.length}`);
  console.log(`Validated commands: ${requiredCommands.length}`);
  console.log(`Validated boundary phrases: ${requiredBoundaryPhrases.length}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
