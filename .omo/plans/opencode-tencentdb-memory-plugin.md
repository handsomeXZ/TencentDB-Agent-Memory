# OpenCode TencentDB Agent Memory Plugin Integration

## TL;DR
> **Summary**: Build an npm-ready OpenCode plugin that connects to the existing independent TencentDB-Agent-Memory Gateway over HTTP. The first version implements long-term memory capture, recall, search tools, and session-end flush; it explicitly does not embed storage, manage Docker/Gateway lifecycle, or implement short-term context offload.
> **Deliverables**:
> - OpenCode plugin architecture and package/export wiring
> - Gateway HTTP client with mandatory Bearer auth
> - OpenCode server plugin entry, config validation, hooks/events, one recall tool, and two search tools
> - TDD coverage with mock Gateway and real docker Gateway smoke/e2e
> - Local `.opencode/plugins` dev validation plus npm package validation
> **Effort**: Large
> **Parallel**: YES - 5 waves
> **Critical Path**: Task 1 → Task 2 → Task 3 → Task 5 → Task 10 → Task 14 → Final Verification

## Context
### Original Request
用户要求：学习当前仓库的 OpenClaw 和 Hermes 插件，为 OpenCode 编写一份接入 TencentDB-Agent-Memory 的插件实现方案。约束：必须使用 `D:\ForkWorkSpace\TencentDB-Agent-Memory\docker` 中已部署的独立 Memory 服务。

### Interview Summary
- 第一版能力范围：长期记忆优先，覆盖 capture、recall、memory search、conversation search、session end。
- 第一版排除：短期 context offload/压缩、Gateway supervisor/docker 管理、嵌入式存储、admin UI、seed/delete/update/debug 管理工具。
- 交付形态：npm-ready OpenCode plugin，显式提供 `./server` entry，同时保留 `.opencode/plugins` 本地开发验证路径。
- Gateway 鉴权：强制 API Key；受保护 endpoint 必须带 `Authorization: Bearer <token>`。
- 测试策略：TDD；先 mock Gateway contract tests，再真实独立 docker Gateway smoke/e2e。

### Metis Review (gaps addressed)
- OpenCode 版本边界必须在任务 1 中 pin/test/document，不能默认所有 hooks 都稳定。
- Recall 注入必须有 fallback：若 OpenCode 无法在模型调用前修改上下文，则只注册显式 recall/search tools 或使用可验证 hook。
- Session key 必须包含 workspace/project/session/user 维度，防止跨项目记忆污染。
- Capture 默认最小化，过滤 system prompt、权限询问、shell env、secrets、大型 tool output、二进制内容。
- Gateway down/timeout/5xx 默认非阻塞降级；只有缺少 API key/非法配置 fail fast。
- 必须有 timeout、retry/no-retry、idempotency/dedupe 策略。

## Work Objectives
### Core Objective
Design and implement a TypeScript OpenCode plugin server entry that uses the existing independent TencentDB-Agent-Memory Gateway as the only memory backend.

### Deliverables
- `src/adapters/opencode/` adapter layer for OpenCode-specific session/config/hook mapping.
- `src/gateway-client/index.ts` TypeScript Gateway client for `/health`, `/recall`, `/capture`, `/search/memories`, `/search/conversations`, `/session/end`.
- OpenCode plugin server entry and npm `exports["./server"]` wiring.
- Three OpenCode custom tools: `tdai_memory_recall` calls `/recall`, `tdai_memory_search` calls `/search/memories`, and `tdai_conversation_search` calls `/search/conversations`. If OpenCode supports verified pre-model context injection, automatic recall uses `/recall`; if not, `tdai_memory_recall` is the explicit fallback.
- Mock Gateway unit tests and real docker smoke/e2e test scripts.
- Documentation snippets for `opencode.json`, environment variables, and local `.opencode/plugins` development.

### Definition of Done (verifiable conditions with commands)
- `npm run build` succeeds.
- `npm test` succeeds and includes OpenCode Gateway client/tool/hook tests.
- `npm pack --dry-run` and `npm pack` succeed with `./server` included.
- Final acceptance requires real Gateway smoke to pass against `http://127.0.0.1:8420` using `TDAI_GATEWAY_API_KEY`; CI may skip this check, but final completion may not skip it unless the user explicitly approves a waiver.
- Local `.opencode/plugins` loading path and npm plugin config path are both verified by agent-executed checks or documented reproducible commands.

### Must Have
- Mandatory API key validation for protected endpoints.
- HTTP-only Gateway integration; no direct DB/storage imports.
- Configurable `gatewayUrl`, `apiKey`, `timeoutMs`, `recall.maxResults`, `recall.maxTotalChars`, `capture.enabled`, `tools.enabled`.
- Non-blocking degraded mode for Gateway outages after configuration passes.
- Idempotent capture/session-end behavior.
- Explicit OpenCode compatibility verification task.

### Must NOT Have (guardrails, AI slop patterns, scope boundaries)
- MUST NOT start, stop, restart, supervise, or configure Docker/Gateway from the plugin.
- MUST NOT implement short-term context offload/compression in v1.
- MUST NOT embed SQLite, vector DB, or TencentDB storage in OpenCode process.
- MUST NOT add admin tools such as seed/delete/update/debug/stats; the only v1 tools are `tdai_memory_recall`, `tdai_memory_search`, and `tdai_conversation_search`.
- MUST NOT log full API keys, system prompts, shell env, secrets, or full large tool outputs.
- MUST NOT silently send unauthenticated protected requests.

## Verification Strategy
> ZERO HUMAN INTERVENTION - all verification is agent-executed.
- Test decision: TDD + Vitest for TypeScript mock Gateway tests; real Gateway smoke/e2e as opt-in command.
- QA policy: Every task has agent-executed happy and failure scenarios.
- Evidence: `.omo/evidence/task-{N}-{slug}.{ext}`

## Execution Strategy
### Parallel Execution Waves
> Target: 5-8 tasks per wave. <3 per wave (except final) = under-splitting.
> Extract shared dependencies as Wave-1 tasks for max parallelism.

Wave 1A: Task 1 compatibility contract, Task 2 Gateway client contract tests, Task 4 config schema, Task 5 session/capture policy.
Wave 1B: Task 3 package/export design after T1 confirms OpenCode entry expectations.
Wave 2A: Task 6 Gateway client implementation, Task 7 OpenCode adapter skeleton.
Wave 2B: Task 8 tools TDD, Task 9 recall lifecycle TDD, Task 10 capture/session lifecycle TDD after T6/T7 unblock runtime contracts.
Wave 3A: Task 11 server entry wiring, Task 12 tool implementation, Task 13 recall/capture implementation, Task 15 docs/config snippets.
Wave 3B: Task 14 local/npm loading validation after T11 server entry exists.
Wave 4: Task 16 real Gateway smoke/e2e, Task 17 CI/build/test command integration, Task 18 security/error hardening.
Wave 5: Task 19 final integration sweep and evidence consolidation.

