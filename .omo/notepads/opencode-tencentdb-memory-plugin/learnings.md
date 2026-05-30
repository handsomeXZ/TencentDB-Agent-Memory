# Learnings — opencode-tencentdb-memory-plugin

- Task 2 Gateway client contracts use `src/gateway/types.ts` DTOs as source of truth and cover `GET /health`, `POST /recall`, `POST /capture`, `POST /search/memories`, `POST /search/conversations`, and `POST /session/end` without importing Gateway server internals or calling a real Gateway.
- The TypeScript client seam is intentionally limited to `src/gateway-client/client.ts`; all methods currently throw `GatewayHttpClient implementation pending Task 6` so Task 6 can implement behavior against the red contract tests.
- Contract tests inject a `fetch` mock into `GatewayHttpClientOptions`, assert `/health` sends no `Authorization`, and assert all protected endpoint DTO calls must send `Authorization: Bearer <token>` plus JSON request bodies.
- Task 6 replaced the client seam with a typed HTTP wrapper that normalizes trailing slashes in `baseUrl`, preserves nested base paths, attaches Bearer auth only for protected routes, and uses `AbortController` for timeout handling.
- Task 6 client errors are redacted and typed via `GatewayHttpClientError`, covering config, timeout, non-JSON, HTTP status, and network failure cases without leaking raw API keys.
- Contract verification passed after implementation, and a manual fetch-mock driver confirmed `/health` stays unauthenticated while protected routes use the expected DTO bodies and auth header.

## 2026-05-30 - Task 8 OpenCode recall and search tool TDD contracts
- Added `src/adapters/opencode/tools.test.ts` to lock the v1 OpenCode tool surface to exactly `tdai_memory_recall`, `tdai_memory_search`, and `tdai_conversation_search`, with explicit assertions that seed/delete/update/debug/admin tools are not part of v1.
- Added a minimal local seam at `src/adapters/opencode/tools.ts` that uses a mocked `OpenCodeToolsClient` interface and current scoped `sessionKey`, without touching `src/adapters/opencode/index.ts` or any runtime wiring owned by later tasks.
- Recall contracts now cover trimmed query forwarding to `/recall`, required scoped `session_key`, bounded human-readable output, empty-context fallback, and secret redaction for Bearer tokens and API-key-like values.
- Memory search contracts now cover trimmed query forwarding to `/search/memories`, default limit fallback to `OPEN_CODE_PLUGIN_DEFAULTS.recallMaxResults`, readable formatted output, and clean empty-result behavior.
- Conversation search contracts now cover scoped `/search/conversations` requests plus graceful degraded output on Gateway errors, with sanitized error text that preserves HTTP context but strips token material.
- Targeted verification passed with `npx vitest run src/adapters/opencode/tools.test.ts` (13/13 tests passing).

- Task 4: added a host-neutral OpenCode plugin config parser at `src/adapters/opencode/config.ts` so OpenCode-specific precedence and redaction logic stays isolated from the existing OpenClaw plugin config path.
- Precedence implemented as explicit config over `TDAI_GATEWAY_API_KEY` env fallback over hardcoded defaults, with `apiKey` as the only required no-default field.
- Safe loggable output is provided by `toLoggableOpenCodePluginConfig()` and always replaces the raw `apiKey` with `[redacted]`.

## 2026-05-30 - Task 1 OpenCode plugin API contract
- Pinned OpenCode compatibility to `anomalyco/opencode` commit `b956e9a06f2bf4e3a6ff026d0566c362f57a76b7`, where both `opencode` and `@opencode-ai/plugin` report version `1.15.12`.
- Local install check found no `node_modules/@opencode-ai/plugin`, `node_modules/opencode`, or `node_modules/@opencode-ai/opencode`, so implementation tasks should treat the source commit as the compatibility anchor until a package is added.
- Server npm plugin loading resolves `exports["./server"]` before `main`; current package only exports `.` and tsdown only builds `./index.ts`, so Task 3 must add `./server` while preserving OpenClaw behavior.
- `@opencode-ai/plugin/tool` exposes `tool()` with Zod raw-shape args, a typed `ToolContext`, and string/object tool results. The v1 OpenCode implementation should register only `tdai_memory_recall`, `tdai_memory_search`, and `tdai_conversation_search`.
- Pre-model automatic recall injection is not verified by the pinned sources. Keep automatic injection disabled; use explicit recall/search tools plus only best-effort supported hooks until runtime tests prove a concrete mutation path.

