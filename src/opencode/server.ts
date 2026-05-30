import { z } from "zod";

import type { HealthResponse } from "../gateway/types.js";
import { GatewayHttpClient } from "../gateway-client/client.js";
import type { GatewayHttpClientOptions } from "../gateway-client/client.js";
import { OpenCodeHostAdapter } from "../adapters/opencode/host-adapter.js";
import type { OpenCodePluginConfig, OpenCodePluginConfigInput } from "../adapters/opencode/config.js";
import { parseOpenCodePluginConfig } from "../adapters/opencode/config.js";
import { createOpenCodeLifecycleController } from "../adapters/opencode/lifecycle.js";
import type { OpenCodeFinalTurnEvent, OpenCodeSessionEndEvent } from "../adapters/opencode/lifecycle.js";
import { redactSensitiveText } from "../adapters/opencode/policy.js";
import {
  createOpenCodeTools,
  getOpenCodeV1ToolNames,
  type OpenCodeRecallArgs,
  type OpenCodeSearchArgs,
} from "../adapters/opencode/tools.js";

export interface OpenCodePluginInputLike {
  project?: {
    id?: string;
    name?: string;
    directory?: string;
    path?: string;
    root?: string;
    worktree?: string;
  };
  directory?: string;
  worktree?: string;
  serverUrl?: URL;
  [key: string]: unknown;
}

export interface OpenCodeToolContextLike {
  sessionID?: string;
  directory?: string;
  worktree?: string;
  abort?: AbortSignal;
  [key: string]: unknown;
}

export interface OpenCodeToolDefinitionLike {
  description: string;
  args: Record<string, unknown>;
  execute(args: Record<string, unknown>, context: OpenCodeToolContextLike): Promise<string>;
}

export interface OpenCodeServerHooksLike {
  dispose?: () => Promise<void>;
  event?: (input: { event: unknown }) => Promise<void>;
  config?: (input: unknown) => Promise<void>;
  tool?: Record<string, OpenCodeToolDefinitionLike>;
}

export interface OpenCodeServerPluginModule {
  server(
    input: OpenCodePluginInputLike,
    options?: OpenCodePluginConfigInput | Record<string, unknown>,
  ): Promise<OpenCodeServerHooksLike>;
}

export interface OpenCodeServerPluginDependencies {
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  fetch?: GatewayHttpClientOptions["fetch"];
  warn?: (message: string) => void;
}

const HEALTH_TIMEOUT_CAP_MS = 1_000;

const recallArgs = {
  query: z.string().describe("Memory recall query for the current OpenCode session."),
};

const searchArgs = {
  query: z.string().describe("Search query."),
  limit: z.number().optional().describe("Maximum number of results to return."),
};

export function createOpenCodeServerPlugin(
  dependencies: OpenCodeServerPluginDependencies = {},
): OpenCodeServerPluginModule {
  return {
    async server(input, options) {
      return initializeOpenCodeServer(input, options, dependencies);
    },
  };
}

async function initializeOpenCodeServer(
  input: OpenCodePluginInputLike,
  options: OpenCodePluginConfigInput | Record<string, unknown> | undefined,
  dependencies: OpenCodeServerPluginDependencies,
): Promise<OpenCodeServerHooksLike> {
  const config = parseOpenCodePluginConfig(options, dependencies.env);
  const client = new GatewayHttpClient({
    baseUrl: config.gatewayUrl,
    apiKey: config.apiKey,
    timeoutMs: config.timeoutMs,
    fetch: dependencies.fetch,
  });
  const hostAdapter = new OpenCodeHostAdapter({
    config: input,
    pluginOptions: options,
    parsedConfig: config,
    workspace: {
      directory: input.directory,
      root: input.worktree,
    },
    project: {
      ...(input.project ?? {}),
      directory: input.project?.directory ?? input.directory,
      worktree: input.project?.worktree ?? input.worktree,
    },
    workspaceDir: input.directory,
    projectDir: input.worktree ?? input.directory,
  });
  const lifecycle = createOpenCodeLifecycleController({
    client,
    logger: {
      warn: (message) => emitWarning(dependencies, config.apiKey, message),
    },
  });

  void checkGatewayHealth(config, dependencies);

  return {
    dispose: async () => {
      await lifecycle.handleSessionEnd(toSessionEndEvent(hostAdapter, hostAdapter.getRuntimeContext().sessionId));
      await hostAdapter.dispose();
    },
    event: async (input) => {
      const event = normalizeOpenCodeLifecycleEvent(input.event, hostAdapter);
      if (!event) {
        return;
      }

      if (event.kind === "assistantTurn") {
        if (config.capture.enabled) {
          await lifecycle.handleAssistantTurn(event.event);
        }
        return;
      }

      await lifecycle.handleSessionEnd(event.event);
    },
    config: async () => {},
    tool: config.tools.enabled ? createToolMap({ client, config, hostAdapter }) : undefined,
  };
}