### Dependency Matrix (full, all tasks)
- T1 blocks T3, T7, T9, T10, T11.
- T2 blocks T6 and T16.
- T3 blocks T11, T14, T17.
- T4 blocks T6, T11, T15, T18.
- T5 blocks T9, T10, T13, T18.
- T6 blocks T8, T9, T10, T12, T13, T16.
- T7 blocks T9, T10, T11, T13.
- T8 blocks T12.
- T9 blocks T13.
- T10 blocks T13.
- T11 blocks T14, T16, T17.
- T12 blocks T16.
- T13 blocks T16, T18.
- T14 blocks T16, T17.
- T15 blocks T19.
- T16, T17, T18 block T19.

### Agent Dispatch Summary (wave → task count → categories)
- Wave 1A → 4 tasks → quick, unspecified-high; Wave 1B → 1 task → unspecified-high.
- Wave 2A → 2 tasks → unspecified-high; Wave 2B → 3 tasks → unspecified-high, quick.
- Wave 3A → 4 tasks → unspecified-high, quick, writing; Wave 3B → 1 task → writing.
- Wave 4 → 3 tasks → unspecified-high, quick.
- Wave 5 → 1 task → unspecified-high.

## TODOs
> Implementation + Test = ONE task. Never separate.
> EVERY task MUST have: Agent Profile + Parallelization + QA Scenarios.

- [x] 1. Verify OpenCode plugin API compatibility contract

  **What to do**: Pin the OpenCode plugin API target before implementation. Inspect the installed/target OpenCode version and official docs commit; confirm availability of server plugin entry, `@opencode-ai/plugin/tool`, plugin config loading, events/hooks, `dispose`, and permissions. Write the compatibility findings into `docs/opencode-plugin-compatibility.md`, and encode any API limitation as a code-level fallback decision.
  **Must NOT do**: Do not assume recall pre-model injection is supported unless verified. Do not modify Gateway code.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - Reason: Requires reading external API contracts and local package wiring before implementation.
  - Skills: [] - No specialized skill required beyond code/document inspection.
  - Omitted: [`playwright`] - No browser UI validation needed.

  **Parallelization**: Can Parallel: YES | Wave 1 | Blocks: T3, T7, T9, T10, T11 | Blocked By: none

  **References**:
  - External: `https://github.com/anomalyco/opencode/blob/b956e9a06f2bf4e3a6ff026d0566c362f57a76b7/packages/web/src/content/docs/plugins.mdx#L18-L63` - local/global plugin loading rules.
  - External: `https://github.com/anomalyco/opencode/blob/b956e9a06f2bf4e3a6ff026d0566c362f57a76b7/packages/plugin/src/index.ts#L222-L334` - plugin hooks/events type surface.
  - External: `https://github.com/anomalyco/opencode/blob/b956e9a06f2bf4e3a6ff026d0566c362f57a76b7/packages/plugin/src/tool.ts#L45-L54` - `tool()` helper contract.
  - External: `https://github.com/anomalyco/opencode/blob/b956e9a06f2bf4e3a6ff026d0566c362f57a76b7/packages/opencode/src/plugin/shared.ts#L103-L114` - server entry resolution.

  **Acceptance Criteria** (agent-executable only):
  - [ ] A compatibility note exists and names the OpenCode version/docs commit used.
  - [ ] The note explicitly states whether pre-model recall injection is supported; if not verified, the implementation plan uses explicit tools plus best-effort supported hook only.
  - [ ] `npm run build` still succeeds after any docs/package note changes.

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```
  Scenario: Compatibility source is traceable
    Tool: Bash
    Steps: Run a command that prints the chosen OpenCode package/docs version or commit and grep the compatibility note for that value.
    Expected: Command output and note contain the same version/commit.
    Evidence: .omo/evidence/task-1-compatibility-contract.txt

  Scenario: Unsupported recall injection is handled
    Tool: Bash
    Steps: Grep the compatibility note for "fallback" and "recall".
    Expected: Note contains a fallback path for unsupported pre-model injection.
    Evidence: .omo/evidence/task-1-recall-fallback.txt
  ```

  **Commit**: YES | Message: `docs(opencode): document plugin compatibility contract` | Files: [`docs/opencode-plugin-compatibility.md`]

- [x] 2. Add Gateway client contract tests before implementation

  **What to do**: Create Vitest tests for the future TypeScript Gateway client using a mock HTTP server/fetch mock. Cover `/health`, `/recall`, `/capture`, `/search/memories`, `/search/conversations`, `/session/end`, auth header, timeout, non-JSON response, 401, 5xx, URL trailing slash normalization, and missing API key fail-fast.
  **Must NOT do**: Do not call the real docker Gateway in unit tests. Do not create implementation that satisfies tests in this task unless needed only as minimal test scaffolding.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - Reason: Establishes TDD contract for all network behavior.
  - Skills: [] - Standard TypeScript test work.
  - Omitted: [`playwright`] - No UI.

  **Parallelization**: Can Parallel: YES | Wave 1 | Blocks: T6, T16 | Blocked By: none

  **References**:
  - API/Type: `src/gateway/types.ts:1-143` - request/response DTO source of truth.
  - Pattern: `src/gateway/server.ts:1-260` - actual route names and health/auth behavior.
  - Pattern: `hermes-plugin/memory/memory_tencentdb/client.py:1-196` - existing Gateway client endpoint mapping.
  - Test: `vitest.config.ts` - Vitest configuration includes `src/**/*.test.ts` and `__tests__/**/*.test.ts`.

  **Acceptance Criteria** (agent-executable only):
  - [ ] New tests fail before client implementation or are marked as TDD contract with explicit TODO until T6.
  - [ ] Tests assert `Authorization: Bearer <token>` on protected endpoints and no full token in thrown/logged messages.
  - [ ] Tests assert missing API key causes no protected network request.
  - [ ] `npm test` runs the new tests.

  **QA Scenarios**:
  ```
  Scenario: Protected endpoint sends Bearer token
    Tool: Bash
    Steps: Run npm test for the Gateway client contract test file with a mock token "test-secret-token".
    Expected: Mock server records Authorization "Bearer test-secret-token" for /recall, /capture, /search/*, /session/end.
    Evidence: .omo/evidence/task-2-bearer-auth.txt

  Scenario: Missing API key fails before network
    Tool: Bash
    Steps: Run the missing-api-key test case and assert mock request count is 0.
    Expected: Test passes and error message does not contain an API key value.
    Evidence: .omo/evidence/task-2-missing-key.txt
  ```

  **Commit**: YES | Message: `test(opencode): add gateway client contract tests` | Files: [new Gateway client test file]

