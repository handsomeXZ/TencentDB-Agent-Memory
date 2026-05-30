import { randomUUID } from "node:crypto";
import { GatewayHttpClient, GatewayHttpClientError } from "../src/gateway-client/client.js";

const DEFAULT_GATEWAY_URL = "http://127.0.0.1:8420";
const DEFAULT_TIMEOUT_MS = 10_000;
const FINAL_ACCEPTANCE_FLAG = "--final-acceptance";

type SmokeMode = "default" | "final-acceptance";

interface SmokeConfig {
  mode: SmokeMode;
  baseUrl: string;
  apiKey: string | undefined;
  timeoutMs: number;
}

function printHelp(): void {
  console.log(`OpenCode Gateway smoke test

Usage:
  npm run smoke:opencode-gateway
  npm run smoke:opencode-gateway -- --final-acceptance

Environment:
  TDAI_GATEWAY_API_KEY  Required for protected routes. Default mode skips when absent.
  TDAI_GATEWAY_URL      Optional Gateway URL override. Defaults to ${DEFAULT_GATEWAY_URL}.
  TDAI_GATEWAY_SMOKE_MODE  Optional. Set to final-acceptance for strict mode.

Modes:
  default              CI-safe: GET /health first, then skip with exit 0 when the API key or Gateway health is unavailable.
  final-acceptance     Strict: fail non-zero when the API key or Gateway health is unavailable, then run the real loop.

This command only calls an already deployed Gateway. It never starts, stops, configures, or supervises Docker or the Gateway.`);
}

function parseArgs(argv: string[], env: NodeJS.ProcessEnv = process.env): SmokeMode | "help" {
  if (argv.includes("--help") || argv.includes("-h")) return "help";
  const unknown = argv.filter((arg) => arg !== FINAL_ACCEPTANCE_FLAG && arg !== "--");
  if (unknown.length > 0) {
    throw new Error(`Unknown argument(s): ${unknown.join(", ")}`);
  }
  return argv.includes(FINAL_ACCEPTANCE_FLAG) || env.TDAI_GATEWAY_SMOKE_MODE === "final-acceptance" || isTruthyNpmConfig(env.npm_config_final_acceptance)
    ? "final-acceptance"
    : "default";
}

function isTruthyNpmConfig(value: string | undefined): boolean {
  if (!value) return false;
  return !["0", "false", "no", "off"].includes(value.toLowerCase());
}

function readConfig(mode: SmokeMode): SmokeConfig {
  return {
    mode,
    baseUrl: process.env.TDAI_GATEWAY_URL?.trim() || DEFAULT_GATEWAY_URL,
    apiKey: process.env.TDAI_GATEWAY_API_KEY?.trim() || undefined,
    timeoutMs: readTimeoutMs(),
  };
}

function readTimeoutMs(): number {
  const raw = process.env.TDAI_GATEWAY_SMOKE_TIMEOUT_MS?.trim();
  if (!raw) return DEFAULT_TIMEOUT_MS;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error("TDAI_GATEWAY_SMOKE_TIMEOUT_MS must be a positive integer");
  }
  return parsed;
}

function emit(message: string, apiKey: string | undefined): void {
  console.log(redact(message, apiKey));
}

function skip(message: string, config: SmokeConfig): void {
  emit(`[smoke] SKIP ${message}`, config.apiKey);
}

function fail(message: string, config: SmokeConfig): never {
  emit(`[smoke] FAIL ${message}`, config.apiKey);
  process.exitCode = 1;
  throw new SmokeExit();
}

function sanitizeBaseUrl(baseUrl: string): string {
  try {
    const url = new URL(baseUrl);
    if (url.username || url.password) {
      url.username = url.username ? "[redacted]" : "";
      url.password = url.password ? "[redacted]" : "";
    }
    return url.toString().replace(/\/+$/, "");
  } catch {
    return baseUrl.replace(/\/\/[^/@\s]+:[^/@\s]+@/g, "//[redacted]:[redacted]@");
  }
}

function formatError(error: unknown, apiKey: string | undefined): string {
  const message = error instanceof Error ? error.message : String(error);
  const status = error instanceof GatewayHttpClientError && error.status ? ` status=${error.status}` : "";
  const kind = error instanceof GatewayHttpClientError ? ` kind=${error.kind}` : "";
  return redact(`${message}${kind}${status}`, apiKey);
}

function redact(message: string, apiKey: string | undefined): string {
  let redacted = message.replace(/Bearer\s+[^\s,;)\]}]+/gi, "Bearer [redacted]");
  redacted = redacted.replace(/(TDAI_GATEWAY_API_KEY\s*=\s*)[^\s]+/gi, "$1[redacted]");
  if (apiKey) redacted = redacted.split(apiKey).join("[redacted]");
  return redacted;
}

function createSmokePayload(): {
  sessionKey: string;
  sessionId: string;
  query: string;
  userContent: string;
  assistantContent: string;
} {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const id = randomUUID();
  const marker = `opencode-smoke:${stamp}:${id}`;
  return {
    sessionKey: marker,
    sessionId: marker,
    query: `${marker} verify independent Gateway recall/search`,
    userContent: `${marker} user asks the smoke test to remember an independent Gateway fact.`,
    assistantContent: `${marker} assistant confirms the independent Gateway smoke path is isolated and authenticated.`,
  };
}