## 2026-05-30 - Task 5 OpenCode session isolation and redaction policy
- Added a host-neutral OpenCode policy helper at `src/adapters/opencode/policy.ts` for deterministic session key generation, capture minimization, secret redaction, and final-turn idempotency keys without importing OpenCode runtime or Gateway server internals.
- Session keys use `opencode:${workspaceHash}:${projectHash}:${sessionId}:${userHashOrLocal}` with workspace/project/user identifiers hashed before they can leave the helper; absent user identity is represented as `local`.
- Capture minimization is explicit: include user text, final assistant text, and host summaries for oversized content only; exclude system prompts, permission prompts, shell env, full tool output, binary content, and unsummarized oversized messages.
- Redaction coverage includes API-key-like values, Bearer authorization headers, `TDAI_GATEWAY_API_KEY`, common `*_API_KEY`, `TOKEN`, and shell env-like secret assignments.

## 2026-05-30 - Task 3 npm server export layout
- Added the npm `./server` export as an OpenCode-only entry pointing exactly to `./dist/opencode/server.js` and `./dist/opencode/server.d.ts`, while preserving `main`, root `.` export, OpenClaw metadata, and `openclaw.plugin.json` compatibility.
- `tsdown.config.ts` now uses two build configs: the existing OpenClaw root entry keeps `fixedExtension: true` and `dts: false` for `dist/index.mjs`, while the OpenCode server entry builds `src/opencode/server.ts` with `fixedExtension: false` and `dts: true` for the required `.js` and `.d.ts` paths.
- `src/opencode/server.ts` is intentionally a safe placeholder default export with a `server()` function returning an empty hooks object; it does not initialize Gateway, parse startup config, register tools, or implement Task 11 runtime behavior.
- `npm pack --dry-run` initially exposed packaged Hermes test files; broad `files` negations now exclude `tests`, `__tests__`, `*.test.*`, and `*.spec.*` from the tarball while keeping the built server entry included.

## 2026-05-30 - Task 7 OpenCode host adapter skeleton
- Added `OpenCodeHostAdapter` as a host-neutral TypeScript seam that accepts fake OpenCode runtime/logger/session/workspace/project/user/config/options values without importing `opencode`, `@opencode-ai/plugin`, Gateway server internals, OpenClaw SDK, or Python/Hermes runtime code.
- OpenCode identity normalization now routes session key creation through `createOpenCodeSessionKey()`, preserving workspace/project/user hashing and using `local` only when no user identity is supplied.
- Adapter capabilities are explicit and conservative: event subscription, tool registration, lifecycle disposal, and optional generic context injection are surfaced as booleans, while `supportsPreModelRecallInjection` remains `false` per Task 1 until a concrete runtime mutation path is verified.

## 2026-05-30 - Task 15 OpenCode user docs
- Added `docs/opencode-memory-plugin.md` as the dedicated OpenCode user facing doc because the repo only had the compatibility contract, not an end user setup and troubleshooting guide.
- The doc explicitly frames OpenCode v1 as long term memory only, with no short term offload or compression, no Docker or Gateway lifecycle management, and exactly three v1 tools: `tdai_memory_recall`, `tdai_memory_search`, and `tdai_conversation_search`.
- The safe config guidance prefers env backed `TDAI_GATEWAY_API_KEY`, documents `gatewayUrl` default `http://127.0.0.1:8420`, and calls out current implementation status honestly: server export plus client/config/policy exist, while full tool and lifecycle wiring are still planned later.
- Markdown LSP is not installed in this environment, so validation for this task relies on manual doc review plus `rg` evidence files for guardrails and documented commands.