- [x] 3. Define npm-ready package/export layout for OpenCode server entry

  **What to do**: Implement the fixed npm-ready layout: adapter files live under `src/adapters/opencode/`; plugin server entry is exactly `src/opencode/server.ts`; build output is exactly `dist/opencode/server.js` and `dist/opencode/server.d.ts`; `package.json` must contain `exports["./server"] = { "types": "./dist/opencode/server.d.ts", "import": "./dist/opencode/server.js" }`; `tsdown.config.ts` must include an `opencode/server` entry pointing to `src/opencode/server.ts`. Preserve existing OpenClaw root entry behavior.
  **Must NOT do**: Do not break `openclaw.plugin.json` compatibility. Do not remove existing `index.ts` root entry.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - Reason: Package export changes can break existing consumers.
  - Skills: []
  - Omitted: [`git-master`] - No git operation unless user later asks to commit.

  **Parallelization**: Can Parallel: YES | Wave 1 | Blocks: T11, T14, T17 | Blocked By: T1

  **References**:
  - Pattern: `package.json:1-126` - existing npm files/scripts/openclaw metadata.
  - Pattern: `tsdown.config.ts:1-35` - current build entry and externalization conventions.
  - Pattern: `openclaw.plugin.json:1-164` - existing OpenClaw package contract to preserve.
  - External: `https://github.com/anomalyco/opencode/blob/b956e9a06f2bf4e3a6ff026d0566c362f57a76b7/packages/plugin/package.json#L11-L15` - OpenCode plugin package exports.

  **Acceptance Criteria**:
  - [ ] `package.json` exposes exactly `./server` with `types: ./dist/opencode/server.d.ts` and `import: ./dist/opencode/server.js` without removing existing OpenClaw/package exports.
  - [ ] Build output includes exactly `dist/opencode/server.js` and `dist/opencode/server.d.ts`.
  - [ ] `npm pack --dry-run` lists the server entry and excludes tests/evidence.
  - [ ] `npm run build` succeeds.

  **QA Scenarios**:
  ```
  Scenario: npm package includes server entry
    Tool: Bash
    Steps: Run npm pack --dry-run and capture output.
    Expected: Output lists the built OpenCode server entry and package metadata.
    Evidence: .omo/evidence/task-3-npm-pack-dry-run.txt

  Scenario: OpenClaw entry remains intact
    Tool: Bash
    Steps: Run npm run build and grep built package/metadata for existing OpenClaw root entry or manifest inclusion.
    Expected: Existing OpenClaw plugin files remain included.
    Evidence: .omo/evidence/task-3-openclaw-preserved.txt
  ```

  **Commit**: YES | Message: `build(opencode): add server entry export` | Files: [`package.json`, `tsdown.config.ts`, `src/opencode/server.ts`]

- [x] 4. Define OpenCode plugin config schema and precedence

  **What to do**: Implement a typed config module for the OpenCode plugin. Required fields/defaults: `gatewayUrl` default `http://127.0.0.1:8420`; `apiKey` required via plugin config or `TDAI_GATEWAY_API_KEY`; `timeoutMs` default `5000`; `capture.enabled` default `true`; `recall.enabled` default `true`; `recall.maxResults` default `5`; `recall.maxTotalChars` default `6000`; `tools.enabled` default `true`; `redaction.enabled` default `true`. When `tools.enabled` is true, all three v1 tools are registered; when false, none are registered. Precedence: explicit OpenCode plugin config > env vars > defaults; API key has no default and must fail fast.
  **Must NOT do**: Do not accept empty/whitespace API keys. Do not print raw config if it contains secrets.

  **Recommended Agent Profile**:
  - Category: `quick` - Reason: Focused config module and tests.
  - Skills: []
  - Omitted: [`playwright`] - No UI.

  **Parallelization**: Can Parallel: YES | Wave 1 | Blocks: T6, T11, T15, T18 | Blocked By: none

  **References**:
  - Pattern: `src/config.ts:1-260` - existing memory plugin config/default style.
  - Pattern: `src/gateway/config.ts:1-260` - Gateway env/config loading conventions.
  - Pattern: `docker/standalone/.env.example` - independent service env names.
  - External: `https://github.com/anomalyco/opencode/blob/b956e9a06f2bf4e3a6ff026d0566c362f57a76b7/packages/web/src/content/docs/config.mdx#L753-L763` - OpenCode plugin config loading.

  **Acceptance Criteria**:
  - [ ] Config parser rejects missing, empty, or whitespace-only API key.
  - [ ] Config parser normalizes `gatewayUrl` with or without trailing slash.
  - [ ] Config parser redacts API key in errors/loggable output.
  - [ ] Unit tests cover plugin config override, env fallback, and defaults.

  **QA Scenarios**:
  ```
  Scenario: Env fallback works
    Tool: Bash
    Steps: Run config tests with TDAI_GATEWAY_API_KEY="abc123" and no explicit apiKey.
    Expected: Parsed config uses abc123 internally and redacted output shows no raw token.
    Evidence: .omo/evidence/task-4-env-fallback.txt

  Scenario: Empty API key rejected
    Tool: Bash
    Steps: Run config test with apiKey="   ".
    Expected: Parser throws a configuration error and no Gateway client is created.
    Evidence: .omo/evidence/task-4-empty-key.txt
  ```

  **Commit**: YES | Message: `feat(opencode): add memory plugin config schema` | Files: [new config module and tests]

- [x] 5. Define session key, capture minimization, and redaction policy

  **What to do**: Implement or document shared policy helpers used by hooks: session key format, capture inclusion/exclusion, redaction, content size limits, and idempotency. Default session key format: `opencode:${workspaceHash}:${projectHash}:${sessionId}:${userHashOrLocal}`. Hash filesystem/user identifiers before sending to Gateway. Default capture: user text and final assistant text only; exclude system prompts, permission prompts, shell env, full tool output, binary content, and messages above configured max chars unless summarized by the host.
  **Must NOT do**: Do not capture secrets or raw shell environment. Do not use absolute workspace path as raw session key.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - Reason: Security-sensitive policy and cross-session correctness.
  - Skills: []
  - Omitted: [`frontend-ui-ux`] - No UI.

  **Parallelization**: Can Parallel: YES | Wave 1 | Blocks: T9, T10, T13, T18 | Blocked By: none

  **References**:
  - Pattern: `src/core/tdai-core.ts:286-364` - existing tool/session semantics.
  - Pattern: `hermes-plugin/memory/memory_tencentdb/__init__.py:368-1130` - existing provider lifecycle and capture/prefetch flow.
  - API/Type: `src/gateway/types.ts:1-143` - Gateway payload fields.
  - Pattern: `README.md` Gateway Security section - Bearer token and protected routes behavior.

  **Acceptance Criteria**:
  - [ ] Tests prove two different workspace/project values produce different session keys.
  - [ ] Tests prove repeated same turn uses the same idempotency key and is not sent twice by hook code.
  - [ ] Tests prove redaction removes API-key-like strings and shell env patterns.
  - [ ] Capture policy docs list included and excluded content categories.

  **QA Scenarios**:
  ```
  Scenario: Cross-project isolation
    Tool: Bash
    Steps: Run session policy tests with workspace A/project A and workspace B/project B.
    Expected: session_key values differ and contain no raw absolute paths.
    Evidence: .omo/evidence/task-5-session-isolation.txt

  Scenario: Secret redaction
    Tool: Bash
    Steps: Run redaction test with content containing "TDAI_GATEWAY_API_KEY=secret" and "Authorization: Bearer secret".
    Expected: Captured payload replaces secret values with [REDACTED].
    Evidence: .omo/evidence/task-5-redaction.txt
  ```

  **Commit**: YES | Message: `feat(opencode): add session and capture policy` | Files: [policy helper module and tests/docs]

