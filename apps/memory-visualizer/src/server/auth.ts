import { createHash, timingSafeEqual } from "node:crypto";
import { type IncomingMessage, type ServerResponse } from "node:http";

interface JsonErrorBody {
  readonly error: string;
  readonly code: string;
}

export function readVisualizerApiKey(env: NodeJS.ProcessEnv): string | undefined {
  const apiKey = env.TDAI_VIS_API_KEY?.trim();
  return apiKey && apiKey.length > 0 ? apiKey : undefined;
}

export function checkVisualizerAuth(request: IncomingMessage, response: ServerResponse, apiKey: string | undefined): boolean {
  if (!apiKey) return true;

  const token = readBearerToken(request.headers.authorization);
  if (!token || !safeEqual(token, apiKey)) {
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
  const json = JSON.stringify(body);
  response.writeHead(401, {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(json),
  });
  response.end(json);
}
