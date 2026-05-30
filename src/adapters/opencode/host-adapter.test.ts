import { describe, expect, it } from "vitest";

import { OpenCodeHostAdapter } from "./host-adapter.js";
import type { Logger } from "../../core/types.js";

function createFakeLogger(): Logger & { messages: string[] } {
  const messages: string[] = [];
  return {
    messages,
    debug: (message) => messages.push(`debug:${message}`),
    info: (message) => messages.push(`info:${message}`),
    warn: (message) => messages.push(`warn:${message}`),
    error: (message) => messages.push(`error:${message}`),
  };
}

describe("OpenCodeHostAdapter", () => {
  it("normalizes fake runtime identity into a scoped runtime context", () => {
    const logger = createFakeLogger();
    const adapter = new OpenCodeHostAdapter({
      logger,
      config: { plugin: ["@tencentdb-agent-memory/memory-tencentdb"] },
      pluginOptions: { gatewayUrl: "http://127.0.0.1:8420/", apiKey: "test-token" },
      workspace: { directory: "D:/workspaces/acme" },
      project: { directory: "D:/workspaces/acme/project-a" },
      session: { id: "session-7" },
      user: { id: "user-7" },
      dataDir: "D:/state/tdai",
    });

    const identity = adapter.getIdentity();
    const context = adapter.getRuntimeContext();

    expect(identity).toMatchObject({
      userId: "user-7",
      sessionId: "session-7",
      workspaceDir: "D:/workspaces/acme",
      projectDir: "D:/workspaces/acme/project-a",
      dataDir: "D:/state/tdai",
    });
    expect(identity.sessionKey).toMatch(/^opencode:[a-f0-9]{16}:[a-f0-9]{16}:session-7:[a-f0-9]{16}$/);
    expect(identity.sessionKey).not.toContain("D:/workspaces/acme");
    expect(identity.sessionKey).not.toContain("project-a");
    expect(context).toEqual({
      userId: "user-7",
      sessionId: "session-7",
      sessionKey: identity.sessionKey,
      platform: "opencode",
      workspaceDir: "D:/workspaces/acme",
      dataDir: "D:/state/tdai",
    });
    expect(adapter.getLogger()).toBe(logger);
    expect(adapter.getOpenCodeConfig()).toEqual({ plugin: ["@tencentdb-agent-memory/memory-tencentdb"] });
    expect(adapter.getParsedPluginConfig()).toMatchObject({
      gatewayUrl: "http://127.0.0.1:8420",
      apiKey: "test-token",
    });
  });

  it("exposes conservative capability flags by default", async () => {
    const adapter = new OpenCodeHostAdapter({
      workspaceDir: "D:/workspace",
      projectDir: "D:/workspace/project",
      sessionId: "session-1",
    });

    expect(adapter.supportsPreModelRecallInjection).toBe(false);
    expect(adapter.getCapabilities()).toEqual({
      supportsEventSubscription: false,
      supportsToolRegistration: false,
      supportsLifecycleDispose: true,
      supportsContextInjection: false,
      supportsPreModelRecallInjection: false,
    });
    await expect(
      adapter.injectContext({ sessionId: "session-1", sessionKey: adapter.getIdentity().sessionKey, context: "memory" }),
    ).resolves.toBe(false);
  });

  it("tracks event and tool disposers and only disposes them once", async () => {
    const disposed: string[] = [];
    const subscribed: string[] = [];
    const registeredTools: string[] = [];
    const adapter = new OpenCodeHostAdapter({
      workspaceDir: "D:/workspace",
      projectDir: "D:/workspace/project",
      sessionId: "session-1",
      subscribeEvent(eventName) {
        subscribed.push(eventName);
        return () => disposed.push(`event:${eventName}`);
      },
      registerTool(tool) {
        registeredTools.push(tool.name);
        return () => disposed.push(`tool:${tool.name}`);
      },
    });

    const disposeEvent = adapter.subscribeEvent("session.updated", () => {});
    adapter.registerTool({ name: "tdai_memory_recall", description: "fake recall tool" });
    await disposeEvent();
    await disposeEvent();
    await adapter.dispose();
    await adapter.dispose();

    expect(subscribed).toEqual(["session.updated"]);
    expect(registeredTools).toEqual(["tdai_memory_recall"]);
    expect(disposed).toEqual(["event:session.updated", "tool:tdai_memory_recall"]);
  });

  it("can build a new scoped context for a later session without raw paths in the key", () => {
    const adapter = new OpenCodeHostAdapter({
      workspaceDir: "D:/workspace",
      projectDir: "D:/workspace/project",
      sessionId: "session-1",
      userId: "user-1",
      dataDir: "D:/state/tdai",
    });

    const context = adapter.buildRuntimeContextForSession({ id: "session-2" });

    expect(context.sessionId).toBe("session-2");
    expect(context.sessionKey).toMatch(/^opencode:[a-f0-9]{16}:[a-f0-9]{16}:session-2:[a-f0-9]{16}$/);
    expect(context.sessionKey).not.toContain("D:/workspace");
    expect(context.workspaceDir).toBe("D:/workspace");
    expect(context.dataDir).toBe("D:/state/tdai");
  });
});