- [x] 6. Implement typed Gateway HTTP client

  **What to do**: Implement the TypeScript Gateway client to satisfy Task 2 contracts. Methods: `health()`, `recall({ query, session_key })`, `capture({ user_content, assistant_content, session_key })`, `searchMemories({ query, limit, type, scene })`, `searchConversations({ query, limit, session_key })`, `endSession({ session_key })`. Apply normalized base URL, Bearer auth for protected endpoints, configurable timeout via `AbortController`, redacted errors, and no automatic retry for write endpoints. Allow at most one configurable retry for idempotent search/health if implemented; default no retry.
  **Must NOT do**: Do not import Gateway server internals. Do not call `/seed` in v1 plugin runtime.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - Reason: Core network boundary and error model.
  - Skills: []
  - Omitted: [`playwright`] - HTTP client only.

  **Parallelization**: Can Parallel: NO | Wave 2 | Blocks: T8, T9, T10, T12, T13, T16 | Blocked By: T2, T4

  **References**:
  - API/Type: `src/gateway/types.ts:1-143` - DTO definitions.
  - Pattern: `src/gateway/server.ts:1-260` - route implementation.
  - Pattern: `hermes-plugin/memory/memory_tencentdb/client.py:1-196` - mature Python Gateway client behavior.
  - Pattern: `docker/standalone/README.md` - standalone Gateway defaults and auth.

  **Acceptance Criteria**:
  - [ ] All Task 2 contract tests pass.
  - [ ] Protected endpoints include Bearer auth; `/health` does not require auth.
  - [ ] Timeout produces a typed degraded error without exposing token.
  - [ ] URL normalization works for `http://127.0.0.1:8420` and `http://127.0.0.1:8420/`.

  **QA Scenarios**:
  ```
  Scenario: Full mock endpoint matrix
    Tool: Bash
    Steps: Run npm test for Gateway client tests.
    Expected: All endpoint, auth, timeout, and error-shape tests pass.
    Evidence: .omo/evidence/task-6-client-contract.txt

  Scenario: Non-JSON Gateway response
    Tool: Bash
    Steps: Run test where mock /recall returns 500 text/plain "oops".
    Expected: Client returns/throws redacted typed Gateway error and caller can degrade.
    Evidence: .omo/evidence/task-6-non-json.txt
  ```

  **Commit**: YES | Message: `feat(opencode): implement memory gateway client` | Files: [Gateway client module and tests]

- [x] 7. Add OpenCode host adapter skeleton

  **What to do**: Add `src/adapters/opencode/` with small adapter interfaces that isolate OpenCode runtime objects from memory logic: config extraction, workspace/project/session identity, logging, event subscription, tool registration, lifecycle dispose, and optional context injection capability. Keep adapter thin; reusable memory logic must not import OpenCode directly outside the server entry/adapter layer.
  **Must NOT do**: Do not duplicate OpenClaw `OpenClawHostAdapter` wholesale. Do not introduce Python/Hermes dependencies.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - Reason: Defines clean architecture seam.
  - Skills: []
  - Omitted: [`playwright`] - No UI.

  **Parallelization**: Can Parallel: YES | Wave 2 | Blocks: T9, T10, T11, T13 | Blocked By: T1

  **References**:
  - Pattern: `src/adapters/openclaw/host-adapter.ts:1-117` - existing host adapter boundary to emulate conceptually.
  - Pattern: `src/adapters/index.ts:1-19` - adapter barrel export style.
  - External: `https://github.com/anomalyco/opencode/blob/b956e9a06f2bf4e3a6ff026d0566c362f57a76b7/packages/plugin/src/index.ts#L222-L334` - OpenCode plugin hook types.
  - Pattern: `src/core/tdai-core.ts:420-534` - core wiring boundaries.

  **Acceptance Criteria**:
  - [ ] New adapter layer compiles without importing Gateway server internals.
  - [ ] Unit tests can instantiate adapter with fake OpenCode runtime objects.
  - [ ] Adapter exposes a clear boolean/capability for pre-model recall injection support.
  - [ ] Barrel exports do not break existing OpenClaw adapter imports.

  **QA Scenarios**:
  ```
  Scenario: Fake runtime adapter instantiates
    Tool: Bash
    Steps: Run adapter unit test with fake logger/session/workspace values.
    Expected: Adapter returns normalized identity values and capability flags.
    Evidence: .omo/evidence/task-7-fake-adapter.txt

  Scenario: Existing adapter exports unaffected
    Tool: Bash
    Steps: Run npm run build after adding opencode adapter barrel exports.
    Expected: Build succeeds and OpenClaw imports still resolve.
    Evidence: .omo/evidence/task-7-build.txt
  ```

  **Commit**: YES | Message: `feat(opencode): add host adapter skeleton` | Files: [`src/adapters/opencode/**`, `src/adapters/index.ts`]

- [x] 8. Add TDD tests for OpenCode recall and search tools

  **What to do**: Create tests for three OpenCode custom tools before final implementation: `tdai_memory_recall` calls `/recall` with current scoped `session_key`; `tdai_memory_search` calls `/search/memories`; `tdai_conversation_search` calls `/search/conversations`. Use `tool()` schema expectations where feasible. Test successful formatting, empty results, Gateway degraded error, invalid query, limit default, recall fallback semantics, and token redaction.
  **Must NOT do**: Do not add seed/admin/debug tools. Do not expose raw JSON dumps unless wrapped in readable output.

  **Recommended Agent Profile**:
  - Category: `quick` - Reason: Focused tool contract tests.
  - Skills: []
  - Omitted: [`frontend-ui-ux`] - No UI.

  **Parallelization**: Can Parallel: YES | Wave 2 | Blocks: T12 | Blocked By: T6

  **References**:
  - Pattern: `src/core/tools/memory-search.ts:1-220` - existing L1 search tool output behavior.
  - Pattern: `src/core/tools/conversation-search.ts:1-220` - existing L0 search tool output behavior.
  - External: `https://github.com/anomalyco/opencode/blob/b956e9a06f2bf4e3a6ff026d0566c362f57a76b7/packages/web/src/content/docs/plugins.mdx#L278-L313` - OpenCode custom tool docs.
  - External: `https://github.com/anomalyco/opencode/blob/b956e9a06f2bf4e3a6ff026d0566c362f57a76b7/packages/plugin/src/tool.ts#L45-L54` - `tool()` contract.

  **Acceptance Criteria**:
  - [ ] Tests assert exactly three tools are registered for v1.
  - [ ] `tdai_memory_recall` sends expected query/session_key payload to `/recall` and formats bounded source-marked recall output.
  - [ ] `tdai_memory_search` sends expected query/limit payload to `/search/memories`.
  - [ ] `tdai_conversation_search` sends expected query/session_key payload to `/search/conversations`.
  - [ ] Empty results return a concise no-results message, not an error.

  **QA Scenarios**:
  ```
  Scenario: Memory recall tool happy path
    Tool: Bash
    Steps: Run tool test with query "docker gateway auth" and mock /recall results.
    Expected: Output includes bounded source-marked recall content and calls /recall once with scoped session_key.
    Evidence: .omo/evidence/task-8-recall-tool.txt

  Scenario: Memory search tool happy path
    Tool: Bash
    Steps: Run tool test with query "index optimization" and mock memory results.
    Expected: Output includes readable memory id/source/score/snippet and calls /search/memories once.
    Evidence: .omo/evidence/task-8-memory-tool.txt

  Scenario: Conversation search tool Gateway error
    Tool: Bash
    Steps: Run tool test where mock Gateway returns 503.
    Expected: Tool returns degraded message without throwing uncaught error or leaking token.
    Evidence: .omo/evidence/task-8-conversation-error.txt
  ```

  **Commit**: YES | Message: `test(opencode): add memory recall and search tool contracts` | Files: [new tool test file]

