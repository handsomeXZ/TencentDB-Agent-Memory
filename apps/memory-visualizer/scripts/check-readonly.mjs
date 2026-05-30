#!/usr/bin/env node

import { readdir, readFile, stat } from "node:fs/promises";
import { extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = fileURLToPath(new URL("..", import.meta.url));
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

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
