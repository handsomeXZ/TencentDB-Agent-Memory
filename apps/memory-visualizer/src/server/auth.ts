import { createHash, timingSafeEqual } from "node:crypto";
import { type IncomingMessage, type ServerResponse } from "node:http";

interface JsonErrorBody {
  readonly error: string;
  readonly code: string;
}

export interface VisualizerAuthConfig {
  readonly apiKey: string | undefined;
  readonly required: boolean;
}

export function readVisualizerAuthConfig(env: NodeJS.ProcessEnv): VisualizerAuthConfig {
  const apiKey = env.TDAI_VIS_API_KEY?.trim();
  const configuredApiKey = apiKey && apiKey.length > 0 ? apiKey : undefined;
  return {
    apiKey: configuredApiKey,
    required: configuredApiKey !== undefined || env.NODE_ENV === "production",
  };
}

export function checkVisualizerAuth(request: IncomingMessage, response: ServerResponse, config: VisualizerAuthConfig): boolean {
  if (!config.required) return true;

  if (!config.apiKey) {
    sendAuthNotConfigured(response);
    return false;
  }

  const token = readBearerToken(request.headers.authorization);
  if (!token || !safeEqual(token, config.apiKey)) {
    sendUnauthorized(response);
    return false;
  }

  return true;
}

function readBearerToken(header: string | readonly string[] | undefined): string | undefined {
  if (typeof header !== "string" || !header.startsWith("Bearer ")) return undefined;
  const token = header.slice("Bearer ".length).trim();
  return token.length > 0 ? token : undefined;
}

function safeEqual(a: string, b: string): boolean {
  const ah = createHash("sha256").update(a, "utf8").digest();
  const bh = createHash("sha256").update(b, "utf8").digest();
  return timingSafeEqual(ah, bh);
}

function sendUnauthorized(response: ServerResponse): void {
  const body = { error: "Unauthorized", code: "unauthorized" } satisfies JsonErrorBody;
  sendAuthError(response, 401, body);
}

function sendAuthNotConfigured(response: ServerResponse): void {
  const body = {
    error: "Memory Visualizer authentication is required but TDAI_VIS_API_KEY is not configured.",
    code: "auth-not-configured",
  } satisfies JsonErrorBody;
  sendAuthError(response, 503, body);
}

function sendAuthError(response: ServerResponse, status: number, body: JsonErrorBody): void {
  const json = JSON.stringify(body);
  response.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(json),
  });
  response.end(json);
}