- [x] 9. Add TDD tests for recall lifecycle and fallback

  **What to do**: Create tests that define how recall runs in OpenCode. If Task 1 proves a pre-model context hook exists, tests assert recall output is injected as a bounded, source-marked memory context block before the model call. If not, tests assert automatic injection is disabled and recall remains available through the explicit `tdai_memory_recall` tool only; no unsupported mutation is attempted. Always cover empty recall, long recall truncation, timeout degradation, and workspace/session scoped query.
  **Must NOT do**: Do not block user messages on recall failure. Do not overwrite user input.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - Reason: High-risk lifecycle behavior depends on OpenCode API constraints.
  - Skills: []
  - Omitted: [`playwright`] - No UI.

  **Parallelization**: Can Parallel: YES | Wave 2 | Blocks: T13 | Blocked By: T1, T5, T6, T7

  **References**:
  - External: `https://github.com/anomalyco/opencode/blob/b956e9a06f2bf4e3a6ff026d0566c362f57a76b7/packages/plugin/src/index.ts#L222-L334` - hook/event API surface.
  - Pattern: `hermes-plugin/memory/memory_tencentdb/__init__.py:368-1130` - Hermes prefetch/recall lifecycle inspiration.
  - API/Type: `src/gateway/types.ts:1-143` - `/recall` response contract.
  - Pattern: `README.md` - layered recall and memory behavior overview.

  **Acceptance Criteria**:
  - [ ] Tests encode one verified automatic recall path only: supported injection hook OR disabled automatic injection with explicit `tdai_memory_recall` fallback.
  - [ ] Recall context is bounded by `recall.maxTotalChars` and source-marked.
  - [ ] Timeout/5xx returns degraded warning and continues conversation.
  - [ ] Empty recall injects nothing and does not add noise.

  **QA Scenarios**:
  ```
  Scenario: Recall happy path
    Tool: Bash
    Steps: Run recall lifecycle test with two mock memories for session_key S.
    Expected: Supported path produces bounded memory context or explicit recall tool output with source markers.
    Evidence: .omo/evidence/task-9-recall-happy.txt

  Scenario: Recall timeout degradation
    Tool: Bash
    Steps: Run recall test where /recall never responds until timeout.
    Expected: Main flow continues and records one degraded warning.
    Evidence: .omo/evidence/task-9-recall-timeout.txt
  ```

  **Commit**: YES | Message: `test(opencode): add recall lifecycle contracts` | Files: [recall lifecycle test file]

- [x] 10. Add TDD tests for capture and session-end lifecycle

  **What to do**: Create tests for user/assistant final-turn capture and session-end flush. Simulate OpenCode events/hook calls with fake adapter events. Assert capture sends one `/capture` per final turn with redacted/minimized content, deterministic idempotency key, and scoped session_key. Assert `dispose`/session end calls `/session/end` once and failures only warn.
  **Must NOT do**: Do not capture streaming chunks multiple times. Do not capture system prompt, shell env, permission ask text, or full tool logs.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - Reason: Lifecycle idempotency and privacy are critical.
  - Skills: []
  - Omitted: [`playwright`] - No UI.

  **Parallelization**: Can Parallel: YES | Wave 2 | Blocks: T13 | Blocked By: T1, T5, T6, T7

  **References**:
  - Pattern: `index.ts:341-516` - existing OpenClaw hooks and runtime registration style.
  - Pattern: `hermes-plugin/memory/memory_tencentdb/__init__.py:368-1130` - Hermes sync_turn/shutdown lifecycle.
  - Pattern: `src/core/tdai-core.ts:286-364` - session_end semantics.
  - API/Type: `src/gateway/types.ts:1-143` - `/capture` and `/session/end` payload contracts.

  **Acceptance Criteria**:
  - [ ] Simulated final user/assistant turn sends exactly one `/capture` request.
  - [ ] Replayed same event does not send duplicate capture.
  - [ ] `dispose`/session-end sends exactly one `/session/end` request per session key.
  - [ ] Session-end failure logs warning and does not fail process exit.

  **QA Scenarios**:
  ```
  Scenario: Final turn capture once
    Tool: Bash
    Steps: Run capture lifecycle test with duplicate final assistant event.
    Expected: Mock Gateway receives one /capture request with redacted user_content and assistant_content.
    Evidence: .omo/evidence/task-10-capture-once.txt

  Scenario: Session end warning only
    Tool: Bash
    Steps: Run session-end test where /session/end returns 500.
    Expected: Plugin records warning and test process exits successfully.
    Evidence: .omo/evidence/task-10-session-end-warning.txt
  ```

  **Commit**: YES | Message: `test(opencode): add capture lifecycle contracts` | Files: [capture/session lifecycle test file]

- [x] 11. Implement OpenCode server plugin entry wiring

  **What to do**: Implement the npm `./server` entry that exports the OpenCode plugin function(s). On initialization, parse config, validate API key, instantiate Gateway client, run non-blocking or bounded `/health` check, create OpenCode adapter, register lifecycle hooks/events, and register tools only when `tools.enabled` is true. Keep all OpenCode-specific imports in this server/adapter layer.
  **Must NOT do**: Do not block indefinitely on health check. Do not start Docker or Gateway. Do not register extra admin tools.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - Reason: Main integration entry and plugin lifecycle.
  - Skills: []
  - Omitted: [`playwright`] - No browser UI.

  **Parallelization**: Can Parallel: NO | Wave 3 | Blocks: T14, T16, T17 | Blocked By: T1, T3, T4, T7

  **References**:
  - External: `https://github.com/anomalyco/opencode/blob/b956e9a06f2bf4e3a6ff026d0566c362f57a76b7/packages/opencode/src/plugin/shared.ts#L103-L114` - server entry resolution.
  - External: `https://github.com/anomalyco/opencode/blob/b956e9a06f2bf4e3a6ff026d0566c362f57a76b7/packages/plugin/src/index.ts#L222-L334` - plugin lifecycle hooks.
  - Pattern: `index.ts:131-236` - existing OpenClaw initialization/registration pattern.
  - Pattern: `package.json:1-126` - package metadata and scripts to preserve.

  **Acceptance Criteria**:
  - [ ] `./server` entry can be imported from built package output.
  - [ ] Missing API key fails plugin initialization before protected network calls.
  - [ ] Health check timeout produces degraded warning, not indefinite hang.
  - [ ] `npm run build` succeeds.

  **QA Scenarios**:
  ```
  Scenario: Server entry imports
    Tool: Bash
    Steps: Run npm run build, then use node/bun to import the built ./server export.
    Expected: Import returns plugin function/module without side effects requiring Gateway.
    Evidence: .omo/evidence/task-11-server-import.txt

  Scenario: Missing API key fail-fast
    Tool: Bash
    Steps: Run initialization test with no apiKey and no TDAI_GATEWAY_API_KEY.
    Expected: Initialization fails with redacted config error and zero protected mock requests.
    Evidence: .omo/evidence/task-11-missing-key.txt
  ```

  **Commit**: YES | Message: `feat(opencode): add memory plugin server entry` | Files: [server entry, package/build config]

