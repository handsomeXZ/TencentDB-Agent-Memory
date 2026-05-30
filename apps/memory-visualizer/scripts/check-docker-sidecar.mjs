#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = fileURLToPath(new URL("..", import.meta.url));
const repoRoot = path.resolve(appRoot, "..", "..");
const composePath = path.join(repoRoot, "docker", "standalone", "docker-compose.yml");
const dockerfilePath = path.join(appRoot, "Dockerfile");

const requiredComposeSnippets = [
  "tdai-visualizer:",
  "context: ../../apps/memory-visualizer",
  "dockerfile: Dockerfile",
  "image: tdai-memory-visualizer:1.0.0-beta.1",
  "TDAI_VIS_DATA_DIR: /data/memory-tdai",
  "TDAI_VIS_OFFLOAD_ROOT: /data/memory-tdai/offload",
  "127.0.0.1:8421:8421",
  "127.0.0.1:8420:8420",
  "tdai_memory_data:/data/memory-tdai:ro",
  "condition: service_healthy",
];

const requiredDockerfileSnippets = [
  "FROM node:22.16-bookworm-slim AS builder",
  "RUN npm ci",
  "RUN npm run build",
  "FROM node:22.16-bookworm-slim AS runtime",
  "ENV TDAI_VIS_PORT=8421",
  "ENV TDAI_VIS_DATA_DIR=/data/memory-tdai",
  "ENV TDAI_VIS_OFFLOAD_ROOT=/data/memory-tdai/offload",
  "ENV TDAI_VIS_HOST=0.0.0.0",
  "COPY --from=builder /app/dist ./dist",
  "COPY --from=builder /app/dist-server ./dist-server",
  "EXPOSE 8421",
  "CMD [\"node\", \"dist-server/production.js\"]",
];

function requireSnippet(label, text, snippet, failures) {
  if (!text.includes(snippet)) failures.push(`${label} missing: ${snippet}`);
}

async function main() {
  const [composeText, dockerfileText] = await Promise.all([
    readFile(composePath, "utf8"),
    readFile(dockerfilePath, "utf8"),
  ]);

  const failures = [];
  for (const snippet of requiredComposeSnippets) requireSnippet("compose sidecar", composeText, snippet, failures);
  for (const snippet of requiredDockerfileSnippets) requireSnippet("visualizer Dockerfile", dockerfileText, snippet, failures);
  const gatewayBlock = readServiceBlock(composeText, "tdai-gateway");
  const visualizerBlock = readServiceBlock(composeText, "tdai-visualizer");

  if (gatewayBlock === null) {
    failures.push("compose missing tdai-gateway service");
  } else {
    const gatewayPorts = readPortMappings(gatewayBlock);
    if (!gatewayPorts.includes("127.0.0.1:8420:8420")) {
      failures.push("compose Gateway must publish exactly 127.0.0.1:8420:8420");
    }
    for (const port of gatewayPorts.filter(isGateway8420Mapping)) {
      if (port !== "127.0.0.1:8420:8420") {
        failures.push(`compose Gateway must not publish public or non-loopback 8420 binding: ${port}`);
      }
    }
  }

  if (visualizerBlock?.includes("TDAI_VIS_GATEWAY_URL") || visualizerBlock?.includes("TDAI_VIS_GATEWAY_API_KEY")) {
    failures.push("compose visualizer must not enable Gateway debug proxy by default; set TDAI_VIS_GATEWAY_URL explicitly when needed");
  }

  if (dockerfileText.includes("TDAI_VIS_GATEWAY_URL")) {
    failures.push("visualizer Dockerfile must not enable Gateway debug proxy by default");
  }

  if (/ports:\s*\n\s*-\s*"8421:8421"/m.test(composeText)) {
    failures.push("compose sidecar must keep visualizer port localhost-bound, not 0.0.0.0-bound");
  }
  if (/tdai_memory_data:\/data\/memory-tdai(?!:ro)/.test(composeText.split("tdai-visualizer:")[1] ?? "")) {
    failures.push("compose sidecar must mount tdai_memory_data read-only in tdai-visualizer");
  }
  if (/vite\s+(?:--host|dev)/i.test(dockerfileText)) {
    failures.push("visualizer Dockerfile must not run Vite dev server in production");
  }

  if (failures.length > 0) {
    console.error("Docker sidecar checks failed:");
    for (const failure of failures) console.error(`- ${failure}`);
    process.exitCode = 1;
    return;
  }

  console.log("Docker sidecar checks passed.");
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

function readPortMappings(serviceBlock) {
  const mappings = [];
  const lines = serviceBlock.split(/\r?\n/);
  let inPorts = false;

  for (const line of lines) {
    if (/^    ports:\s*$/.test(line)) {
      inPorts = true;
      continue;
    }
    if (inPorts && /^    [A-Za-z0-9_-]+:/.test(line)) break;
    if (!inPorts) continue;

    const match = /^      -\s*["']?([^"'#]+)["']?\s*(?:#.*)?$/.exec(line);
    if (match) mappings.push(match[1].trim());
  }

  return mappings;
}

function isGateway8420Mapping(mapping) {
  const normalized = mapping.replace(/\/tcp$/i, "");
  return normalized === "8420" || normalized.endsWith(":8420") || normalized.includes(":8420:");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
