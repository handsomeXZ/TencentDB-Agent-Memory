# Issues — opencode-tencentdb-memory-plugin

- Task 2 leaves `src/gateway-client/client.contract.test.ts` red by design: `GatewayHttpClient` is only a compile seam pending Task 6, so bearer-auth, missing-key, timeout, non-JSON, 401, 5xx, and URL-normalization contracts fail until the client is implemented.

- Local setup issue observed during verification: plain `npm install` fails on Windows PowerShell/cmd because the package `postinstall` script uses `bash ... || true`, which is shell-specific. `npm install --ignore-scripts` succeeded and allowed tests/build to run.
- Environment issue observed: current Node is `v22.17.0`, while `undici@8.3.0` warns it prefers `>=22.19.0`. This did not block Task 4 verification.
- Task 4 follow-up: sanitized `.omo/evidence/task-4-env-fallback.txt` after orchestrator verification so the evidence preserves env-fallback behavior without printing any raw token sentinel.

## 2026-05-30 - Task 1 OpenCode compatibility limitations
- No local OpenCode package installation was present in `node_modules`, so Task 1 could not pin to an installed package version and instead pins to the official `anomalyco/opencode` source commit `b956e9a06f2bf4e3a6ff026d0566c362f57a76b7`.
- Pre-model automatic recall injection remains unverified against a running OpenCode instance in this task; implementation must keep automatic injection disabled until later runtime validation proves a concrete hook mutation path.

## 2026-05-30 - Task 3 package/build verification notes
- Local verification completed on Node `v22.17.0`; `tsdown` emitted a deprecation warning recommending Node `v22.18.0` or later, but `npm run build` and `npm pack --dry-run` both exited successfully.

## 2026-05-30 - Task 15 documentation validation limitation
- Markdown LSP is not installed in the local OpenCode environment, so this docs task could not use editor diagnostics for `.md` files and instead used manual review plus grep based evidence.

## 2026-05-30 - Task 10 lifecycle contract caveat
- `src/adapters/opencode/lifecycle.ts` is intentionally a minimal contract seam for tests; it is not yet wired into `src/opencode/server.ts` runtime event handling. Task 13 still owns real OpenCode lifecycle event mapping and any host-specific disposal/session-end integration.

## 2026-05-30 - Task 11 server entry limitations
- OpenCode Task 11 registers lifecycle seams as supported v1 hooks (`event`, `config`, and `dispose`) but keeps deep recall/capture/session lifecycle behavior out of scope for Task 13.
- Local verification still runs on Node `v22.17.0`; `tsdown` continues to warn that this Node version is deprecated and recommends `v22.18.0` or later, but build exits successfully.

## 2026-05-30 - Task 12 OpenCode tool helper limitation
- `@opencode-ai/plugin` and its `tool()` helper are still not locally installed in this repository, so Task 12 intentionally preserved the host-neutral `OpenCodeToolDefinition` seam in `src/adapters/opencode/tools.ts` for later server registration work instead of adding a hard package dependency before Task 11 runtime wiring proves availability.

## 2026-05-30 - Task 13 lifecycle event-shape limitations
- OpenCode runtime event payloads are still not verified against a local `@opencode-ai/plugin` package or running OpenCode instance. Task 13 therefore supports only explicit fake event shapes with clear final-turn/session-close fields and ignores incomplete or unknown event types to avoid unsafe capture guesses.
- Dispose can only end the startup/default session known to the server hook; additional sessions are ended exactly once when explicit `session.end`, `session.closed`, or `session.close` events are delivered.

## 2026-05-30 - Task 16 real Gateway loop caveat
- The local Gateway `GET /health` endpoint was reachable during Task 16 verification, but `TDAI_GATEWAY_API_KEY` was missing from the shell environment. The real protected final-acceptance loop remains pending a user-provided API key; secret files such as `docker/standalone/.env.local` were intentionally not inspected.

## 2026-05-30 - Task 18 hardening validation limitation
- Task 18 intentionally used unit-level mocked Gateway/OpenCode surfaces only, per the no-real-Gateway constraint. The remaining limitation is unchanged runtime uncertainty around exact OpenCode event payload shapes until a future task validates against a running OpenCode package.

## 2026-05-30 05:26:13 +08:00 - Task 19 final-acceptance smoke blocker
- `TDAI_GATEWAY_API_KEY` was missing from the current process environment during the final integration sweep. Default smoke verified unauthenticated `/health` and skipped protected routes safely, but strict final-acceptance smoke was not run. Final verification remains blocked until a real Gateway final-acceptance smoke passes with the API key already present or the user explicitly grants a waiver.

## 2026-05-30 - Final Verification Wave blocked
- F1-F4 were marked `[~]` in `.omo/plans/opencode-tencentdb-memory-plugin.md` because the plan explicitly blocks final verification when real Gateway final-acceptance smoke is skipped without explicit user waiver. The missing external input is either `TDAI_GATEWAY_API_KEY` in the current process environment for a strict smoke rerun, or explicit user waiver approval.

## 2026-05-30 - Final Verification Wave awaiting explicit user okay
- F1-F4 reviewers have all returned `VERDICT: APPROVE`, and the real Gateway final-acceptance smoke blocker was resolved by the sanitized rerun evidence. However, the plan text explicitly says to present consolidated results and wait for the user's explicit okay before marking F1-F4 checked. Per the Boulder continuation rule for decision-only blockers, F1-F4 remain marked `[~]` until the user explicitly approves final checkbox completion.
