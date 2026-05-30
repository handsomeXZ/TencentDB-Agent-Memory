import { describe, expect, it, vi } from "vitest";

import type { CaptureRequest, SessionEndRequest } from "../../gateway/types.js";
import { createOpenCodeSessionKey, getOpenCodeCaptureCategories } from "./policy.js";
import { createOpenCodeLifecycleController, type OpenCodeLifecycleClient } from "./lifecycle.js";

const WORKSPACE_DIR = "D:/workspaces/acme";
const PROJECT_DIR = "D:/workspaces/acme/service-api";
const SESSION_ID = "session-final";
const USER_ID = "user-7";
const SESSION_KEY = createOpenCodeSessionKey({
  workspaceDir: WORKSPACE_DIR,
  projectDir: PROJECT_DIR,
  sessionId: SESSION_ID,
  userId: USER_ID,
});

function createFakeClient(): OpenCodeLifecycleClient {
  return {
    capture: vi.fn().mockResolvedValue({ l0_recorded: 1, scheduler_notified: true }),
    endSession: vi.fn().mockResolvedValue({ flushed: true }),
  };
}

function getCaptureRequest(client: OpenCodeLifecycleClient): CaptureRequest {
  const calls = vi.mocked(client.capture).mock.calls;
  expect(calls).toHaveLength(1);
  return calls[0][0];
}

function getSessionEndRequest(client: OpenCodeLifecycleClient): SessionEndRequest {
  const calls = vi.mocked(client.endSession).mock.calls;
  expect(calls).toHaveLength(1);
  return calls[0][0];
}

