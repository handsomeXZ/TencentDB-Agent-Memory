# OpenCode Plugin API Compatibility Contract

## Target Version/Commit

- Target source: `anomalyco/opencode` commit `b956e9a06f2bf4e3a6ff026d0566c362f57a76b7`.
- Target package versions at that commit: `opencode` `1.15.12` and `@opencode-ai/plugin` `1.15.12`.
- Local installed package check: this repository currently has no installed `node_modules/@opencode-ai/plugin`, `node_modules/opencode`, or `node_modules/@opencode-ai/opencode` package, so this contract is pinned to the source commit above rather than a local package installation.
- Compatibility scope: this document does not claim compatibility with OpenCode versions or commits outside that pinned source.

## Package Loading/Server Entry

- Local plugins are loaded from `.opencode/plugins/` and `~/.config/opencode/plugins/` at startup.
- npm plugins are declared in `opencode.json` under `plugin`, including scoped packages and tuple entries with options, and OpenCode installs them with Bun into `~/.cache/opencode/node_modules/`.
- Server npm packages should expose a server entry through `exports["./server"]`; OpenCode resolves `./server` first for server plugins and falls back to `main` only for server kind when no `./server` export is present.
- A v1 server plugin module must default export an object with a `server()` function. For path plugins, an explicit `id` export is required; npm plugins can use the package `name` as the plugin ID.
- Current repository state: `package.json` only exports `.` and `tsdown.config.ts` only builds `./index.ts`. Later server-entry work must add `./server` without breaking the existing OpenClaw root entry.

## Tool Helper Contract

- `@opencode-ai/plugin` exports the helper surface, and its package also exports `./tool` as `@opencode-ai/plugin/tool`.
- `tool()` accepts `{ description, args, execute }`, where `args` is a Zod raw shape and `execute(args, context)` returns either a string or `{ title?, output, metadata?, attachments? }`.
- `tool.schema` is the Zod namespace used for tool argument schemas.
- Tool context includes `sessionID`, `messageID`, `agent`, `directory`, `worktree`, `abort`, `metadata()`, and `ask()`.
- The OpenCode server entry for this project should register exactly the v1 memory tools planned later: `tdai_memory_recall`, `tdai_memory_search`, and `tdai_conversation_search`.

## Config Loading

- OpenCode config supports `plugin?: Array<string | [string, PluginOptions]>`, so npm configuration can pass plugin-specific options as a tuple entry.
- The server plugin function signature receives `(input, options?)`; the second parameter is the plugin-specific options object from config.
- The `config` hook receives the loaded OpenCode config with the `plugin` field omitted from the SDK config shape and reintroduced as the plugin spec array.
- Implementation should parse and validate only this plugin's options, including `gatewayUrl`, `apiKey`, `timeoutMs`, `recall`, `capture`, and `tools`, and must not infer configuration from OpenClaw-only metadata.

## Hooks/Events/Dispose

- The pinned hook surface includes `dispose`, `event`, `config`, `tool`, `auth`, `provider`, `chat.message`, `chat.params`, `chat.headers`, `permission.ask`, `command.execute.before`, `tool.execute.before`, `tool.execute.after`, `shell.env`, `tool.definition`, and experimental chat/session/text hooks.
- Documented events include command, file, installation, LSP, message, permission, server, session, todo, shell, tool, and TUI events. `event({ event })` is the general subscription entry point.
- `dispose?: () => Promise<void>` is present in the type surface and should be used to release timers, abort controllers, caches, and pending Gateway clients created by the plugin.
- `experimental.session.compacting` can add compaction context or replace the compaction prompt, but that is not a v1 recall-injection guarantee.

## Permissions

- The pinned hook surface includes `permission.ask(input, output)` with mutable `output.status` values of `ask`, `deny`, or `allow`.
- Tool execution context includes `ask({ permission, patterns, always, metadata })`, so future tools can request explicit OpenCode permission when an operation needs it.
- The memory plugin should not bypass OpenCode permissions. Gateway calls are normal plugin-side HTTP operations and still must avoid logging secrets or leaking full API keys.

## Recall Injection Decision

- Pre-model automatic recall injection is **not verified** by this task.
- The pinned type surface exposes experimental hooks that can mutate chat messages or system prompt arrays, but the plan-referenced sources inspected here do not prove a stable, non-experimental, end-to-end pre-model context mutation path suitable for automatic recall injection.
- Code-level decision: automatic pre-model recall injection is disabled for the first implementation until a later task verifies the concrete runtime path with tests against OpenCode.
- fallback: register explicit `tdai_memory_recall`, `tdai_memory_search`, and `tdai_conversation_search` tools. The agent can call these tools intentionally to retrieve memories or conversations.
- Best-effort supported hook behavior is limited to documented/type-surfaced hooks for capture, session lifecycle, permissions, and cleanup; it must not silently inject recall context into model input unless later verification proves the hook path.

## Implementation Implications

- Task 3 should add an npm-ready `./server` export pointing to the OpenCode server build output while preserving the current OpenClaw `.` export.
- Task 7 and later adapter work should target `PluginInput`, `PluginOptions`, `Hooks`, and `ToolContext` from `@opencode-ai/plugin` at the pinned contract, not OpenClaw SDK types.
- Task 9 must test recall lifecycle through explicit tools first. Any automatic recall injection path must remain off unless runtime verification proves an allowed pre-model mutation path.
- Task 10 can use supported events/hooks for capture/session lifecycle, but must keep Gateway failures non-blocking after configuration validation.
- Task 11 should default export a v1 plugin module object with `server()` and should include cleanup through `dispose`.

## Traceable Sources

- Plugin loading docs: `https://github.com/anomalyco/opencode/blob/b956e9a06f2bf4e3a6ff026d0566c362f57a76b7/packages/web/src/content/docs/plugins.mdx`
- Hooks/events type surface: `https://github.com/anomalyco/opencode/blob/b956e9a06f2bf4e3a6ff026d0566c362f57a76b7/packages/plugin/src/index.ts`
- Tool helper contract: `https://github.com/anomalyco/opencode/blob/b956e9a06f2bf4e3a6ff026d0566c362f57a76b7/packages/plugin/src/tool.ts`
- Server entry resolution: `https://github.com/anomalyco/opencode/blob/b956e9a06f2bf4e3a6ff026d0566c362f57a76b7/packages/opencode/src/plugin/shared.ts`
- Package version source: `https://github.com/anomalyco/opencode/blob/b956e9a06f2bf4e3a6ff026d0566c362f57a76b7/packages/opencode/package.json` and `https://github.com/anomalyco/opencode/blob/b956e9a06f2bf4e3a6ff026d0566c362f57a76b7/packages/plugin/package.json`
