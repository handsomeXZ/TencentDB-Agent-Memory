export {
  OPEN_CODE_PLUGIN_DEFAULTS,
  OpenCodePluginConfigError,
  parseOpenCodePluginConfig,
  toLoggableOpenCodePluginConfig,
} from "./config.js";
export { OpenCodeHostAdapter } from "./host-adapter.js";
export { createOpenCodeLifecycleController } from "./lifecycle.js";
export {
  buildOpenCodeCapturePolicy,
  createFinalTurnIdempotencyKey,
  createOpenCodeSessionKey,
  getOpenCodeCaptureCategories,
  redactSensitiveText,
} from "./policy.js";

export type {
  OpenCodePluginConfig,
  OpenCodePluginConfigInput,
  OpenCodePluginLoggableConfig,
} from "./config.js";
export type {
  OpenCodeContextInjectionRequest,
  OpenCodeDisposer,
  OpenCodeEventHandler,
  OpenCodeHostAdapterOptions,
  OpenCodeHostCapabilities,
  OpenCodeHostIdentity,
  OpenCodeProjectLike,
  OpenCodeRuntimeLike,
  OpenCodeSessionLike,
  OpenCodeToolDefinitionLike,
  OpenCodeUserLike,
  OpenCodeWorkspaceLike,
} from "./host-adapter.js";
export type {
  OpenCodeFinalTurnEvent,
  OpenCodeLifecycleClient,
  OpenCodeLifecycleControllerOptions,
  OpenCodeLifecycleLogger,
  OpenCodeSessionEndEvent,
} from "./lifecycle.js";
export type {
  OpenCodeCaptureCategories,
  OpenCodeCaptureInput,
  OpenCodeCapturePolicy,
  OpenCodeFinalTurnIdempotencyInput,
  OpenCodeSessionKeyInput,
} from "./policy.js";