- [x] 12. Implement OpenCode recall and search tools

  **What to do**: Implement `tdai_memory_recall`, `tdai_memory_search`, and `tdai_conversation_search` using OpenCode `tool()` helper and the Gateway client. `tdai_memory_recall` arguments: `query` required string, `maxResults` optional, always uses current scoped `session_key`, calls `/recall`, and formats bounded source-marked recall content. `tdai_memory_search` arguments: `query` required string, `limit` optional positive integer, calls `/search/memories`. `tdai_conversation_search` arguments: `query` required string, `limit` optional positive integer, optional `session_key` override only if safe and documented; otherwise current scoped session. Format results with title/id/source/score/snippet and clear empty/degraded messages.
  **Must NOT do**: Do not register seed/delete/update/debug/admin tools. Do not allow tools to bypass scoped session defaults silently.

  **Recommended Agent Profile**:
  - Category: `quick` - Reason: Two focused tool implementations after tests exist.
  - Skills: []
  - Omitted: [`playwright`] - No UI.

  **Parallelization**: Can Parallel: YES | Wave 3 | Blocks: T16 | Blocked By: T6, T8

  **References**:
  - Pattern: `src/core/tools/memory-search.ts:1-220` - memory search formatting semantics.
  - Pattern: `src/core/tools/conversation-search.ts:1-220` - conversation search formatting semantics.
  - Pattern: `hermes-plugin/memory/memory_tencentdb/__init__.py:368-1130` - Hermes tool schema naming and handling.
  - External: `https://github.com/anomalyco/opencode/blob/b956e9a06f2bf4e3a6ff026d0566c362f57a76b7/packages/plugin/src/tool.ts#L45-L54` - `tool()` helper.

  **Acceptance Criteria**:
  - [ ] Task 8 tests pass.
  - [ ] Exactly three v1 tools are exported/registered when tools are enabled: `tdai_memory_recall`, `tdai_memory_search`, `tdai_conversation_search`.
  - [ ] `tdai_memory_recall` calls `/recall` and is the explicit fallback when automatic recall injection is unsupported.
  - [ ] Tool output is human-readable and bounded.
  - [ ] Gateway error paths return degraded messages without uncaught exceptions.

  **QA Scenarios**:
  ```
  Scenario: Memory recall returns formatted memories
    Tool: Bash
    Steps: Run tool tests with mock /recall returning two records.
    Expected: Output contains bounded source-marked recall content and no raw token.
    Evidence: .omo/evidence/task-12-recall-tool-pass.txt

  Scenario: No admin tools registered
    Tool: Bash
    Steps: Run a test that enumerates registered tool names.
    Expected: Only tdai_memory_recall, tdai_memory_search, and tdai_conversation_search are present for this plugin.
    Evidence: .omo/evidence/task-12-tool-count.txt
  ```

  **Commit**: YES | Message: `feat(opencode): register memory recall and search tools` | Files: [tool implementation modules]

- [x] 13. Implement recall, capture, and session-end lifecycle

  **What to do**: Implement the lifecycle behavior defined by Tasks 9 and 10. Recall: use verified OpenCode hook for bounded source-marked injection if available; otherwise disable automatic injection and rely on explicit `tdai_memory_recall` fallback. Capture: send one minimized/redacted `/capture` for final user+assistant turn. Session end: call `/session/end` once per session key on dispose/session close. Apply timeout, non-blocking degraded behavior, idempotency, and redacted logging.
  **Must NOT do**: Do not capture streaming chunks multiple times. Do not send system prompts, secrets, shell env, huge raw tool output, or binary data.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - Reason: Core lifecycle behavior, privacy, idempotency.
  - Skills: []
  - Omitted: [`playwright`] - No UI.

  **Parallelization**: Can Parallel: NO | Wave 3 | Blocks: T16, T18 | Blocked By: T5, T6, T7, T9, T10

  **References**:
  - Pattern: `index.ts:341-516` - existing OpenClaw hook registration style.
  - Pattern: `hermes-plugin/memory/memory_tencentdb/__init__.py:368-1130` - Hermes initialize/prefetch/sync_turn/shutdown lifecycle.
  - Pattern: `src/core/tdai-core.ts:286-364` - tool/session_end semantics.
  - API/Type: `src/gateway/types.ts:1-143` - payload contract.

  **Acceptance Criteria**:
  - [ ] Task 9 and Task 10 tests pass.
  - [ ] Recall fallback behavior matches Task 1 compatibility finding.
  - [ ] Capture sends one redacted/minimized request per final turn.
  - [ ] Session end sends once and degrades on failure.

  **QA Scenarios**:
  ```
  Scenario: Capture and recall closed loop with mock Gateway
    Tool: Bash
    Steps: Run lifecycle tests that simulate a user/assistant turn then next recall.
    Expected: /capture receives redacted final turn; /recall receives same scoped session_key.
    Evidence: .omo/evidence/task-13-mock-loop.txt

  Scenario: Duplicate streaming chunks ignored
    Tool: Bash
    Steps: Run lifecycle test with three assistant chunks and one final event.
    Expected: /capture called once using final assistant content only.
    Evidence: .omo/evidence/task-13-stream-dedupe.txt
  ```

  **Commit**: YES | Message: `feat(opencode): add memory lifecycle hooks` | Files: [lifecycle modules, adapter wiring]

- [x] 14. Wire local `.opencode/plugins` development and npm plugin loading validation

  **What to do**: Provide a reproducible local dev loading path and npm loading path. For local dev, add documentation or script that links/builds the server entry for `.opencode/plugins` without committing user-machine absolute paths. For npm path, provide `opencode.json` plugin config snippet using package name and required config/env. Validate both paths with import/load smoke commands where possible.
  **Must NOT do**: Do not write machine-specific absolute paths into tracked config. Do not require global OpenCode config mutation for tests.

  **Recommended Agent Profile**:
  - Category: `writing` - Reason: Mostly reproducible setup docs/scripts with small validation.
  - Skills: []
  - Omitted: [`playwright`] - No browser UI.

  **Parallelization**: Can Parallel: YES | Wave 3 | Blocks: T16, T17 | Blocked By: T3, T11

  **References**:
  - External: `https://github.com/anomalyco/opencode/blob/b956e9a06f2bf4e3a6ff026d0566c362f57a76b7/packages/web/src/content/docs/plugins.mdx#L18-L63` - local plugin directory rules.
  - External: `https://github.com/anomalyco/opencode/blob/b956e9a06f2bf4e3a6ff026d0566c362f57a76b7/packages/web/src/content/docs/config.mdx#L753-L763` - npm plugin config.
  - Pattern: `scripts/install_hermes_memory_tencentdb.sh:1-368` - existing install/linking script ideas; do not copy supervisor behavior.
  - Pattern: `docker/standalone/README.md` - Gateway env and startup preconditions.

  **Acceptance Criteria**:
  - [ ] Docs include local `.opencode/plugins` validation steps without absolute paths.
  - [ ] Docs include npm `opencode.json` snippet with `gatewayUrl` and API key env/config.
  - [ ] `npm pack --dry-run` confirms package contains the server entry and setup docs.
  - [ ] Validation command imports/loads server entry without requiring Gateway to be running.

  **QA Scenarios**:
  ```
  Scenario: Local plugin docs are path-safe
    Tool: Bash
    Steps: Grep new docs for "D:\\" and raw user home paths.
    Expected: No machine-specific absolute path appears in tracked docs except quoted user request context if needed.
    Evidence: .omo/evidence/task-14-path-safe-docs.txt

  Scenario: npm plugin config snippet contains required auth
    Tool: Bash
    Steps: Grep docs for TDAI_GATEWAY_API_KEY and gatewayUrl.
    Expected: Both are present and snippet states API key is required.
    Evidence: .omo/evidence/task-14-config-snippet.txt
  ```

  **Commit**: YES | Message: `docs(opencode): add plugin loading setup` | Files: [OpenCode setup docs/scripts]

