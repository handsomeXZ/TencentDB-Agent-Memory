import { describe, expect, it, vi } from "vitest";

import { GatewayHttpClientError } from "../../gateway-client/client.js";
import { OPEN_CODE_PLUGIN_DEFAULTS } from "./config.js";
import { OpenCodeHostAdapter } from "./host-adapter.js";
import { createOpenCodeTools, type OpenCodeToolsClient } from "./tools.js";

function createFakeGateway(): OpenCodeToolsClient {
  return {
    recall: vi.fn(),
    searchMemories: vi.fn(),
    searchConversations: vi.fn(),
  };
}

function createAdapter(sessionId = "session-current") {
  return new OpenCodeHostAdapter({
    workspaceDir: "D:/workspaces/acme",
    projectDir: "D:/workspaces/acme/service-api",
    sessionId,
    userId: "user-7",
  });
}

function createRecallTool(input: {
  client: OpenCodeToolsClient;
  sessionKey: string;
  recallMaxTotalChars?: number;
}) {
  const tools = createOpenCodeTools({
    client: input.client,
    context: { sessionKey: input.sessionKey },
    recallMaxTotalChars: input.recallMaxTotalChars,
  });
  const recallTool = tools.find((tool) => tool.name === "tdai_memory_recall");

  expect(recallTool).toBeDefined();
  return recallTool!;
}

describe("OpenCode recall lifecycle contract", () => {
  it("keeps automatic pre-model recall injection disabled and preserves explicit tool fallback", async () => {
    const injectedContexts: unknown[] = [];
    const adapter = new OpenCodeHostAdapter({
      workspaceDir: "D:/workspaces/acme",
      projectDir: "D:/workspaces/acme/service-api",
      sessionId: "session-current",
      userId: "user-7",
      injectContext: (request) => {
        injectedContexts.push(request);
      },
    });
    const client = createFakeGateway();
    vi.mocked(client.recall).mockResolvedValue({
      context: "[memory:deploy-checklist] Run migrations before deploy.",
      strategy: "hybrid",
      memory_count: 1,
    });

    const recallTool = createRecallTool({
      client,
      sessionKey: adapter.getRuntimeContext().sessionKey,
    });

    expect(adapter.supportsPreModelRecallInjection).toBe(false);
    expect(adapter.getCapabilities()).toMatchObject({
      supportsContextInjection: true,
      supportsPreModelRecallInjection: false,
    });
    expect(client.recall).not.toHaveBeenCalled();
    expect(injectedContexts).toEqual([]);

    const output = await recallTool.execute({ query: "deployment" });

    expect(output).toContain("Memory recall (hybrid)");
    expect(output).toContain("[memory:deploy-checklist] Run migrations before deploy.");
    expect(injectedContexts).toEqual([]);
  });

  it("uses the current scoped session_key and trims or validates user query input", async () => {
    const adapter = createAdapter("session-initial");
    const currentContext = adapter.buildRuntimeContextForSession({ id: "session-current" });
    const client = createFakeGateway();
    vi.mocked(client.recall).mockResolvedValue({
      context: "[memory:scope] Current session only.",
      strategy: "hybrid",
      memory_count: 1,
    });
    const recallTool = createRecallTool({ client, sessionKey: currentContext.sessionKey });

    const output = await recallTool.execute({ query: "  retry deploy command  " });
    const emptyOutput = await recallTool.execute({ query: "   " });

    expect(client.recall).toHaveBeenCalledTimes(1);
    expect(client.recall).toHaveBeenCalledWith({
      query: "retry deploy command",
      session_key: currentContext.sessionKey,
    });
    expect(currentContext.sessionKey).toMatch(/^opencode:[a-f0-9]{16}:[a-f0-9]{16}:session-current:[a-f0-9]{16}$/);
    expect(currentContext.sessionKey).not.toContain("D:/workspaces/acme");
    expect(output).toContain("[memory:scope] Current session only.");
    expect(emptyOutput).toBe("Please provide a non-empty memory recall query.");
  });

  it("returns source-marked bounded recall context for two memories", async () => {
    const adapter = createAdapter();
    const client = createFakeGateway();
    vi.mocked(client.recall).mockResolvedValue({
      context: [
        "[memory:deploy-checklist] Source: L1 memory. Run migrations before deploy.",
        "[memory:rollback-plan] Source: L1 memory. Keep rollback command ready.",
        "extra-tail-that-should-be-truncated",
      ].join("\n"),
      strategy: "hybrid",
      memory_count: 2,
    });
    const recallTool = createRecallTool({
      client,
      sessionKey: adapter.getRuntimeContext().sessionKey,
      recallMaxTotalChars: 140,
    });

    const output = await recallTool.execute({ query: "deploy safety" });

    expect(output).toContain("Memory recall (hybrid)");
    expect(output).toContain("Sources: 2");
    expect(output).toContain("[memory:deploy-checklist] Source: L1 memory.");
    expect(output).toContain("[memory:rollback-plan] Source: L1 memory.");
    expect(output).toContain("[truncated]");
    expect(output.length).toBeLessThanOrEqual(200);
  });

  it("adds no noisy recall context when the gateway returns an empty recall", async () => {
    const adapter = createAdapter();
    const client = createFakeGateway();
    vi.mocked(client.recall).mockResolvedValue({
      context: "   ",
      strategy: "hybrid",
      memory_count: 0,
    });
    const recallTool = createRecallTool({ client, sessionKey: adapter.getRuntimeContext().sessionKey });

    const output = await recallTool.execute({ query: "missing memory" });

    expect(output).toBe("No relevant memory recall found for this session.");
    expect(output).not.toContain("Memory recall (");
    expect(output).not.toContain("Sources:");
  });

  it.each([
    [
      "timeout",
      new GatewayHttpClientError("Gateway POST /recall timed out after 50ms", { kind: "timeout" }),
      "timed out",
    ],
    [
      "5xx",
      new GatewayHttpClientError("Gateway POST /recall failed with HTTP 502: upstream unavailable", {
        kind: "http",
        status: 502,
      }),
      "HTTP 502",
    ],
  ])("degrades without blocking host flow on %s recall failures", async (_name, error, expectedDetail) => {
    const adapter = createAdapter();
    const client = createFakeGateway();
    vi.mocked(client.recall).mockRejectedValue(error);
    const recallTool = createRecallTool({
      client,
      sessionKey: adapter.getRuntimeContext().sessionKey,
      recallMaxTotalChars: OPEN_CODE_PLUGIN_DEFAULTS.recallMaxTotalChars,
    });

    const output = await recallTool.execute({ query: "deploy history" });

    expect(output).toContain("Memory recall is temporarily unavailable.");
    expect(output).toContain(expectedDetail);
    expect(output.match(/Memory recall is temporarily unavailable\./g)).toHaveLength(1);
  });
});
