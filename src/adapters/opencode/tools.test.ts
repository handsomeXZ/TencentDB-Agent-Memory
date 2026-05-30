import { describe, expect, it, vi } from "vitest";

import { GatewayHttpClientError } from "../../gateway-client/client.js";
import { OPEN_CODE_PLUGIN_DEFAULTS } from "./config.js";
import { createOpenCodeTools, getOpenCodeV1ToolNames, type OpenCodeToolsClient } from "./tools.js";

const SESSION_KEY = "opencode:aaaaaaaaaaaaaaaa:bbbbbbbbbbbbbbbb:session-42:local";
const RAW_TOKEN = "sk-sensitive-token-value-123456789012";
const RAW_BEARER_TOKEN = "super-secret-token";

function createClientMock(): OpenCodeToolsClient {
  return {
    recall: vi.fn(),
    searchMemories: vi.fn(),
    searchConversations: vi.fn(),
  };
}

function createSubject(client: OpenCodeToolsClient, overrides: { recallMaxTotalChars?: number } = {}) {
  return createOpenCodeTools({
    client,
    context: { sessionKey: SESSION_KEY },
    ...overrides,
  });
}

function getTool(client: OpenCodeToolsClient, name: string, overrides: { recallMaxTotalChars?: number } = {}) {
  const tool = createSubject(client, overrides).find((entry) => entry.name === name);
  expect(tool).toBeDefined();
  return tool!;
}