async function runProtectedLoop(config: SmokeConfig): Promise<void> {
  const client = new GatewayHttpClient({
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    timeoutMs: config.timeoutMs,
  });
  const payload = createSmokePayload();
  let loopError: unknown;

  emit(`[smoke] using unique session_key=${payload.sessionKey}`, config.apiKey);
  try {
    emit("[smoke] POST /capture with Bearer auth", config.apiKey);
    const capture = await client.capture({
      user_content: payload.userContent,
      assistant_content: payload.assistantContent,
      session_key: payload.sessionKey,
      session_id: payload.sessionId,
      messages: [
        { role: "user", content: payload.userContent },
        { role: "assistant", content: payload.assistantContent },
      ],
    });
    emit(
      `[smoke] capture ok l0_recorded=${capture.l0_recorded} scheduler_notified=${capture.scheduler_notified}`,
      config.apiKey,
    );

    let recallError: unknown;
    emit("[smoke] POST /recall with Bearer auth", config.apiKey);
    try {
      const recall = await client.recall({ query: payload.query, session_key: payload.sessionKey });
      emit(
        `[smoke] recall ok context_chars=${recall.context.length} memory_count=${recall.memory_count ?? "n/a"} strategy=${recall.strategy ?? "n/a"}`,
        config.apiKey,
      );
    } catch (error) {
      recallError = error;
      emit(
        `[smoke] recall failed; attempting /search/memories fallback: ${formatError(error, config.apiKey)}`,
        config.apiKey,
      );
    }

    if (recallError) {
      emit("[smoke] POST /search/memories with Bearer auth", config.apiKey);
      try {
        const search = await client.searchMemories({ query: payload.query, limit: 3 });
        emit(
          `[smoke] search ok total=${search.total} strategy=${search.strategy} results_chars=${search.results.length}`,
          config.apiKey,
        );
      } catch (searchError) {
        loopError = new Error(
          `both /recall and /search/memories failed; recall=${formatError(recallError, config.apiKey)}; search=${formatError(searchError, config.apiKey)}`,
        );
      }
    }
  } catch (error) {
    loopError = error;
    emit(`[smoke] protected loop error: ${formatError(error, config.apiKey)}`, config.apiKey);
  } finally {
    emit("[smoke] POST /session/end with Bearer auth", config.apiKey);
    try {
      const ended = await client.endSession({ session_key: payload.sessionKey });
      emit(`[smoke] session end ok flushed=${ended.flushed}`, config.apiKey);
    } catch (error) {
      emit(`[smoke] session end error: ${formatError(error, config.apiKey)}`, config.apiKey);
      loopError ??= error;
    }
  }

  if (loopError) {
    fail(`real Gateway loop failed: ${formatError(loopError, config.apiKey)}`, config);
  }
  emit("[smoke] PASS independent Gateway smoke loop completed", config.apiKey);
}

async function main(): Promise<void> {
  const modeOrHelp = parseArgs(process.argv.slice(2));
  if (modeOrHelp === "help") {
    printHelp();
    return;
  }

  const config = readConfig(modeOrHelp);
  emit(
    `[smoke] mode=${config.mode} baseUrl=${sanitizeBaseUrl(config.baseUrl)} timeoutMs=${config.timeoutMs}`,
    config.apiKey,
  );

  const healthClient = new GatewayHttpClient({ baseUrl: config.baseUrl, timeoutMs: config.timeoutMs });
  emit("[smoke] GET /health unauthenticated", config.apiKey);
  try {
    const health = await healthClient.health();
    emit(
      `[smoke] health status=${health.status} version=${health.version} vectorStore=${health.stores.vectorStore} embeddingService=${health.stores.embeddingService}`,
      config.apiKey,
    );
    if (health.status !== "ok") {
      const message = `Gateway health is ${health.status}; protected smoke loop needs healthy Gateway`;
      if (config.mode === "final-acceptance") fail(message, config);
      skip(message, config);
      return;
    }
  } catch (error) {
    const message = `Gateway health unavailable: ${formatError(error, config.apiKey)}`;
    if (config.mode === "final-acceptance") fail(message, config);
    skip(message, config);
    return;
  }

  if (!config.apiKey) {
    const message = "TDAI_GATEWAY_API_KEY is required for protected /capture, /recall, /search/memories, and /session/end routes";
    if (config.mode === "final-acceptance") fail(message, config);
    skip(message, config);
    return;
  }

  await runProtectedLoop(config);
}

class SmokeExit extends Error {}

main().catch((error) => {
  if (error instanceof SmokeExit) return;
  const apiKey = process.env.TDAI_GATEWAY_API_KEY?.trim() || undefined;
  console.error(redact(`[smoke] FAIL ${error instanceof Error ? error.message : String(error)}`, apiKey));
  process.exitCode = 1;
});
