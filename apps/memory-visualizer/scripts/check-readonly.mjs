#!/usr/bin/env node

import { readdir, readFile, stat } from "node:fs/promises";
import { extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = fileURLToPath(new URL("..", import.meta.url));
const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
const composePaths = [
  join(repoRoot, "docker", "standalone", "docker-compose.yml"),
  join(repoRoot, "docker", "standalone", "docker-compose.ghcr.yml"),
];
const scanRoots = ["src"];
const productionExtensions = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);
const ignoredFilePatterns = [/\.test\.[cm]?[jt]sx?$/, /\.spec\.[cm]?[jt]sx?$/];

const forbiddenGatewayEndpoints = ["/capture", "/session/end", "/seed"];
const forbiddenWritePatterns = [
  /\bwriteFile(?:Sync)?\s*\(/,
  /\bappendFile(?:Sync)?\s*\(/,
  /\bcreateWriteStream\s*\(/,
  /\btruncate(?:Sync)?\s*\(/,
  /\brm(?:Sync)?\s*\(/,
  /\brmdir(?:Sync)?\s*\(/,
  /\bunlink(?:Sync)?\s*\(/,
  /\brename(?:Sync)?\s*\(/,
  /\bcopyFile(?:Sync)?\s*\(/,
  /\bcp(?:Sync)?\s*\(/,
  /\bmkdir(?:Sync)?\s*\(/,
  /\bmkdtemp(?:Sync)?\s*\(/,
  /\bchmod(?:Sync)?\s*\(/,
  /\bchown(?:Sync)?\s*\(/,
  /\blchmod(?:Sync)?\s*\(/,
  /\blchown(?:Sync)?\s*\(/,
  /\butimes(?:Sync)?\s*\(/,
  /\blutimes(?:Sync)?\s*\(/,
  /\bsymlink(?:Sync)?\s*\(/,
  /\blink(?:Sync)?\s*\(/,
  /\bfs\.promises\.(?:writeFile|appendFile|truncate|rm|rmdir|unlink|rename|copyFile|cp|mkdir|mkdtemp|chmod|chown|lchmod|lchown|utimes|lutimes|symlink|link)\s*\(/,
  /\bfs\.(?:writeFile|writeFileSync|appendFile|appendFileSync|createWriteStream|truncate|truncateSync|rm|rmSync|rmdir|rmdirSync|unlink|unlinkSync|rename|renameSync|copyFile|copyFileSync|cp|cpSync|mkdir|mkdirSync|mkdtemp|mkdtempSync|chmod|chmodSync|chown|chownSync|lchmod|lchmodSync|lchown|lchownSync|utimes|utimesSync|lutimes|lutimesSync|symlink|symlinkSync|link|linkSync)\s*\(/,
];

async function collectProductionFiles(directory) {
  const files = [];
  const entries = await readdir(directory, { withFileTypes: true });

  for (const entry of entries) {
    const path = join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await collectProductionFiles(path)));
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    if (!productionExtensions.has(extname(entry.name))) {
      continue;
    }

    if (ignoredFilePatterns.some((pattern) => pattern.test(entry.name))) {
      continue;
    }

    files.push(path);
  }

  return files;
}

function findLine(content, index) {
  return content.slice(0, index).split("\n").length;
}

async function scanFile(filePath) {
  const content = await readFile(filePath, "utf8");
  const violations = [];

  for (const endpoint of forbiddenGatewayEndpoints) {
    let index = content.indexOf(endpoint);
    while (index !== -1) {
      violations.push({
        filePath,
        line: findLine(content, index),
        reason: `forbidden Gateway endpoint ${endpoint}`,
      });
      index = content.indexOf(endpoint, index + endpoint.length);
    }
  }

  for (const pattern of forbiddenWritePatterns) {
    const match = pattern.exec(content);
    if (match?.index !== undefined) {
      violations.push({
        filePath,
        line: findLine(content, match.index),
        reason: `forbidden file mutation API ${pattern.source}`,
      });
    }
  }

  return violations;
}

async function main() {
  const scannedDirectories = [];
  const files = [];

  for (const root of scanRoots) {
    const absoluteRoot = join(appRoot, root);
    await stat(absoluteRoot);
    scannedDirectories.push(root);
    files.push(...(await collectProductionFiles(absoluteRoot)));
  }

  const violations = (await Promise.all(files.map(scanFile))).flat();
  violations.push(...(await validateComposeTelemetrySafety()));

  console.log(`Readonly safety scan directories: ${scannedDirectories.join(", ")}`);
  console.log(`Readonly safety scan files: ${files.length}`);

  if (violations.length > 0) {
    console.error("Readonly safety violations found:");
    for (const violation of violations) {
      const displayPath = relative(appRoot, violation.filePath).replaceAll("\\", "/");
      console.error(`- ${displayPath}:${violation.line} ${violation.reason}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log("Readonly safety scan passed.");
}

async function validateComposeTelemetrySafety() {
  const violations = [];

  for (const composePath of composePaths) {
    const content = await readFile(composePath, "utf8");
    const displayPath = relative(repoRoot, composePath).replaceAll("\\", "/");
    const visualizerBlock = readServiceBlock(content, "tdai-visualizer");

    if (visualizerBlock === null) {
      violations.push({
        filePath: composePath,
        line: 1,
        reason: "missing tdai-visualizer service for readonly safety checks",
      });
      continue;
    }

    const memoryMount = "tdai_memory_data:/data/memory-tdai:ro";
    if (!visualizerBlock.includes(memoryMount)) {
      violations.push({
        filePath: composePath,
        line: 1,
        reason: `${displayPath} must keep visualizer memory mount read-only as ${memoryMount}`,
      });
    }

    const telemetryMount = "tdai_request_telemetry:/data/request-telemetry";
    if (!visualizerBlock.includes(telemetryMount)) {
      violations.push({
        filePath: composePath,
        line: 1,
        reason: `${displayPath} must mount writable telemetry volume as ${telemetryMount}`,
      });
    }

    if (/TDAI_(?:VIS_|GATEWAY_)?TELEMETRY_DIR:\s*\/data\/memory-tdai(?:\/|\b)/.test(visualizerBlock)) {
      violations.push({
        filePath: composePath,
        line: 1,
        reason: `${displayPath} must not place telemetry under /data/memory-tdai`,
      });
    }
  }

  return violations;
}

function readServiceBlock(composeText, serviceName) {
  const lines = composeText.split(/\r?\n/);
  const start = lines.findIndex((line) => line === `  ${serviceName}:`);
  if (start === -1) return null;
  const block = [];

  for (const line of lines.slice(start + 1)) {
    if (/^  [A-Za-z0-9_-]+:\s*$/.test(line) || /^volumes:\s*$/.test(line)) break;
    block.push(line);
  }

  return block.join("\n");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
