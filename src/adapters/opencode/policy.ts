import crypto from "node:crypto";
import path from "node:path";

const HASH_LENGTH = 16;

const CAPTURE_INCLUDED_CATEGORIES = ["user text", "final assistant text", "host summary for oversized messages"] as const;
const CAPTURE_EXCLUDED_CATEGORIES = [
  "system prompts",
  "permission prompts",
  "shell env",
  "full tool output",
  "binary content",
  "oversized messages without host summary",
] as const;

const SENSITIVE_NAME_PATTERN = String.raw`(?:TDAI_GATEWAY_API_KEY|(?:[A-Z][A-Z0-9_]*_)?(?:API_KEY|TOKEN|SECRET|PASSWORD|PRIVATE_KEY|ACCESS_TOKEN|REFRESH_TOKEN))`;
const ASSIGNMENT_VALUE_PATTERN = String.raw`(?:"[^"]*"|'[^']*'|[^\s,;]+)`;

export interface OpenCodeSessionKeyInput {
  workspaceDir: string;
  projectDir: string;
  sessionId: string;
  userId?: string | null;
}

export interface OpenCodeCaptureInput {
  userText: string;
  assistantText: string;
  hostSummary?: string | null;
  oversizedMessages?: readonly string[];
}

export interface OpenCodeFinalTurnIdempotencyInput {
  sessionKey: string;
  turnIndex: number;
  userText: string;
  assistantText: string;
}

export interface OpenCodeCapturePolicy {
  includedCategories: readonly string[];
  excludedCategories: readonly string[];
  capturedTexts: string[];
}

export interface OpenCodeCaptureCategories {
  included: readonly string[];
  excluded: readonly string[];
}

export function getOpenCodeCaptureCategories(): OpenCodeCaptureCategories {
  return {
    included: CAPTURE_INCLUDED_CATEGORIES,
    excluded: CAPTURE_EXCLUDED_CATEGORIES,
  };
}

export function createOpenCodeSessionKey(input: OpenCodeSessionKeyInput): string {
  const workspaceHash = hashIdentifier(input.workspaceDir);
  const projectHash = hashIdentifier(input.projectDir);
  const userHashOrLocal = normalizeUserId(input.userId);

  return `opencode:${workspaceHash}:${projectHash}:${input.sessionId}:${userHashOrLocal}`;
}

export function buildOpenCodeCapturePolicy(input: OpenCodeCaptureInput): OpenCodeCapturePolicy {
  const capturedTexts = [
    redactSensitiveText(input.userText).trim(),
    redactSensitiveText(input.assistantText).trim(),
  ].filter((value) => value.length > 0);

  const hostSummary = input.hostSummary?.trim();
  if (hostSummary && input.oversizedMessages?.length) {
    capturedTexts.push(redactSensitiveText(hostSummary));
  }

  return {
    includedCategories: CAPTURE_INCLUDED_CATEGORIES,
    excludedCategories: CAPTURE_EXCLUDED_CATEGORIES,
    capturedTexts,
  };
}

export function redactSensitiveText(text: string): string {
  let redacted = text;

  redacted = redacted.replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, "[redacted-api-key]");

  redacted = redacted.replace(
    /\bBearer\s+[^\s"'`,)\]}]+/gi,
    "Bearer [redacted]",
  );

  redacted = redacted.replace(
    new RegExp(String.raw`(^|[\s{\[(,])((?:export\s+)?${SENSITIVE_NAME_PATTERN})\s*=\s*${ASSIGNMENT_VALUE_PATTERN}`, "gmi"),
    (_, prefix: string, name: string) => `${prefix}${name}=[redacted]`,
  );

  redacted = redacted.replace(
    new RegExp(String.raw`(["']?${SENSITIVE_NAME_PATTERN}["']?\s*[:=]\s*)${ASSIGNMENT_VALUE_PATTERN}`, "gmi"),
    (_match, prefix: string) => `${prefix}[redacted]`,
  );

  return redacted;
}

export function createFinalTurnIdempotencyKey(input: OpenCodeFinalTurnIdempotencyInput): string {
  const canonical = JSON.stringify({
    sessionKey: input.sessionKey,
    turnIndex: input.turnIndex,
    userText: normalizeTurnText(input.userText),
    assistantText: normalizeTurnText(input.assistantText),
  });

  return `opencode-turn:${hashCanonical(canonical)}`;
}

function normalizeUserId(userId: string | null | undefined): string {
  const trimmed = userId?.trim();
  return trimmed ? hashCanonical(trimmed) : "local";
}

function hashIdentifier(value: string): string {
  return crypto.createHash("sha256").update(path.resolve(value)).digest("hex").slice(0, HASH_LENGTH);
}

function hashCanonical(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex").slice(0, HASH_LENGTH);
}

function normalizeTurnText(value: string): string {
  return redactSensitiveText(value).replace(/\s+/g, " ").trim();
}