- [x] 15. Add user-facing configuration and troubleshooting documentation

  **What to do**: Write concise docs for OpenCode plugin usage: prerequisites, independent Gateway requirement, env vars, `opencode.json` config, mandatory API key, health check, tools, recall/capture behavior, degraded mode, privacy/redaction defaults, what is out of scope, and how to run tests/smoke. Include a compatibility table referencing OpenCode API version verified in Task 1.
  **Must NOT do**: Do not instruct users to run Gateway without API key. Do not document short-term offload as implemented.

  **Recommended Agent Profile**:
  - Category: `writing` - Reason: Technical docs with security caveats.
  - Skills: []
  - Omitted: [`frontend-ui-ux`] - No UI design.

  **Parallelization**: Can Parallel: YES | Wave 3 | Blocks: T19 | Blocked By: T4

  **References**:
  - Pattern: `README.md` - project overview, OpenClaw/Hermes quick start, Gateway security wording.
  - Pattern: `docker/standalone/README.md` - standalone service startup and envs.
  - Pattern: `hermes-plugin/memory/memory_tencentdb/README.md` - existing plugin-side Gateway client docs.
  - Pattern: `src/cli/README.md` - existing documentation style for operational commands.

  **Acceptance Criteria**:
  - [ ] Docs state Gateway must already be running and plugin will not manage Docker.
  - [ ] Docs state API key is mandatory for OpenCode plugin protected calls.
  - [ ] Docs list exactly three tools (`tdai_memory_recall`, `tdai_memory_search`, `tdai_conversation_search`) and no admin tools for v1.
  - [ ] Docs include command examples for build/test/smoke.

  **QA Scenarios**:
  ```
  Scenario: Scope guardrails visible
    Tool: Bash
    Steps: Grep docs for "does not start Gateway", "short-term", and "API key".
    Expected: Docs explicitly describe no Gateway management, offload not in v1, and mandatory API key.
    Evidence: .omo/evidence/task-15-guardrails.txt

  Scenario: Test commands documented
    Tool: Bash
    Steps: Grep docs for npm run build, npm test, and smoke/e2e command name.
    Expected: All commands are documented.
    Evidence: .omo/evidence/task-15-test-docs.txt
  ```

  **Commit**: YES | Message: `docs(opencode): document memory plugin configuration` | Files: [OpenCode plugin docs]

- [x] 16. Add real independent Gateway smoke/e2e test

  **What to do**: Add an opt-in smoke/e2e command that targets the already deployed independent Gateway at `http://127.0.0.1:8420`. It must require `TDAI_GATEWAY_API_KEY`, run `GET /health`, then execute a minimal authenticated loop: capture fixed test content, recall or search by a unique query, and call `/session/end`. In default CI mode it may skip with a clear message if the Gateway is unavailable or env is missing; for final acceptance mode it must fail unless the real Gateway loop passes.
  **Must NOT do**: Do not mutate docker files. Do not start, stop, or restart containers. Do not rely on production user data for assertions.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - Reason: Real service integration with safe opt-in behavior.
  - Skills: []
  - Omitted: [`playwright`] - No browser UI.

  **Parallelization**: Can Parallel: NO | Wave 4 | Blocks: T19 | Blocked By: T2, T6, T11, T12, T13, T14

  **References**:
  - Pattern: `docker/standalone/docker-compose.yml` - service port and healthcheck deployment assumptions.
  - Pattern: `docker/standalone/README.md` - standalone Gateway run/verify instructions.
  - Pattern: `src/gateway/server.ts:1-260` - health and endpoint route implementation.
  - Test: `hermes-plugin/memory/memory_tencentdb/tests/test_gateway_shutdown_leak.py` - existing real Gateway opt-in style via env.

  **Acceptance Criteria**:
  - [ ] Smoke command skips in default CI mode unless `TDAI_GATEWAY_API_KEY` is present and Gateway health is reachable.
  - [ ] Smoke command has a final-acceptance mode that fails if `TDAI_GATEWAY_API_KEY` or Gateway health is missing.
  - [ ] Smoke command sends Bearer auth to all protected endpoints.
  - [ ] Smoke command uses unique test session/query values and ends the session.
  - [ ] Smoke evidence includes health status and endpoint pass/fail summary, not raw token.

  **QA Scenarios**:
  ```
  Scenario: Gateway unavailable skip
    Tool: Bash
    Steps: Run smoke command with TDAI_GATEWAY_API_KEY set but Gateway unreachable.
    Expected: Default CI-mode command exits with documented skip/degraded status, no Docker management attempted.
    Evidence: .omo/evidence/task-16-gateway-skip.txt

  Scenario: Real Gateway authenticated loop
    Tool: Bash
    Steps: With deployed Gateway running and TDAI_GATEWAY_API_KEY set, run smoke command.
    Expected: In final-acceptance mode, /health succeeds; /capture, /recall or /search/*, and /session/end succeed with redacted output.
    Evidence: .omo/evidence/task-16-real-gateway-loop.txt
  ```

  **Commit**: YES | Message: `test(opencode): add gateway smoke e2e` | Files: [smoke test script/config/docs]

- [x] 17. Integrate build, test, pack, and CI-safe commands

  **What to do**: Add or update npm scripts for OpenCode plugin verification without breaking existing scripts. Required commands: `npm run build`, `npm test`, an OpenCode-specific test filter if helpful, `npm pack --dry-run`, and opt-in smoke/e2e command. If adding CI workflow changes, keep real Gateway smoke opt-in only and do not require secrets for normal PR CI.
  **Must NOT do**: Do not make CI depend on local docker service. Do not remove existing package size/manifest checks.

  **Recommended Agent Profile**:
  - Category: `quick` - Reason: Script wiring and command verification.
  - Skills: []
  - Omitted: [`git-master`] - No commit unless requested.

  **Parallelization**: Can Parallel: YES | Wave 4 | Blocks: T19 | Blocked By: T3, T11, T14

  **References**:
  - Pattern: `package.json:1-126` - existing npm scripts.
  - Pattern: `.github/workflows/pr-ci.yml` - current PR CI install/pack/manifest/package-size checks.
  - Test: `vitest.config.ts` - unit test command target.
  - Pattern: `tsdown.config.ts:1-35` - build entry config.

  **Acceptance Criteria**:
  - [ ] `npm run build` succeeds.
  - [ ] `npm test` succeeds.
  - [ ] `npm pack --dry-run` succeeds and includes OpenCode server entry.
  - [ ] Real Gateway smoke is opt-in and skipped by default CI.

  **QA Scenarios**:
  ```
  Scenario: Standard verification commands pass
    Tool: Bash
    Steps: Run npm run build; npm test; npm pack --dry-run.
    Expected: All commands exit 0.
    Evidence: .omo/evidence/task-17-standard-commands.txt

  Scenario: CI does not require Gateway secret
    Tool: Bash
    Steps: Inspect CI workflow or run default test command without TDAI_GATEWAY_API_KEY.
    Expected: Unit/build checks pass or smoke tests skip; no secret required.
    Evidence: .omo/evidence/task-17-ci-no-secret.txt
  ```

  **Commit**: YES | Message: `chore(opencode): wire verification commands` | Files: [`package.json`, optional CI/test config]

