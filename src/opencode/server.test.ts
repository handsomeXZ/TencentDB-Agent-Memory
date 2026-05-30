import { describe, expect, it, vi } from "vitest";

import openCodeServerPlugin, { createOpenCodeServerPlugin } from "./server.js";
import { getOpenCodeV1ToolNames } from "../adapters/opencode/tools.js";

const API_KEY = "sk-test-opencode-server-entry-123456";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function healthyGatewayResponse(): Response {
  return jsonResponse({
    status: "ok",
    version: "test",
    uptime: 1,
    stores: { vectorStore: true, embeddingService: true },
  });
}

describe("opencode server entry", () => {
  it("default exports a v1 server plugin object without import-time Gateway calls", () => {
    expect(openCodeServerPlugin).toEqual({ server: expect.any(Function) });
  });

  it("fails initialization on missing apiKey before any Gateway request", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const plugin = createOpenCodeServerPlugin({ fetch: fetchMock, env: {} });

    await expect(plugin.server({ directory: "D:/workspace", worktree: "D:/workspace" }, {})).rejects.toThrow(
      "apiKey is required",
    );

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("registers exactly the v1 tools when tools.enabled is true", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(healthyGatewayResponse());
    const plugin = createOpenCodeServerPlugin({ fetch: fetchMock, env: {} });

    const hooks = await plugin.server(
      { directory: "D:/workspace", worktree: "D:/workspace/project" },
      { apiKey: API_KEY, tools: { enabled: true } },
    );

    expect(hooks.dispose).toEqual(expect.any(Function));
    expect(hooks.event).toEqual(expect.any(Function));
    expect(hooks.config).toEqual(expect.any(Function));
    expect(Object.keys(hooks.tool ?? {})).toEqual(getOpenCodeV1ToolNames());
    expect(Object.keys(hooks.tool ?? {})).not.toContain("tdai_memory_seed");
    expect(Object.keys(hooks.tool ?? {})).not.toContain("tdai_memory_delete");
    expect(Object.keys(hooks.tool ?? {})).not.toContain("tdai_memory_update");
    expect(Object.keys(hooks.tool ?? {})).not.toContain("tdai_memory_stats");
    expect(Object.keys(hooks.tool ?? {})).not.toContain("tdai_memory_debug");
    expect(Object.keys(hooks.tool ?? {})).not.toContain("tdai_memory_admin");
  });

  it("registers no tools when tools.enabled is false", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(healthyGatewayResponse());
    const plugin = createOpenCodeServerPlugin({ fetch: fetchMock, env: {} });

    const hooks = await plugin.server(
      { directory: "D:/workspace", worktree: "D:/workspace/project" },
      { apiKey: API_KEY, tools: { enabled: false } },
    );

    expect(hooks.tool).toBeUndefined();
  });

  it("uses explicit plugin config before env fallback and sends protected tool calls with auth", async () => {
    const requests: Array<{ url: string; headers: Headers; body?: string }> = [];
    const fetchMock = vi.fn<typeof fetch>(async (url, init) => {
      requests.push({
        url: String(url),
        headers: new Headers(init?.headers),
        body: typeof init?.body === "string" ? init.body : undefined,
      });
      if (String(url).endsWith("/health")) {
        return healthyGatewayResponse();
      }
      return jsonResponse({ context: "Use the checked config token.", strategy: "hybrid", memory_count: 1 });
    });
    const plugin = createOpenCodeServerPlugin({
      fetch: fetchMock,
      env: { TDAI_GATEWAY_API_KEY: "env-token-must-not-win" },
    });

    const hooks = await plugin.server(
      { directory: "D:/workspace", worktree: "D:/workspace/project" },
      { apiKey: API_KEY, gatewayUrl: "http://gateway.test:8420/", tools: { enabled: true } },
    );
    const output = await hooks.tool!.tdai_memory_recall.execute(
      { query: "deployment" },
      { sessionID: "session-99" },
    );

    const recallRequest = requests.find((request) => request.url.endsWith("/recall"));
    expect(output).toContain("Use the checked config token.");
    expect(recallRequest?.url).toBe("http://gateway.test:8420/recall");
    expect(recallRequest?.headers.get("authorization")).toBe(`Bearer ${API_KEY}`);
    expect(recallRequest?.headers.get("authorization")).not.toContain("env-token-must-not-win");
    expect(JSON.parse(recallRequest!.body!)).toMatchObject({
      query: "deployment",
      session_key: expect.stringContaining("session-99"),
    });
  });

  it("warns with sanitized degraded health details without blocking initialization", async () => {
    const warn = vi.fn();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        status: "degraded",
        version: API_KEY,
        uptime: 1,
        stores: { vectorStore: false, embeddingService: true },
      }),
    );
    const plugin = createOpenCodeServerPlugin({ fetch: fetchMock, warn, env: {} });

    const hooks = await plugin.server({ directory: "D:/workspace" }, { apiKey: API_KEY });

    expect(hooks.tool).toBeDefined();
    await vi.waitFor(() => expect(warn).toHaveBeenCalled());
    expect(warn.mock.calls[0][0]).toContain("status=degraded");
    expect(warn.mock.calls[0][0]).toContain("[redacted]");
    expect(warn.mock.calls[0][0]).not.toContain(API_KEY);
  });

  it("bounds health timeout and emits sanitized timeout warnings", async () => {
    const warn = vi.fn();
    const fetchMock = vi.fn<typeof fetch>((_url, init) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      });
    });
    const plugin = createOpenCodeServerPlugin({ fetch: fetchMock, warn, env: {} });

    await plugin.server({ directory: "D:/workspace" }, { apiKey: API_KEY, timeoutMs: 1 });

    await vi.waitFor(() => expect(warn).toHaveBeenCalled(), { timeout: 1_000 });
    expect(warn.mock.calls[0][0]).toContain("timed out after 1ms");
    expect(warn.mock.calls[0][0]).not.toContain(API_KEY);
  });

  it("bounds health even when fetch ignores abort", async () => {
    const warn = vi.fn();
    const fetchMock = vi.fn<typeof fetch>(() => new Promise<Response>(() => {}));
    const plugin = createOpenCodeServerPlugin({ fetch: fetchMock, warn, env: {} });

    await plugin.server({ directory: "D:/workspace" }, { apiKey: API_KEY, timeoutMs: 1 });

    await vi.waitFor(() => expect(warn).toHaveBeenCalled(), { timeout: 1_000 });
    expect(warn.mock.calls[0][0]).toContain("timed out after 1ms");
    expect(warn.mock.calls[0][0]).not.toContain(API_KEY);
  });

  it("warns with sanitized non-JSON health failures without blocking initialization", async () => {
    const warn = vi.fn();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response("not json", { status: 500, headers: { "content-type": "text/plain" } }),
    );
    const plugin = createOpenCodeServerPlugin({ fetch: fetchMock, warn, env: {} });

    const hooks = await plugin.server({ directory: "D:/workspace" }, { apiKey: API_KEY });

    expect(hooks.tool).toBeDefined();
    await vi.waitFor(() => expect(warn).toHaveBeenCalled());
    expect(warn.mock.calls[0][0]).toContain("non-JSON");
    expect(warn.mock.calls[0][0]).not.toContain(API_KEY);
  });

  it("degrades protected tool 401 responses without throwing or leaking the configured token", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (url) => {
      if (String(url).endsWith("/health")) {
        return healthyGatewayResponse();
      }
      return jsonResponse({ error: `Unauthorized Bearer ${API_KEY}` }, 401);
    });
    const plugin = createOpenCodeServerPlugin({ fetch: fetchMock, env: {} });

    const hooks = await plugin.server(
      { directory: "D:/workspace", worktree: "D:/workspace/project" },
      { apiKey: API_KEY, gatewayUrl: "http://gateway.test:8420/" },
    );
    const output = await hooks.tool!.tdai_memory_recall.execute({ query: "auth" }, { sessionID: "session-auth" });

    expect(output).toContain("Memory recall is temporarily unavailable.");
    expect(output).toContain("HTTP 401");
    expect(output).toContain("Bearer [redacted]");
    expect(output).not.toContain(API_KEY);
  });

  it("captures a final turn and explicit recall with the same scoped session key", async () => {
    const requests: Array<{ url: string; headers: Headers; body?: string }> = [];
    const fetchMock = vi.fn<typeof fetch>(async (url, init) => {
      requests.push({
        url: String(url),
        headers: new Headers(init?.headers),
        body: typeof init?.body === "string" ? init.body : undefined,
      });
      if (String(url).endsWith("/health")) {
        return healthyGatewayResponse();
      }
      if (String(url).endsWith("/capture")) {
        return jsonResponse({ l0_recorded: 1, scheduler_notified: true });
      }
      if (String(url).endsWith("/recall")) {
        return jsonResponse({ context: "Recall shares session scope.", strategy: "hybrid", memory_count: 1 });
      }
      return jsonResponse({ flushed: true });
    });
    const plugin = createOpenCodeServerPlugin({ fetch: fetchMock, env: {} });

    const hooks = await plugin.server(
      { directory: "D:/workspace", worktree: "D:/workspace/project" },
      { apiKey: API_KEY, gatewayUrl: "http://gateway.test:8420/", tools: { enabled: true } },
    );
    await hooks.event!({
      event: {
        type: "assistant.final",
        sessionID: "session-shared",
        turnIndex: 1,
        userText: "Remember this deployment preference.",
        finalAssistantText: "Preference captured.",
        final: true,
      },
    });
    const output = await hooks.tool!.tdai_memory_recall.execute(
      { query: "deployment preference" },
      { sessionID: "session-shared" },
    );

    const captureRequest = requests.find((request) => request.url.endsWith("/capture"));
    const recallRequest = requests.find((request) => request.url.endsWith("/recall"));
    expect(output).toContain("Recall shares session scope.");
    expect(JSON.parse(captureRequest!.body!)).toMatchObject({
      user_content: "Remember this deployment preference.",
      assistant_content: "Preference captured.",
      session_id: "session-shared",
    });
    expect(JSON.parse(captureRequest!.body!).session_key).toBe(JSON.parse(recallRequest!.body!).session_key);
    expect(JSON.parse(captureRequest!.body!).session_key).toMatch(
      /^opencode:[a-f0-9]{16}:[a-f0-9]{16}:session-shared:local$/,
    );
  });

  it("deduplicates streaming chunks and duplicate final events at the server event hook", async () => {
    const requests: Array<{ url: string; body?: string }> = [];
    const fetchMock = vi.fn<typeof fetch>(async (url, init) => {
      requests.push({ url: String(url), body: typeof init?.body === "string" ? init.body : undefined });
      if (String(url).endsWith("/health")) {
        return healthyGatewayResponse();
      }
      return jsonResponse({ l0_recorded: 1, scheduler_notified: true });
    });
    const plugin = createOpenCodeServerPlugin({ fetch: fetchMock, env: {} });
    const hooks = await plugin.server(
      { directory: "D:/workspace", worktree: "D:/workspace/project" },
      { apiKey: API_KEY, gatewayUrl: "http://gateway.test:8420/" },
    );
    const finalEvent = {
      type: "assistant.final",
      sessionID: "session-stream",
      turnIndex: 2,
      userText: "Stream once.",
      assistantText: "partial chunk",
      finalAssistantText: "Final answer only.",
      final: true,
    };

    await hooks.event!({
      event: {
        type: "assistant.delta",
        sessionID: "session-stream",
        turnIndex: 2,
        userText: "Stream once.",
        assistantText: "partial chunk",
        final: false,
      },
    });
    await hooks.event!({ event: finalEvent });
    await hooks.event!({ event: { ...finalEvent } });

    const captureRequests = requests.filter((request) => request.url.endsWith("/capture"));
    expect(captureRequests).toHaveLength(1);
    expect(JSON.parse(captureRequests[0].body!)).toMatchObject({
      user_content: "Stream once.",
      assistant_content: "Final answer only.",
    });
    expect(captureRequests[0].body).not.toContain("partial chunk");
  });

  it("sends session end once for session-close events and dispose", async () => {
    const requests: Array<{ url: string; body?: string }> = [];
    const fetchMock = vi.fn<typeof fetch>(async (url, init) => {
      requests.push({ url: String(url), body: typeof init?.body === "string" ? init.body : undefined });
      if (String(url).endsWith("/health")) {
        return healthyGatewayResponse();
      }
      return jsonResponse({ flushed: true });
    });
    const plugin = createOpenCodeServerPlugin({ fetch: fetchMock, env: {} });
    const hooks = await plugin.server(
      { directory: "D:/workspace", worktree: "D:/workspace/project" },
      { apiKey: API_KEY, gatewayUrl: "http://gateway.test:8420/" },
    );

    await hooks.event!({ event: { type: "session.closed", sessionID: "session-close" } });
    await hooks.event!({ event: { type: "session.closed", sessionID: "session-close" } });
    await hooks.dispose!();
    await hooks.dispose!();

    const sessionEndRequests = requests.filter((request) => request.url.endsWith("/session/end"));
    expect(sessionEndRequests).toHaveLength(2);
    expect(JSON.parse(sessionEndRequests[0].body!).session_key).toMatch(
      /^opencode:[a-f0-9]{16}:[a-f0-9]{16}:session-close:local$/,
    );
    expect(JSON.parse(sessionEndRequests[1].body!).session_key).toMatch(
      /^opencode:[a-f0-9]{16}:[a-f0-9]{16}:local-session:local$/,
    );
  });

  it("ignores unsupported event shapes instead of guessing", async () => {
    const requests: Array<{ url: string; body?: string }> = [];
    const fetchMock = vi.fn<typeof fetch>(async (url, init) => {
      requests.push({ url: String(url), body: typeof init?.body === "string" ? init.body : undefined });
      return String(url).endsWith("/health") ? healthyGatewayResponse() : jsonResponse({ l0_recorded: 1, scheduler_notified: true });
    });
    const plugin = createOpenCodeServerPlugin({ fetch: fetchMock, env: {} });
    const hooks = await plugin.server(
      { directory: "D:/workspace", worktree: "D:/workspace/project" },
      { apiKey: API_KEY, gatewayUrl: "http://gateway.test:8420/" },
    );

    await hooks.event!({ event: { type: "assistant.final", sessionID: "session-ignored", final: true } });
    await hooks.event!({ event: { type: "unknown.event", sessionID: "session-ignored" } });

    expect(requests.some((request) => request.url.endsWith("/capture"))).toBe(false);
    expect(requests.some((request) => request.url.endsWith("/session/end"))).toBe(false);
  });
});