type NormalizedOpenCodeLifecycleEvent =
  | { kind: "assistantTurn"; event: OpenCodeFinalTurnEvent }
  | { kind: "sessionEnd"; event: OpenCodeSessionEndEvent };

function normalizeOpenCodeLifecycleEvent(
  rawEvent: unknown,
  hostAdapter: OpenCodeHostAdapter,
): NormalizedOpenCodeLifecycleEvent | undefined {
  if (!isRecord(rawEvent)) {
    return undefined;
  }

  if (isSupportedSessionEndEvent(rawEvent)) {
    return {
      kind: "sessionEnd",
      event: toSessionEndEvent(hostAdapter, readSessionId(rawEvent)),
    };
  }

  if (!isSupportedAssistantTurnEvent(rawEvent)) {
    return undefined;
  }

  const turnIndex = readTurnIndex(rawEvent);
  const userText = readText(rawEvent, "userText") ?? readNestedText(rawEvent, "user", "text");
  const finalAssistantText = readText(rawEvent, "finalAssistantText") ?? readNestedText(rawEvent, "assistant", "finalText");
  const assistantText = readText(rawEvent, "assistantText") ?? readNestedText(rawEvent, "assistant", "text");
  if (turnIndex === undefined || !userText || (!assistantText && !finalAssistantText)) {
    return undefined;
  }

  const runtimeContext = hostAdapter.buildRuntimeContextForSession(readSessionId(rawEvent));
  return {
    kind: "assistantTurn",
    event: {
      sessionKey: runtimeContext.sessionKey,
      sessionId: runtimeContext.sessionId,
      userId: runtimeContext.userId,
      turnIndex,
      userText,
      assistantText,
      finalAssistantText,
      hostSummary: readText(rawEvent, "hostSummary"),
      oversizedMessages: readStringArray(rawEvent, "oversizedMessages"),
      final: readBoolean(rawEvent, "final") ?? false,
    },
  };
}

function toSessionEndEvent(hostAdapter: OpenCodeHostAdapter, sessionId: string | undefined): OpenCodeSessionEndEvent {
  const runtimeContext = hostAdapter.buildRuntimeContextForSession(sessionId ?? hostAdapter.getRuntimeContext().sessionId);
  return {
    sessionKey: runtimeContext.sessionKey,
    userId: runtimeContext.userId,
  };
}

function isSupportedAssistantTurnEvent(event: Record<string, unknown>): boolean {
  const type = readEventType(event);
  return (
    type === "assistant.final" ||
    type === "assistant.completed" ||
    type === "assistant.delta" ||
    type === "message.final" ||
    type === "turn.completed" ||
    readBoolean(event, "final") !== undefined
  );
}

function isSupportedSessionEndEvent(event: Record<string, unknown>): boolean {
  const type = readEventType(event);
  return type === "session.end" || type === "session.closed" || type === "session.close";
}

function readEventType(event: Record<string, unknown>): string | undefined {
  return readText(event, "type") ?? readText(event, "name") ?? readText(event, "event");
}

function readSessionId(event: Record<string, unknown>): string | undefined {
  return (
    readText(event, "sessionID") ??
    readText(event, "sessionId") ??
    readNestedText(event, "session", "id") ??
    readNestedText(event, "session", "sessionID") ??
    readNestedText(event, "session", "sessionId")
  );
}

function readTurnIndex(event: Record<string, unknown>): number | undefined {
  const value = event.turnIndex ?? (isRecord(event.turn) ? event.turn.index : undefined);
  return typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : undefined;
}

