import type { Logger, RuntimeContext } from "../../core/types.js";
import type { OpenCodePluginConfig, OpenCodePluginConfigInput } from "./config.js";
import { parseOpenCodePluginConfig } from "./config.js";
import { createOpenCodeSessionKey } from "./policy.js";

export type OpenCodeDisposer = () => void | Promise<void>;

export type OpenCodeEventHandler<TEvent = unknown> = (event: TEvent) => void | Promise<void>;

export interface OpenCodeWorkspaceLike {
  id?: string;
  directory?: string;
  path?: string;
  root?: string;
  cwd?: string;
}

export interface OpenCodeProjectLike {
  id?: string;
  name?: string;
  directory?: string;
  path?: string;
  root?: string;
  worktree?: string;
}

export interface OpenCodeSessionLike {
  id?: string;
  sessionId?: string;
  sessionID?: string;
}

export interface OpenCodeUserLike {
  id?: string;
  userId?: string;
  userID?: string;
  login?: string;
  email?: string;
}

export interface OpenCodeToolDefinitionLike {
  name: string;
  description?: string;
  args?: unknown;
  execute?: unknown;
  [key: string]: unknown;
}

export interface OpenCodeContextInjectionRequest {
  sessionId: string;
  sessionKey: string;
  context: string;
  source?: string;
}

export interface OpenCodeRuntimeLike {
  config?: unknown;
  options?: OpenCodePluginConfigInput | Record<string, unknown>;
  subscribeEvent?: (eventName: string, handler: OpenCodeEventHandler) => OpenCodeDisposer | void;
  onEvent?: (eventName: string, handler: OpenCodeEventHandler) => OpenCodeDisposer | void;
  registerTool?: (tool: OpenCodeToolDefinitionLike) => OpenCodeDisposer | void;
  injectContext?: (request: OpenCodeContextInjectionRequest) => void | Promise<void>;
}

export interface OpenCodeHostIdentity {
  userId: string;
  sessionId: string;
  sessionKey: string;
  workspaceDir: string;
  projectDir: string;
  dataDir: string;
}

export interface OpenCodeHostCapabilities {
  supportsEventSubscription: boolean;
  supportsToolRegistration: boolean;
  supportsLifecycleDispose: true;
  supportsContextInjection: boolean;
  supportsPreModelRecallInjection: false;
}

export interface OpenCodeHostAdapterOptions {
  runtime?: OpenCodeRuntimeLike;
  logger?: Logger;
  config?: unknown;
  pluginOptions?: OpenCodePluginConfigInput | Record<string, unknown>;
  parsedConfig?: OpenCodePluginConfig;
  workspace?: OpenCodeWorkspaceLike;
  project?: OpenCodeProjectLike;
  session?: OpenCodeSessionLike;
  user?: OpenCodeUserLike;
  workspaceDir?: string;
  projectDir?: string;
  dataDir?: string;
  sessionId?: string;
  userId?: string;
  subscribeEvent?: (eventName: string, handler: OpenCodeEventHandler) => OpenCodeDisposer | void;
  registerTool?: (tool: OpenCodeToolDefinitionLike) => OpenCodeDisposer | void;
  injectContext?: (request: OpenCodeContextInjectionRequest) => void | Promise<void>;
}

const noopLogger: Logger = {
  info() {},
  warn() {},
  error() {},
};

export class OpenCodeHostAdapter {
  readonly hostType = "opencode" as const;
  readonly supportsPreModelRecallInjection = false as const;

  private readonly runtime?: OpenCodeRuntimeLike;
  private readonly logger: Logger;
  private readonly config: unknown;
  private readonly pluginOptions: OpenCodePluginConfigInput | Record<string, unknown> | undefined;
  private readonly parsedConfig?: OpenCodePluginConfig;
  private readonly identity: OpenCodeHostIdentity;
  private readonly subscribeEventFn?: (eventName: string, handler: OpenCodeEventHandler) => OpenCodeDisposer | void;
  private readonly registerToolFn?: (tool: OpenCodeToolDefinitionLike) => OpenCodeDisposer | void;
  private readonly injectContextFn?: (request: OpenCodeContextInjectionRequest) => void | Promise<void>;
  private readonly disposers: OpenCodeDisposer[] = [];
  private disposed = false;

  constructor(options: OpenCodeHostAdapterOptions = {}) {
    this.runtime = options.runtime;
    this.logger = options.logger ?? noopLogger;
    this.config = options.config ?? options.runtime?.config;
    this.pluginOptions = options.pluginOptions ?? options.runtime?.options;
    this.parsedConfig = options.parsedConfig;
    this.subscribeEventFn = options.subscribeEvent ?? options.runtime?.subscribeEvent ?? options.runtime?.onEvent;
    this.registerToolFn = options.registerTool ?? options.runtime?.registerTool;
    this.injectContextFn = options.injectContext ?? options.runtime?.injectContext;
    this.identity = buildIdentity(options);
  }

