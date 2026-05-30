#!/usr/bin/env node

import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = fileURLToPath(new URL("..", import.meta.url));
const fixturesRoot = join(appRoot, "fixtures");

const forbiddenPatterns = [
  { label: "apiKey", pattern: /apiKey/g },
  { label: "Bearer ", pattern: /Bearer /g },
  { label: "TDAI_GATEWAY_API_KEY=", pattern: /TDAI_GATEWAY_API_KEY=/g },
  { label: "PRIVATE_KEY=", pattern: /PRIVATE_KEY=/g },
];

function toDisplayPath(path) {
  return relative(appRoot, path).replaceAll("\\", "/");
}

function findLine(content, index) {
  return content.slice(0, index).split(/\r?\n/).length;
}

async function collectFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(fullPath)));
      continue;
    }
    if (entry.isFile()) {
      files.push(fullPath);
    }
  }

  return files;
}

async function scanFile(filePath) {
  const content = await readFile(filePath, "utf8");
  const violations = [];

  for (const forbidden of forbiddenPatterns) {
    for (const match of content.matchAll(forbidden.pattern)) {
      if (match.index === undefined) {
        continue;
      }
      violations.push({
        filePath,
        line: findLine(content, match.index),
        pattern: forbidden.label,
      });
    }
  }

  return violations;
}

async function main() {
  const files = await collectFiles(fixturesRoot);
  const violations = (await Promise.all(files.map(scanFile))).flat();

  console.log(`Scanned fixture files: ${files.length}`);

  if (violations.length > 0) {
    console.error("Forbidden fixture secret patterns found:");
    for (const violation of violations) {
      console.error(`- ${toDisplayPath(violation.filePath)}:${violation.line} matched ${violation.pattern}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log("No forbidden fixture secret patterns found.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