describe("opencode tools contract", () => {
  it("exports exactly the three v1 tool names and nothing else", () => {
    const client = createClientMock();
    const tools = createSubject(client);

    expect(getOpenCodeV1ToolNames()).toEqual([
      "tdai_memory_recall",
      "tdai_memory_search",
      "tdai_conversation_search",
    ]);
    expect(tools.map((tool) => tool.name)).toEqual([
      "tdai_memory_recall",
      "tdai_memory_search",
      "tdai_conversation_search",
    ]);
    expect(tools.map((tool) => tool.name)).not.toContain("tdai_memory_seed");
    expect(tools.map((tool) => tool.name)).not.toContain("tdai_memory_delete");
    expect(tools.map((tool) => tool.name)).not.toContain("tdai_memory_update");
    expect(tools.map((tool) => tool.name)).not.toContain("tdai_memory_debug");
    expect(tools.map((tool) => tool.name)).not.toContain("tdai_memory_admin");
  });

  it("tdai_memory_recall sends query and scoped session_key to /recall and formats source-marked output", async () => {
    const client = createClientMock();
    vi.mocked(client.recall).mockResolvedValue({
      context: "Remember to use migrations before deploying.",
      strategy: "hybrid",
      memory_count: 2,
    });

    const output = await getTool(client, "tdai_memory_recall").execute({
      query: "  deployment checklist  ",
    });

    expect(client.recall).toHaveBeenCalledWith({
      query: "deployment checklist",
      session_key: SESSION_KEY,
    });
    expect(output).toContain("Memory recall (hybrid)");
    expect(output).toContain("Sources: 2");
    expect(output).toContain("Remember to use migrations before deploying.");
  });

  it("tdai_memory_recall returns a no-result fallback when the gateway context is empty", async () => {
    const client = createClientMock();
    vi.mocked(client.recall).mockResolvedValue({
      context: "   ",
      strategy: "hybrid",
      memory_count: 0,
    });

    const output = await getTool(client, "tdai_memory_recall").execute({ query: "deploy" });

    expect(output).toBe("No relevant memory recall found for this session.");
  });

  it("tdai_memory_recall bounds long output and redacts tokens", async () => {
    const client = createClientMock();
    vi.mocked(client.recall).mockResolvedValue({
      context: `Prefix Authorization: Bearer hidden-token ${RAW_TOKEN} ${"A".repeat(80)}`,
      strategy: "keyword",
      memory_count: 1,
    });

    const output = await getTool(client, "tdai_memory_recall", { recallMaxTotalChars: 90 }).execute({
      query: "tokens",
    });

    expect(output).toContain("Memory recall (keyword)");
    expect(output).toContain("[truncated]");
    expect(output).toContain("Authorization: Bearer [redacted]");
    expect(output).toContain("[redacted-api-key]");
    expect(output).not.toContain("hidden-token");
    expect(output).not.toContain(RAW_TOKEN);
    expect(output.length).toBeLessThan(170);
  });

  it("tdai_memory_recall rejects empty queries without calling the gateway", async () => {
    const client = createClientMock();

    const output = await getTool(client, "tdai_memory_recall").execute({ query: "   " });

    expect(output).toBe("Please provide a non-empty memory recall query.");
    expect(client.recall).not.toHaveBeenCalled();
  });

  it("tdai_memory_recall degrades gracefully on gateway errors and redacts secrets", async () => {
    const client = createClientMock();
    vi.mocked(client.recall).mockRejectedValue(
      new GatewayHttpClientError(
        `Gateway POST /recall failed with HTTP 503: upstream Authorization: Bearer super-secret ${RAW_TOKEN}`,
        { kind: "http", status: 503 },
      ),
    );

    const output = await getTool(client, "tdai_memory_recall").execute({ query: "deploy" });

    expect(output).toContain("Memory recall is temporarily unavailable.");
    expect(output).toContain("HTTP 503");
    expect(output).toContain("Authorization: Bearer [redacted]");
    expect(output).toContain("[redacted-api-key]");
    expect(output).not.toContain("super-secret");
    expect(output).not.toContain(RAW_TOKEN);
  });

  it("tdai_memory_search sends query and explicit limit to /search/memories and formats readable results", async () => {
    const client = createClientMock();
    vi.mocked(client.searchMemories).mockResolvedValue({
      results: "Found 2 matching memories:\n\n- **[preference]** Use pnpm for workspace installs.\n\n- **[fact]** Project root is apps/api.",
      total: 2,
      strategy: "hybrid",
    });

    const output = await getTool(client, "tdai_memory_search").execute({ query: "workspace", limit: 7 });

    expect(client.searchMemories).toHaveBeenCalledWith({ query: "workspace", limit: 7 });
    expect(output).toContain("Memory search (hybrid)");
    expect(output).toContain("Use pnpm for workspace installs.");
    expect(output).toContain("Project root is apps/api.");
  });

  it("tdai_memory_search uses the default limit when limit is absent or invalid", async () => {
    const client = createClientMock();
    vi.mocked(client.searchMemories).mockResolvedValue({
      results: "Found 1 matching memories:\n\n- One result",
      total: 1,
      strategy: "fts",
    });

    await getTool(client, "tdai_memory_search").execute({ query: "history" });
    await getTool(client, "tdai_memory_search").execute({ query: "history", limit: 0 });

    expect(client.searchMemories).toHaveBeenNthCalledWith(1, {
      query: "history",
      limit: OPEN_CODE_PLUGIN_DEFAULTS.recallMaxResults,
    });
    expect(client.searchMemories).toHaveBeenNthCalledWith(2, {
      query: "history",
      limit: OPEN_CODE_PLUGIN_DEFAULTS.recallMaxResults,
    });
  });

  it("tdai_memory_search returns a clean no-error message when the gateway returns no results", async () => {
    const client = createClientMock();
    vi.mocked(client.searchMemories).mockResolvedValue({
      results: "   ",
      total: 0,
      strategy: "hybrid",
    });

    const output = await getTool(client, "tdai_memory_search").execute({ query: "absent" });

    expect(output).toBe("No matching memories found.");
  });

  it("tdai_memory_search degrades gracefully on gateway errors and redacts secrets", async () => {
    const client = createClientMock();
    vi.mocked(client.searchMemories).mockRejectedValue(
      new GatewayHttpClientError(
        `Gateway POST /search/memories failed with HTTP 504: upstream Authorization: Bearer super-secret ${RAW_TOKEN}`,
        { kind: "http", status: 504 },
      ),
    );

    const output = await getTool(client, "tdai_memory_search").execute({ query: "workspace" });

    expect(output).toContain("Memory search is temporarily unavailable.");
    expect(output).toContain("HTTP 504");
    expect(output).toContain("Authorization: Bearer [redacted]");
    expect(output).toContain("[redacted-api-key]");
    expect(output).not.toContain("super-secret");
    expect(output).not.toContain(RAW_TOKEN);
  });

  it("tdai_memory_search bounds long readable output", async () => {
    const client = createClientMock();
    vi.mocked(client.searchMemories).mockResolvedValue({
      results: `Found matches:\n\n- ${"A".repeat(120)}`,
      total: 1,
      strategy: "hybrid",
    });

    const output = await getTool(client, "tdai_memory_search", { recallMaxTotalChars: 70 }).execute({
      query: "long",
    });

    expect(output).toContain("Memory search (hybrid)");
    expect(output).toContain("[truncated]");
    expect(output.length).toBeLessThan(140);
  });

  it("tdai_memory_recall bounds large recalled context before returning tool output", async () => {
    const client = createClientMock();
    vi.mocked(client.recall).mockResolvedValue({
      context: `Large recall ${"memory ".repeat(200)}Bearer ${RAW_BEARER_TOKEN}`,
      strategy: "hybrid",
      memory_count: 20,
    });

    const output = await getTool(client, "tdai_memory_recall", { recallMaxTotalChars: 120 }).execute({
      query: "large recall",
    });

    expect(output).toContain("Memory recall (hybrid)");
    expect(output).toContain("[truncated]");
    expect(output).not.toContain(RAW_BEARER_TOKEN);
    expect(output.length).toBeLessThan(200);
  });

  it("tdai_memory_search degrades safely on 429 without retrying or leaking bearer tokens", async () => {
    const client = createClientMock();
    vi.mocked(client.searchMemories).mockRejectedValue(
      new GatewayHttpClientError(
        `Gateway POST /search/memories failed with HTTP 429: retry later Bearer ${RAW_BEARER_TOKEN}`,
        { kind: "http", status: 429 },
      ),
    );

    const output = await getTool(client, "tdai_memory_search").execute({ query: "rate limit" });

    expect(client.searchMemories).toHaveBeenCalledTimes(1);
    expect(output).toContain("Memory search is temporarily unavailable.");
    expect(output).toContain("HTTP 429");
    expect(output).toContain("Bearer [redacted]");
    expect(output).not.toContain(RAW_BEARER_TOKEN);
  });

  it("tdai_memory_search rejects empty queries without calling the gateway", async () => {
    const client = createClientMock();

    const output = await getTool(client, "tdai_memory_search").execute({ query: "" });

    expect(output).toBe("Please provide a non-empty memory search query.");
    expect(client.searchMemories).not.toHaveBeenCalled();
  });

  it("tdai_conversation_search sends query and scoped session_key to /search/conversations", async () => {
    const client = createClientMock();
    vi.mocked(client.searchConversations).mockResolvedValue({
      results: "Found 1 matching message(s):\n\n---\n**[user]** Session: scoped\n\nNeed the retry command.",
      total: 1,
    });

    const output = await getTool(client, "tdai_conversation_search").execute({
      query: "retry command",
      limit: 3,
    });

    expect(client.searchConversations).toHaveBeenCalledWith({
      query: "retry command",
      limit: 3,
      session_key: SESSION_KEY,
    });
    expect(output).toContain("Conversation search");
    expect(output).toContain("Need the retry command.");
  });

  it("tdai_conversation_search degrades gracefully on gateway errors and redacts secrets", async () => {
    const client = createClientMock();
    vi.mocked(client.searchConversations).mockRejectedValue(
      new GatewayHttpClientError(
        `Gateway POST /search/conversations failed with HTTP 502: upstream Authorization: Bearer super-secret ${RAW_TOKEN}`,
        { kind: "http", status: 502 },
      ),
    );

    const output = await getTool(client, "tdai_conversation_search").execute({ query: "planner" });

    expect(output).toContain("Conversation search is temporarily unavailable.");
    expect(output).toContain("HTTP 502");
    expect(output).toContain("Authorization: Bearer [redacted]");
    expect(output).toContain("[redacted-api-key]");
    expect(output).not.toContain("super-secret");
    expect(output).not.toContain(RAW_TOKEN);
  });

  it("tdai_conversation_search returns a clean no-error message when the gateway returns no results", async () => {
    const client = createClientMock();
    vi.mocked(client.searchConversations).mockResolvedValue({
      results: "",
      total: 0,
    });

    const output = await getTool(client, "tdai_conversation_search").execute({ query: "nothing" });

    expect(output).toBe("No matching conversation messages found.");
  });

  it("tdai_conversation_search rejects empty queries without calling the gateway", async () => {
    const client = createClientMock();

    const output = await getTool(client, "tdai_conversation_search").execute({ query: "   " });

    expect(output).toBe("Please provide a non-empty conversation search query.");
    expect(client.searchConversations).not.toHaveBeenCalled();
  });
});