## 2026-05-30 - Task 10 OpenCode capture and session-end lifecycle contracts
- Added `src/adapters/opencode/lifecycle.test.ts` to pin OpenCode capture/session-end lifecycle expectations with fake Gateway objects only: final turns send one minimized `/capture`, replayed final events dedupe by deterministic final-turn idempotency, streaming chunks are ignored, and only final assistant text is captured.
- Added a minimal host-neutral seam at `src/adapters/opencode/lifecycle.ts` so Task 13 has a precise contract for mapping fake lifecycle events into `CaptureRequest` and `SessionEndRequest` DTOs without implementing broad runtime wiring.
- Capture lifecycle contracts reuse Task 5 policy helpers for scoped hashed `session_key`, capture minimization, redaction, and final-turn idempotency; the tests assert system prompts, permission prompts, shell env, full tool output, binary content, and unsummarized oversized messages are excluded by default.
- Session-end lifecycle contracts now require exactly one `/session/end` per session key and warning-only degradation on endpoint failure, preserving successful process exit behavior.
- Targeted verification passed with `npm test -- src/adapters/opencode/lifecycle.test.ts` (6/6 tests passing); full `npm test` passed (59/59 tests), and `npm run build` passed with only the known local Node v22.17.0 tsdown deprecation warning.

## 2026-05-30 - Task 11 OpenCode server entry wiring
- Replaced the placeholder `src/opencode/server.ts` with the pinned v1 server plugin module shape: default export is an object with async `server(input, options)` and the built `./server` import has no top-level Gateway side effects.
- Server initialization now uses `parseOpenCodePluginConfig()` before creating clients, so explicit plugin options beat `TDAI_GATEWAY_API_KEY` env fallback and a missing/empty API key fails before any Gateway request.
- Startup health is intentionally fire-and-forget and bounded: `/health` uses a capped timeout, emits sanitized warnings for timeout/unhealthy/degraded responses, and never performs protected unauthenticated requests.
- Tool registration is limited to `getOpenCodeV1ToolNames()` (`tdai_memory_recall`, `tdai_memory_search`, `tdai_conversation_search`) when `tools.enabled` is true, and returns no tool map when disabled.
- Added `src/opencode/server.test.ts` to cover default export shape, missing-key zero-call behavior, explicit config precedence, exact v1 tool surface, disabled tools, degraded health redaction, and abort/ignored-abort timeout behavior.

## 2026-05-30 - Task 9 OpenCode recall lifecycle contracts
- Added `src/adapters/opencode/recall-lifecycle.test.ts` as the focused lifecycle contract layer above the existing OpenCode tool contracts, using fake Gateway clients only.
- The lifecycle contract keeps `OpenCodeHostAdapter.supportsPreModelRecallInjection` false even when a generic `injectContext` seam exists, and asserts no automatic recall call or context mutation occurs before explicit tool invocation.
- Explicit `tdai_memory_recall` remains the v1 fallback path and is tested for current scoped `session_key`, trimmed/validated query input, source-marked bounded context, clean empty recall behavior, and non-blocking timeout/5xx degradation.

## 2026-05-30 - Task 12 OpenCode recall and search tool implementation
- Refined `src/adapters/opencode/tools.ts` in place so the v1 seam still exports exactly `tdai_memory_recall`, `tdai_memory_search`, and `tdai_conversation_search`, with `getOpenCodeV1ToolNames()` remaining the authoritative exact list.
- `tdai_memory_recall` now forwards the trimmed query plus scoped `session_key` to `/recall`, formats human-readable source-marked output, bounds returned text with the configured recall character budget, and degrades gracefully on Gateway failures with redacted messages instead of throwing.
- `tdai_memory_search` now forwards the trimmed query plus safe positive-integer limit fallback to `/search/memories`, bounds readable output with the same recall character budget, and returns sanitized degraded errors on Gateway failures.
- `tdai_conversation_search` continues to require the current scoped `session_key` for `/search/conversations`, now shares the same bounded output formatting path, and preserves degraded redacted Gateway error behavior.
- Tool tests were expanded from 13 to 16 assertions to cover degraded Gateway errors for recall, memory search, and conversation search plus bounded search output, and verification passed with targeted tests, full `npm test`, and `npm run build`.

