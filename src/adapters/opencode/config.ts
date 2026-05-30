export const OPEN_CODE_PLUGIN_DEFAULTS = {
  gatewayUrl: "http://127.0.0.1:8420",
  timeoutMs: 5000,
  captureEnabled: true,
  recallEnabled: true,
  recallMaxResults: 5,
  recallMaxTotalChars: 6000,
  toolsEnabled: true,
  redactionEnabled: true,
} as const;

export interface OpenCodePluginConfigInput {
  gatewayUrl?: unknown;
  apiKey?: unknown;
  timeoutMs?: unknown;
  capture?: {
    enabled?: unknown;
  };
  recall?: {
    enabled?: unknown;
    maxResults?: unknown;
    maxTotalChars?: unknown;
  };
  tools?: {
    enabled?: unknown;
  };
  redaction?: {
    enabled?: unknown;
  };
}

export interface OpenCodePluginConfig {
  gatewayUrl: string;
  apiKey: string;
  timeoutMs: number;
  capture: {
    enabled: boolean;
  };
  recall: {
    enabled: boolean;
    maxResults: number;
    maxTotalChars: number;
  };
  tools: {
    enabled: boolean;
  };
  redaction: {
    enabled: boolean;
  };
}

export interface OpenCodePluginLoggableConfig extends Omit<OpenCodePluginConfig, "apiKey"> {
  apiKey: string;
}

export class OpenCodePluginConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OpenCodePluginConfigError";
  }
}

type EnvLike = NodeJS.ProcessEnv | Record<string, string | undefined>;

const REDACTED_API_KEY = "[redacted]";

export function parseOpenCodePluginConfig(
  raw: OpenCodePluginConfigInput | Record<string, unknown> | undefined,
  env: EnvLike = process.env,
): OpenCodePluginConfig {
  const input = isRecord(raw) ? raw : {};
  const capture = getObject(input, "capture");
  const recall = getObject(input, "recall");
  const tools = getObject(input, "tools");
  const redaction = getObject(input, "redaction");

  const apiKeySource = Object.hasOwn(input, "apiKey")
    ? getString(input, "apiKey")
    : getEnvString(env, "TDAI_GATEWAY_API_KEY");
  const apiKey = requireApiKey(apiKeySource);

  return {
    gatewayUrl: normalizeGatewayUrl(getString(input, "gatewayUrl") ?? OPEN_CODE_PLUGIN_DEFAULTS.gatewayUrl),
    apiKey,
    timeoutMs: getNumber(input, "timeoutMs") ?? OPEN_CODE_PLUGIN_DEFAULTS.timeoutMs,
    capture: {
      enabled: getBoolean(capture, "enabled") ?? OPEN_CODE_PLUGIN_DEFAULTS.captureEnabled,
    },
    recall: {
      enabled: getBoolean(recall, "enabled") ?? OPEN_CODE_PLUGIN_DEFAULTS.recallEnabled,
      maxResults: getNumber(recall, "maxResults") ?? OPEN_CODE_PLUGIN_DEFAULTS.recallMaxResults,
      maxTotalChars: getNumber(recall, "maxTotalChars") ?? OPEN_CODE_PLUGIN_DEFAULTS.recallMaxTotalChars,
    },
    tools: {
      enabled: getBoolean(tools, "enabled") ?? OPEN_CODE_PLUGIN_DEFAULTS.toolsEnabled,
    },
    redaction: {
      enabled: getBoolean(redaction, "enabled") ?? OPEN_CODE_PLUGIN_DEFAULTS.redactionEnabled,
    },
  };
}

export function toLoggableOpenCodePluginConfig(config: OpenCodePluginConfig): OpenCodePluginLoggableConfig {
  return {
    gatewayUrl: config.gatewayUrl,
    apiKey: REDACTED_API_KEY,
    timeoutMs: config.timeoutMs,
    capture: { ...config.capture },
    recall: { ...config.recall },
    tools: { ...config.tools },
    redaction: { ...config.redaction },
  };
}

function normalizeGatewayUrl(value: string): string {
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    throw new OpenCodePluginConfigError(`Invalid OpenCode gatewayUrl: ${value}`);
  }

  const normalizedPath = url.pathname.replace(/\/+$/, "");
  url.pathname = normalizedPath || "/";
  return url.toString().replace(/\/+$/, "");
}

function requireApiKey(value: string | undefined): string {
  if (!value || !value.trim()) {
    throw new OpenCodePluginConfigError(
      "OpenCode plugin apiKey is required. Set config.apiKey or TDAI_GATEWAY_API_KEY.",
    );
  }

  return value.trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function getObject(source: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = source[key];
  return isRecord(value) ? value : {};
}

function getString(source: Record<string, unknown>, key: string): string | undefined {
  const value = source[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function getEnvString(env: EnvLike, key: string): string | undefined {
  const value = env[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function getNumber(source: Record<string, unknown>, key: string): number | undefined {
  const value = source[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function getBoolean(source: Record<string, unknown>, key: string): boolean | undefined {
  const value = source[key];
  return typeof value === "boolean" ? value : undefined;
}