- [x] 18. Harden security, errors, and degraded-mode behavior

  **What to do**: Review and harden all OpenCode Memory plugin code for security and failure modes. Ensure token redaction, no secret/system/env capture, bounded content, timeout defaults, no write retries, idempotency, safe logging, empty recall behavior, 401/403 behavior, 429/5xx behavior, malformed JSON behavior, and config precedence. Add focused tests for any missed edge case.
  **Must NOT do**: Do not add blocking behavior for transient Gateway errors after startup config validation. Do not log raw request/response bodies if they can contain user secrets.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - Reason: Security and reliability review with code/test adjustments.
  - Skills: []
  - Omitted: [`playwright`] - No UI.

  **Parallelization**: Can Parallel: YES | Wave 4 | Blocks: T19 | Blocked By: T4, T5, T13

  **References**:
  - Pattern: `README.md` Gateway Security section - protected route semantics.
  - Pattern: `src/gateway/server.ts:1-260` - auth/health route behavior.
  - Pattern: `src/gateway/config.ts:1-260` - Gateway env naming and defaults.
  - Pattern: `docker/standalone/.env.example` - required secret names.

  **Acceptance Criteria**:
  - [ ] Tests cover empty API key, wrong token/401, timeout, 500, non-JSON, large recall, secret redaction, duplicate capture.
  - [ ] No test snapshot/evidence contains raw API key.
  - [ ] Gateway down does not block normal OpenCode flow after initialization.
  - [ ] Missing API key fails fast and clearly.

  **QA Scenarios**:
  ```
  Scenario: Token never appears in output
    Tool: Bash
    Steps: Run tests with token "super-secret-token" then grep test output/evidence for that string.
    Expected: No raw token is present.
    Evidence: .omo/evidence/task-18-token-redaction.txt

  Scenario: 401 disables memory safely
    Tool: Bash
    Steps: Run mock Gateway test returning 401 for /capture and /recall.
    Expected: Plugin reports auth failure/degraded memory and continues host flow without infinite retry.
    Evidence: .omo/evidence/task-18-unauthorized.txt
  ```

  **Commit**: YES | Message: `fix(opencode): harden memory plugin failures` | Files: [security/error handling tests and code]

- [x] 19. Run final integration sweep and consolidate evidence

  **What to do**: Execute the full verification stack, gather evidence files, and produce a concise implementation summary for the final reviewers. Required commands: build, unit tests, package dry run, local import/load smoke, docs guardrail grep, and real Gateway smoke in final-acceptance mode. If real Gateway smoke cannot run, stop and request an explicit user waiver before final verification; do not silently skip.
  **Must NOT do**: Do not mark final verification complete without evidence. Do not hide skipped smoke tests. Do not proceed to final verification if final-acceptance Gateway smoke is skipped without explicit user waiver.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - Reason: Cross-cutting integration verification.
  - Skills: []
  - Omitted: [`git-master`] - No git operation unless requested.

  **Parallelization**: Can Parallel: NO | Wave 5 | Blocks: Final Verification | Blocked By: T15, T16, T17, T18

  **References**:
  - Test: `package.json:1-126` - commands to execute.
  - Test: `vitest.config.ts` - unit test config.
  - Pattern: `.github/workflows/pr-ci.yml` - CI package checks to mirror locally.
  - Pattern: `docker/standalone/README.md` - real Gateway smoke prerequisites.

  **Acceptance Criteria**:
  - [ ] Evidence files exist for build, tests, pack dry run, local load/import, docs guardrails, and final-acceptance smoke/e2e pass result.
  - [ ] If smoke/e2e cannot pass because Gateway/env is unavailable, the implementation summary states `USER WAIVER REQUIRED: missing real Gateway smoke` and final verification is not started.
  - [ ] Implementation summary lists changed files, commands run, and any skipped checks.
  - [ ] No unresolved TODO/FIXME remains in OpenCode plugin implementation unless explicitly documented as future work outside v1.
  - [ ] Final Verification Wave can start with all implementation tasks complete.

  **QA Scenarios**:
  ```
  Scenario: Full local verification stack
    Tool: Bash
    Steps: Run npm run build; npm test; npm pack --dry-run; local server entry import smoke.
    Expected: All commands pass and evidence files are written.
    Evidence: .omo/evidence/task-19-full-stack.txt

  Scenario: Future work stays out of v1
    Tool: Bash
    Steps: Grep implementation/docs for offload/compression/admin tool claims.
    Expected: Any mentions are clearly labeled future/out-of-scope; no v1 code registers these features.
    Evidence: .omo/evidence/task-19-scope-grep.txt
  ```

  **Commit**: YES | Message: `chore(opencode): verify memory plugin integration` | Files: [evidence summary/docs if tracked]

## Final Verification Wave (MANDATORY — after ALL implementation tasks)
> 4 review agents run in PARALLEL. ALL must APPROVE. Present consolidated results to user and get explicit "okay" before completing.
> **Do NOT auto-proceed after verification. Wait for user's explicit approval before marking work complete.**
> **Never mark F1-F4 as checked before getting user's okay.** Rejection or user feedback -> fix -> re-run -> present again -> wait for okay.
- [x] F1. Plan Compliance Audit — oracle
- [x] F2. Code Quality Review — unspecified-high
- [x] F3. Real Manual QA — unspecified-high (+ playwright if UI)
- [x] F4. Scope Fidelity Check — deep

## Commit Strategy
- Commit after each wave if the executor is asked to commit; otherwise leave commits to the user.
- Suggested messages:
  - `feat(opencode): add memory gateway client contracts`
  - `feat(opencode): add memory plugin server entry`
  - `test(opencode): add gateway smoke coverage`
  - `docs(opencode): document memory plugin setup`

## Success Criteria
- OpenCode plugin can be loaded through npm `plugin` config and local `.opencode/plugins` path.
- Missing API key fails fast without network calls.
- Valid API key sends Bearer auth to every protected Gateway endpoint.
- Gateway outage does not block normal OpenCode conversation flow after startup validation.
- Recall/search tools return readable memory/conversation results and handle empty/error responses.
- Capture/session-end are idempotent and scoped by workspace/project/session/user.
- Real docker Gateway smoke proves `/health` → `/capture` → `/recall` or `/search/*` → `/session/end` works.