## 2026-05-30 - Task 14 path-safe OpenCode plugin docs and pack validation
- Updated `docs/opencode-memory-plugin.md` to document both npm tuple loading and project-local `.opencode/plugins` development loading with `<repo-root>` and `<project>` placeholders instead of machine-specific absolute paths.
- The doc now states clearly that the independent Gateway must already be running for real memory traffic, while importing `dist/opencode/server.js` remains safe without a running Gateway because startup health probing is fire-and-forget and non-blocking.
- Added `docs/opencode-memory-plugin.md` and `docs/opencode-plugin-compatibility.md` to the npm `files` allowlist so `npm pack --dry-run` includes both setup docs alongside `dist/opencode/server.js` and `dist/opencode/server.d.ts`.
- Verification passed with `npm run build`, `npm test`, `npm pack --dry-run`, and `node --input-type=module -e "await import('./dist/opencode/server.js'); console.log('import-ok')"` on local Node `v22.17.0`.

## 2026-05-30 - Task 13 OpenCode lifecycle server wiring
- Wired `src/opencode/server.ts` to the existing `createOpenCodeLifecycleController()` seam instead of adding a second lifecycle implementation; `event` now routes supported final assistant-turn events to `/capture` and session-close/end events to `/session/end`.
- Automatic pre-model recall injection remains disabled; `config` stays no-op and explicit `tdai_memory_recall` remains the scoped fallback path, with server tests proving recall and capture share the same hashed OpenCode `session_key` for a session.
- Server lifecycle mapping is intentionally conservative and host-neutral: supported fake event types include `assistant.final`, `assistant.completed`, `assistant.delta`, `message.final`, `turn.completed`, plus `session.end`, `session.closed`, and `session.close`; unsupported or incomplete shapes are ignored rather than guessed.
- Capture/session-end failures now degrade through sanitized warnings and do not throw from normal OpenCode flow after config validation succeeds; duplicate final events and streaming chunks are covered by server-level tests.

## 2026-05-30 - Task 16 independent OpenCode Gateway smoke
- Added `scripts/smoke-opencode-gateway.ts` and wired `npm run smoke:opencode-gateway` as an opt-in smoke command against an already deployed Gateway, defaulting to `http://127.0.0.1:8420` with optional `TDAI_GATEWAY_URL` override.
- The smoke uses the existing `GatewayHttpClient`, runs unauthenticated `GET /health` first, requires `TDAI_GATEWAY_API_KEY` before protected routes, and calls `/capture`, `/recall`, `/search/memories`, and `/session/end` with a unique `opencode-smoke:<timestamp>:<uuid>` session marker.
- Default mode is CI-safe: missing `TDAI_GATEWAY_API_KEY` or unavailable/degraded health prints a clear `SKIP` and exits 0; `--final-acceptance` is strict and fails when the API key or healthy Gateway is unavailable.
- Local verification executed the default missing-env path against a reachable health endpoint and exited 0 before protected calls; full `npm test` and `npm run build` passed.

## 2026-05-30 - Task 18 OpenCode security and degraded-mode hardening
- Broadened OpenCode redaction to cover standalone `Bearer <token>` text in addition to `Authorization: Bearer <token>`, so Gateway errors, warnings, tool outputs, and evidence-producing paths use the same sanitized policy.
- Gateway client contracts now cover whitespace API keys failing before protected requests, 401/403/429/5xx sanitized typed failures, malformed JSON, timeout, non-JSON, and single-call write failures for `/capture` and `/session/end` without retries.
- OpenCode tool/lifecycle/server tests now cover large bounded recall output, sanitized 429/401 degraded tool behavior, sanitized capture/session-end warnings, non-JSON health degradation, duplicate capture idempotency, and no raw `super-secret-token` evidence leakage.

## 2026-05-30 - Task 17 standard commands and CI-safe verification
- The repository already had the required user-facing package commands (`build`, `test`, `smoke:opencode-gateway`) and docs listing the standard validation flow, so Task 17 kept `package.json` unchanged and used a workflow-only additive change.
- Added a dedicated `verify` job in `.github/workflows/pr-ci.yml` so PR CI now explicitly runs `npm run build`, `npm test`, a local `dist/opencode/server.js` import smoke, and the default `npm run smoke:opencode-gateway` path without requiring `TDAI_GATEWAY_API_KEY`.
- Local verification confirmed `npm pack --dry-run` includes `dist/opencode/server.js`, `dist/opencode/server.d.ts`, `docs/opencode-memory-plugin.md`, and `docs/opencode-plugin-compatibility.md`, while the default smoke path performs unauthenticated `GET /health` then exits 0 with `SKIP` before protected routes when the API key is absent.

