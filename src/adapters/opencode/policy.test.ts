import { describe, expect, it } from "vitest";

import {
  buildOpenCodeCapturePolicy,
  createFinalTurnIdempotencyKey,
  createOpenCodeSessionKey,
  getOpenCodeCaptureCategories,
  redactSensitiveText,
} from "./policy.js";

describe("opencode policy", () => {
  it("hashes workspace and project identifiers into session keys", () => {
    const first = createOpenCodeSessionKey({
      workspaceDir: "D:/workspaces/alpha",
      projectDir: "D:/workspaces/alpha/project-a",
      sessionId: "session-1",
      userId: "user-1",
    });
    const second = createOpenCodeSessionKey({
      workspaceDir: "D:/workspaces/beta",
      projectDir: "D:/workspaces/beta/project-a",
      sessionId: "session-1",
      userId: "user-1",
    });

    expect(first).toMatch(/^opencode:[a-f0-9]{16}:[a-f0-9]{16}:session-1:[a-f0-9]{16}$/);
    expect(second).toMatch(/^opencode:[a-f0-9]{16}:[a-f0-9]{16}:session-1:[a-f0-9]{16}$/);
    expect(first).not.toContain("D:/workspaces/alpha");
    expect(first).not.toContain("D:/workspaces/alpha/project-a");
    expect(second).not.toContain("D:/workspaces/beta");
    expect(first).not.toBe(second);
  });

  it("uses local when user id is absent", () => {
    const sessionKey = createOpenCodeSessionKey({
      workspaceDir: "D:/workspaces/alpha",
      projectDir: "D:/workspaces/alpha/project-a",
      sessionId: "session-1",
    });

    expect(sessionKey.endsWith(":local")).toBe(true);
  });

  it("describes included and excluded capture categories", () => {
    expect(getOpenCodeCaptureCategories()).toEqual({
      included: ["user text", "final assistant text", "host summary for oversized messages"],
      excluded: [
        "system prompts",
        "permission prompts",
        "shell env",
        "full tool output",
        "binary content",
        "oversized messages without host summary",
      ],
    });
  });

  it("captures only user and final assistant text, plus host summary when oversized messages exist", () => {
    const policy = buildOpenCodeCapturePolicy({
      userText: "Please review this.",
      assistantText: "Done.",
      hostSummary: "Host summarized oversized context.",
      oversizedMessages: ["tool output omitted"],
    });

    expect(policy).toEqual({
      includedCategories: ["user text", "final assistant text", "host summary for oversized messages"],
      excludedCategories: [
        "system prompts",
        "permission prompts",
        "shell env",
        "full tool output",
        "binary content",
        "oversized messages without host summary",
      ],
      capturedTexts: ["Please review this.", "Done.", "Host summarized oversized context."],
    });
  });

  it("redacts bearer tokens, api keys, tokens, and shell env assignments", () => {
    const redacted = redactSensitiveText(
      [
        "sk-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        "TDAI_GATEWAY_API_KEY=raw-gateway-token",
        "Authorization: Bearer raw-bearer-token",
        "Gateway failed with Bearer super-secret-token before header formatting",
        "OPENAI_API_KEY=raw-openai-token",
        "TOKEN=raw-token-value",
        "export PRIVATE_KEY=raw-private-key",
      ].join("\n"),
    );

    expect(redacted).not.toContain("sk-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    expect(redacted).not.toContain("raw-gateway-token");
    expect(redacted).not.toContain("raw-bearer-token");
    expect(redacted).not.toContain("super-secret-token");
    expect(redacted).not.toContain("raw-openai-token");
    expect(redacted).not.toContain("raw-token-value");
    expect(redacted).not.toContain("raw-private-key");
    expect(redacted).toContain("TDAI_GATEWAY_API_KEY=[redacted]");
    expect(redacted).toContain("[redacted-api-key]");
    expect(redacted).toContain("Authorization: Bearer [redacted]");
    expect(redacted).toContain("Gateway failed with Bearer [redacted] before header formatting");
    expect(redacted).toContain("OPENAI_API_KEY=[redacted]");
    expect(redacted).toContain("TOKEN=[redacted]");
    expect(redacted).toContain("export PRIVATE_KEY=[redacted]");
  });

  it("returns stable keys for repeated same final turn and distinct keys for different turns", () => {
    const base = {
      sessionKey: "opencode:aaaaaaaaaaaaaaaa:bbbbbbbbbbbbbbbb:session-1:local",
      turnIndex: 3,
      userText: "Summarize the notes",
      assistantText: "Summary complete.",
    };

    const first = createFinalTurnIdempotencyKey(base);
    const second = createFinalTurnIdempotencyKey({ ...base });
    const third = createFinalTurnIdempotencyKey({ ...base, turnIndex: 4 });

    expect(first).toBe(second);
    expect(first).toMatch(/^opencode-turn:[a-f0-9]{16}$/);
    expect(first).not.toBe(third);
  });
});