function readText(event: Record<string, unknown>, key: string): string | undefined {
  const value = event[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

function readNestedText(event: Record<string, unknown>, parentKey: string, childKey: string): string | undefined {
  const parent = event[parentKey];
  if (!isRecord(parent)) {
    return undefined;
  }
  return readText(parent, childKey);
}

function readBoolean(event: Record<string, unknown>, key: string): boolean | undefined {
  const value = event[key];
  return typeof value === "boolean" ? value : undefined;
}

function readStringArray(event: Record<string, unknown>, key: string): string[] | undefined {
  const value = event[key];
  if (!Array.isArray(value)) {
    return undefined;
  }
  const strings = value.filter((item): item is string => typeof item === "string");
  return strings.length ? strings : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

async function checkGatewayHealth(
  config: OpenCodePluginConfig,
  dependencies: OpenCodeServerPluginDependencies,
): Promise<void> {
  const healthClient = new GatewayHttpClient({
    baseUrl: config.gatewayUrl,
    apiKey: config.apiKey,
    timeoutMs: Math.max(1, Math.min(config.timeoutMs, HEALTH_TIMEOUT_CAP_MS)),
    fetch: dependencies.fetch,
  });

  try {
    const timeoutMs = Math.max(1, Math.min(config.timeoutMs, HEALTH_TIMEOUT_CAP_MS));
    const health = await withTimeout(healthClient.health(), timeoutMs);
    if (health.status !== "ok") {
      emitWarning(
        dependencies,
        config.apiKey,
        `OpenCode TencentDB memory Gateway health is ${formatHealthStatus(health)}`,
      );
    }
  } catch (error) {
    emitWarning(
      dependencies,
      config.apiKey,
      `OpenCode TencentDB memory Gateway health check skipped: ${errorMessage(error)}`,
    );
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      reject(new Error(`Gateway GET /health timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
  });
}

function createToolMap(input: {
  client: GatewayHttpClient;
  config: OpenCodePluginConfig;
  hostAdapter: OpenCodeHostAdapter;
}): Record<string, OpenCodeToolDefinitionLike> {
  const startupContext = input.hostAdapter.getRuntimeContext();
  const toolDefinitions = createOpenCodeTools({
    client: input.client,
    context: { sessionKey: startupContext.sessionKey },
    recallMaxTotalChars: input.config.recall.maxTotalChars,
  });
  const expectedNames = getOpenCodeV1ToolNames();
  const toolMap: Record<string, OpenCodeToolDefinitionLike> = {};

  for (const name of expectedNames) {
    const definition = toolDefinitions.find((tool) => tool.name === name);
    if (!definition) {
      throw new Error(`Missing OpenCode v1 tool definition: ${name}`);
    }

    toolMap[name] = {
      description: definition.description,
      args: getToolArgs(name),
      execute: async (args, context) => {
        const sessionID = context.sessionID?.trim() || startupContext.sessionId;
        const runtimeContext = input.hostAdapter.buildRuntimeContextForSession(sessionID);
        const scopedTool = createOpenCodeTools({
          client: input.client,
          context: { sessionKey: runtimeContext.sessionKey },
          recallMaxTotalChars: input.config.recall.maxTotalChars,
        }).find((tool) => tool.name === name);

        if (!scopedTool) {
          throw new Error(`Missing OpenCode v1 tool definition: ${name}`);
        }

        return scopedTool.execute(args as unknown as OpenCodeRecallArgs & OpenCodeSearchArgs);
      },
    };
  }

  return toolMap;
}

function getToolArgs(name: string): Record<string, unknown> {
  if (name === "tdai_memory_recall") {
    return recallArgs;
  }
  return searchArgs;
}

function formatHealthStatus(health: HealthResponse): string {
  return [
    `status=${health.status}`,
    `version=${health.version || "unknown"}`,
    `vectorStore=${Boolean(health.stores?.vectorStore)}`,
    `embeddingService=${Boolean(health.stores?.embeddingService)}`,
  ].join(", ");
}

function emitWarning(
  dependencies: OpenCodeServerPluginDependencies,
  apiKey: string,
  message: string,
): void {
  const sanitized = redactSensitiveText(message.split(apiKey).join("[redacted]"));
  const warn = dependencies.warn ?? console.warn;
  warn(`[memory-tencentdb/opencode] ${sanitized}`);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const openCodeServerPlugin = createOpenCodeServerPlugin();

export default openCodeServerPlugin;