describe("OpenCode capture and session-end lifecycle contract", () => {
  it("sends one minimized and redacted /capture request for a final user and assistant turn", async () => {
    const client = createFakeClient();
    const lifecycle = createOpenCodeLifecycleController({ client });

    await lifecycle.handleAssistantTurn({
      sessionKey: SESSION_KEY,
      sessionId: SESSION_ID,
      userId: USER_ID,
      turnIndex: 4,
      userText: "Please summarize deployment notes. TDAI_GATEWAY_API_KEY=raw-gateway-token",
      finalAssistantText: "Deployment summary ready. Authorization: Bearer raw-bearer-token",
      hostSummary: "Host summary: oversized tool log showed migration success.",
      oversizedMessages: ["full tool output omitted"],
      final: true,
    });

    const request = getCaptureRequest(client);
    expect(request).toMatchObject({
      session_key: SESSION_KEY,
      session_id: SESSION_ID,
      user_id: USER_ID,
      user_content: "Please summarize deployment notes. TDAI_GATEWAY_API_KEY=[redacted]",
      assistant_content: "Deployment summary ready. Authorization: Bearer [redacted]",
      messages: [{ role: "host", content: "Host summary: oversized tool log showed migration success." }],
    });
    expect(request.session_key).toMatch(/^opencode:[a-f0-9]{16}:[a-f0-9]{16}:session-final:[a-f0-9]{16}$/);
    expect(request.session_key).not.toContain(WORKSPACE_DIR);
    expect(request.session_key).not.toContain(PROJECT_DIR);
    expect(JSON.stringify(request)).not.toContain("raw-gateway-token");
    expect(JSON.stringify(request)).not.toContain("raw-bearer-token");
  });

  it("captures only allowed default content categories and excludes unsafe event content", async () => {
    const client = createFakeClient();
    const lifecycle = createOpenCodeLifecycleController({ client });
    const unsafeEventFields = {
      systemPrompt: "SYSTEM PROMPT must never leave",
      permissionPrompt: "Allow shell command?",
      shellEnv: "OPENAI_API_KEY=raw-openai-token",
      toolOutput: "FULL TOOL OUTPUT " + "x".repeat(1_000),
      binaryContent: "data:image/png;base64,abcdef",
      oversizedUnsummarized: "oversized raw transcript " + "y".repeat(1_000),
    };

    await lifecycle.handleAssistantTurn({
      ...unsafeEventFields,
      sessionKey: SESSION_KEY,
      turnIndex: 5,
      userText: "User request stays.",
      finalAssistantText: "Final answer stays.",
      hostSummary: "Summarized oversized content stays.",
      oversizedMessages: [unsafeEventFields.oversizedUnsummarized],
      final: true,
    });

    const categories = getOpenCodeCaptureCategories();
    const requestText = JSON.stringify(getCaptureRequest(client));

    expect(categories.included).toEqual([
      "user text",
      "final assistant text",
      "host summary for oversized messages",
    ]);
    expect(categories.excluded).toEqual([
      "system prompts",
      "permission prompts",
      "shell env",
      "full tool output",
      "binary content",
      "oversized messages without host summary",
    ]);
    expect(requestText).toContain("User request stays.");
    expect(requestText).toContain("Final answer stays.");
    expect(requestText).toContain("Summarized oversized content stays.");
    expect(requestText).not.toContain(unsafeEventFields.systemPrompt);
    expect(requestText).not.toContain(unsafeEventFields.permissionPrompt);
    expect(requestText).not.toContain("raw-openai-token");
    expect(requestText).not.toContain("FULL TOOL OUTPUT");
    expect(requestText).not.toContain("data:image/png;base64");
    expect(requestText).not.toContain("oversized raw transcript");
  });

  it("deduplicates replayed final events using a deterministic final-turn idempotency key", async () => {
    const client = createFakeClient();
    const lifecycle = createOpenCodeLifecycleController({ client });
    const finalEvent = {
      sessionKey: SESSION_KEY,
      turnIndex: 6,
      userText: "Capture this turn once.",
      finalAssistantText: "Captured once.",
      final: true,
    };

    await lifecycle.handleAssistantTurn(finalEvent);
    await lifecycle.handleAssistantTurn({ ...finalEvent });

    expect(client.capture).toHaveBeenCalledTimes(1);
  });

  it("ignores streaming chunks and captures only final assistant content once", async () => {
    const client = createFakeClient();
    const lifecycle = createOpenCodeLifecycleController({ client });

    await lifecycle.handleAssistantTurn({
      sessionKey: SESSION_KEY,
      turnIndex: 7,
      userText: "Stream the answer.",
      assistantText: "partial chunk 1",
      final: false,
    });
    await lifecycle.handleAssistantTurn({
      sessionKey: SESSION_KEY,
      turnIndex: 7,
      userText: "Stream the answer.",
      assistantText: "partial chunk 2",
      final: false,
    });
    await lifecycle.handleAssistantTurn({
      sessionKey: SESSION_KEY,
      turnIndex: 7,
      userText: "Stream the answer.",
      assistantText: "partial chunk 2",
      finalAssistantText: "Final assistant answer only.",
      final: true,
    });

    const request = getCaptureRequest(client);
    expect(request.assistant_content).toBe("Final assistant answer only.");
    expect(JSON.stringify(request)).not.toContain("partial chunk");
  });

  it("sends exactly one /session/end request per session key", async () => {
    const client = createFakeClient();
    const lifecycle = createOpenCodeLifecycleController({ client });

    await lifecycle.handleSessionEnd({ sessionKey: SESSION_KEY, userId: USER_ID });
    await lifecycle.handleSessionEnd({ sessionKey: SESSION_KEY, userId: USER_ID });

    expect(getSessionEndRequest(client)).toEqual({ session_key: SESSION_KEY, user_id: USER_ID });
  });

  it("logs warning-only degraded session-end failures without failing process exit", async () => {
    const client = createFakeClient();
    const logger = { warn: vi.fn() };
    vi.mocked(client.endSession).mockRejectedValue(
      new Error("Gateway POST /session/end failed with HTTP 502: Authorization: Bearer raw-token"),
    );
    const lifecycle = createOpenCodeLifecycleController({ client, logger });

    await expect(lifecycle.handleSessionEnd({ sessionKey: SESSION_KEY, userId: USER_ID })).resolves.toBeUndefined();

    expect(client.endSession).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn.mock.calls[0][0]).toContain("degraded");
    expect(logger.warn.mock.calls[0][0]).toContain("HTTP 502");
    expect(logger.warn.mock.calls[0][0]).toContain("Authorization: Bearer [redacted]");
    expect(logger.warn.mock.calls[0][0]).not.toContain("raw-token");
  });

  it("logs warning-only degraded capture failures without blocking host flow", async () => {
    const client = createFakeClient();
    const logger = { warn: vi.fn() };
    vi.mocked(client.capture).mockRejectedValue(
      new Error("Gateway POST /capture failed with HTTP 401: Authorization: Bearer raw-token"),
    );
    const lifecycle = createOpenCodeLifecycleController({ client, logger });

    await expect(
      lifecycle.handleAssistantTurn({
        sessionKey: SESSION_KEY,
        turnIndex: 8,
        userText: "Capture even if gateway auth fails.",
        finalAssistantText: "Host flow continues.",
        final: true,
      }),
    ).resolves.toBeUndefined();

    expect(client.capture).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn.mock.calls[0][0]).toContain("degraded");
    expect(logger.warn.mock.calls[0][0]).toContain("HTTP 401");
    expect(logger.warn.mock.calls[0][0]).toContain("Authorization: Bearer [redacted]");
    expect(logger.warn.mock.calls[0][0]).not.toContain("raw-token");
  });

  it("logs sanitized warning-only degraded capture failures for raw Bearer auth text", async () => {
    const client = createFakeClient();
    const logger = { warn: vi.fn() };
    vi.mocked(client.capture).mockRejectedValue(
      new Error("Gateway POST /capture failed with HTTP 403: Bearer super-secret-token"),
    );
    const lifecycle = createOpenCodeLifecycleController({ client, logger });

    await expect(
      lifecycle.handleAssistantTurn({
        sessionKey: SESSION_KEY,
        turnIndex: 9,
        userText: "Capture should degrade on wrong token.",
        finalAssistantText: "Host flow continues.",
        final: true,
      }),
    ).resolves.toBeUndefined();

    expect(client.capture).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn.mock.calls[0][0]).toContain("HTTP 403");
    expect(logger.warn.mock.calls[0][0]).toContain("Bearer [redacted]");
    expect(logger.warn.mock.calls[0][0]).not.toContain("super-secret-token");
  });
});