## 2026-05-30 05:26:13 +08:00 - Task 19 final integration sweep
- Full local stack passed: `npm run build`, `npm test`, `npm pack --dry-run`, built server import smoke, default `npm run smoke:opencode-gateway`, and a protected-request fail-fast driver for missing API key.
- Build and pack confirmed `dist/opencode/server.js` and `dist/opencode/server.d.ts`; pack dry-run also included `docs/opencode-memory-plugin.md`, `docs/opencode-plugin-compatibility.md`, and `scripts/smoke-opencode-gateway.ts`.
- Default Gateway smoke reached unauthenticated `GET /health` at `http://127.0.0.1:8420` with `status=ok`, then skipped before protected routes because the current process environment lacks `TDAI_GATEWAY_API_KEY`.
- Scope greps confirmed the OpenCode v1 runtime tool surface remains exactly `tdai_memory_recall`, `tdai_memory_search`, and `tdai_conversation_search`; no OpenCode-specific TODO/FIXME markers remain.
- Task 19 produced `.omo/evidence/task-19-full-stack.txt`, `.omo/evidence/task-19-scope-grep.txt`, and `.omo/evidence/task-19-implementation-summary.md`; no TypeScript/YAML/plugin functionality files were modified.

## 2026-05-30 - Task 16 final-acceptance recall fallback fix
- Fixed `scripts/smoke-opencode-gateway.ts` so Task 16 final acceptance matches the plan wording: after successful authenticated `/capture`, `/recall` and `/search/memories` are alternatives, not a required sequence where recall failure prevents search.
- If `/recall` times out or fails, the smoke now logs a redacted fallback message and attempts authenticated `/search/memories`; the loop fails only when both recall and search fail, and `/session/end` still runs in `finally`.
- Verified the real Gateway strict smoke by extracting only `TDAI_GATEWAY_API_KEY` from `docker/standalone/.env.local` into process env without printing it; the run passed with `/health`, `/capture`, `/recall`, and `/session/end`.
- Added command-level mock checks because there is no existing unit harness for the standalone smoke script: one mock proves recall timeout falls back to search and exits 0, and another proves recall+search double failure exits 1 while still calling `/session/end` exactly once.

## 2026-05-30 - OpenCode 配置文档中文化整理
- Rewrote `docs/opencode-memory-plugin.md` into a Chinese user-facing OpenCode configuration guide, preserving the pinned compatibility scope, Gateway independence, API key requirements, exact v1 tool scope, smoke usage, and troubleshooting path.
- Removed stale wording that implied the OpenCode implementation was still partial or waiting on later tasks, and replaced it with shipped behavior only.
- During verification, corrected one doc/runtime mismatch: `recall.maxResults` is present in `src/adapters/opencode/config.ts`, but it is not yet wired into the current OpenCode runtime tool default limit path, so the guide now documents it conservatively as a modeled-but-not-yet-runtime-applied field.

## 2026-05-30 - OpenCode headless loopback proxy verification
- OpenCode headless against the root package plugin registered all three tools: `tdai_memory_recall`, `tdai_memory_search`, and `tdai_conversation_search`.
- With inherited proxy variables and no startup `NO_PROXY`/`no_proxy`, Bun/OpenCode loopback fetches to `http://127.0.0.1:8420` returned proxy-originated `502` responses; direct Bun checks reproduced the same behavior.
- Setting `NO_PROXY=127.0.0.1,localhost` and `no_proxy=127.0.0.1,localhost` before launching OpenCode made both `tdai_memory_search` and `tdai_memory_recall` return normal Gateway-backed results, and the headless run answered `PASS`.
- Client runtime mutation of proxy environment variables is not a reliable fix for Bun/OpenCode because proxy handling is initialized too early; the user-facing doc now records the startup environment requirement instead.