  getRuntimeContext(): RuntimeContext {
    return {
      userId: this.identity.userId,
      sessionId: this.identity.sessionId,
      sessionKey: this.identity.sessionKey,
      platform: "opencode",
      workspaceDir: this.identity.workspaceDir,
      dataDir: this.identity.dataDir,
    };
  }

  buildRuntimeContextForSession(session: OpenCodeSessionLike | string): RuntimeContext {
    const sessionId = typeof session === "string" ? session : normalizeSessionId(session) ?? this.identity.sessionId;
    const sessionKey = createOpenCodeSessionKey({
      workspaceDir: this.identity.workspaceDir,
      projectDir: this.identity.projectDir,
      sessionId,
      userId: this.identity.userId === "local" ? undefined : this.identity.userId,
    });

    return {
      ...this.getRuntimeContext(),
      sessionId,
      sessionKey,
    };
  }

  getLogger(): Logger {
    return this.logger;
  }

  getIdentity(): OpenCodeHostIdentity {
    return { ...this.identity };
  }

  getCapabilities(): OpenCodeHostCapabilities {
    return {
      supportsEventSubscription: !!this.subscribeEventFn,
      supportsToolRegistration: !!this.registerToolFn,
      supportsLifecycleDispose: true,
      supportsContextInjection: !!this.injectContextFn,
      supportsPreModelRecallInjection: false,
    };
  }

  getOpenCodeConfig(): unknown {
    return this.config;
  }

  getPluginOptions(): OpenCodePluginConfigInput | Record<string, unknown> | undefined {
    return this.pluginOptions;
  }

  getParsedPluginConfig(env?: NodeJS.ProcessEnv | Record<string, string | undefined>): OpenCodePluginConfig {
    return this.parsedConfig ?? parseOpenCodePluginConfig(this.pluginOptions, env);
  }

  subscribeEvent(eventName: string, handler: OpenCodeEventHandler): OpenCodeDisposer {
    const disposer = this.subscribeEventFn?.(eventName, handler) ?? noopDisposer;
    return this.trackDisposer(disposer);
  }

  registerTool(tool: OpenCodeToolDefinitionLike): OpenCodeDisposer {
    const disposer = this.registerToolFn?.(tool) ?? noopDisposer;
    return this.trackDisposer(disposer);
  }

  async injectContext(request: OpenCodeContextInjectionRequest): Promise<boolean> {
    if (!this.injectContextFn) {
      return false;
    }

    await this.injectContextFn(request);
    return true;
  }

  async dispose(): Promise<void> {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    const pending = this.disposers.splice(0).reverse().map(async (dispose) => {
      await dispose();
    });
    await Promise.all(pending);
  }

  private trackDisposer(disposer: OpenCodeDisposer): OpenCodeDisposer {
    let called = false;
    const wrapped = async () => {
      if (called) {
        return;
      }
      called = true;
      await disposer();
    };

    this.disposers.push(wrapped);
    return wrapped;
  }
}

function buildIdentity(options: OpenCodeHostAdapterOptions): OpenCodeHostIdentity {
  const workspaceDir = firstNonEmpty(
    options.workspaceDir,
    options.workspace?.directory,
    options.workspace?.path,
    options.workspace?.root,
    options.workspace?.cwd,
  ) ?? process.cwd();
  const projectDir = firstNonEmpty(
    options.projectDir,
    options.project?.directory,
    options.project?.path,
    options.project?.root,
    options.project?.worktree,
  ) ?? workspaceDir;
  const dataDir = firstNonEmpty(options.dataDir) ?? workspaceDir;
  const sessionId = firstNonEmpty(options.sessionId, normalizeSessionId(options.session)) ?? "local-session";
  const rawUserId = firstNonEmpty(
    options.userId,
    options.user?.id,
    options.user?.userId,
    options.user?.userID,
    options.user?.login,
    options.user?.email,
  );
  const userId = rawUserId ?? "local";

  return {
    userId,
    sessionId,
    sessionKey: createOpenCodeSessionKey({ workspaceDir, projectDir, sessionId, userId: rawUserId }),
    workspaceDir,
    projectDir,
    dataDir,
  };
}

function normalizeSessionId(session: OpenCodeSessionLike | undefined): string | undefined {
  return firstNonEmpty(session?.id, session?.sessionId, session?.sessionID);
}

function firstNonEmpty(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) {
      return trimmed;
    }
  }

  return undefined;
}

function noopDisposer(): void {}
