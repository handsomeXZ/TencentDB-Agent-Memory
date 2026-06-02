# Memory Visualizer Mem0-Style Refactor + Requests Monitor

## TL;DR
> **Summary**: Refactor `apps/memory-visualizer` from a monolithic read-only SPA into a Mem0-inspired local observability dashboard, while adding sanitized Requests Monitor telemetry for Gateway and Visualizer traffic. Keep Vite/React + Node API, preserve the read-only memory boundary, and do not copy Mem0's control-plane mutation features.
> **Deliverables**:
> - Extracted dashboard shell, route registry, shared read-only UI primitives, and route pages.
> - Sanitized request telemetry contract, writer/reader/summary logic, and bounded JSONL read/summary behavior.
> - Gateway and Visualizer request telemetry wrappers with fail-open behavior.
> - Read-only `/api/requests`, `/api/requests/summary`, `/visualizer/requests`, `/visualizer/requests/summary` endpoints.
> - `Requests Monitor` UI route with metric cards, compact table, badges, pagination, refresh, empty state, and sanitized detail drawer.
> - Docker/docs/test updates proving telemetry uses a separate writable path and memory data remains read-only.
> **Effort**: Large
> **Parallel**: YES - 4 waves
> **Critical Path**: Task 1/2 → Task 5/3/4 → Task 6/7 → Task 8/9 → Task 10/11 → Task 12 → Final Verification Wave

## Context
### Original Request
- Current visualization service UI/content is not satisfactory.
- Refactor by referencing `D:\ForkWorkSpace\mem0\server`, especially `mem0\server\dashboard`.
- Add Mem0-style Requests monitoring for request type, source, result, latency, and related observability data.
- Plan first; do not implement during analysis/planning.

### Interview Summary
- Keep current visualizer runtime model: Vite/React frontend + Node API sidecar on `8421`.
- Do not migrate to Next.js.
- Borrow Mem0 concepts: fixed dashboard shell, route grouping, metric cards, compact tables, status/method badges, empty states, detail sheets, query hook discipline, design token discipline.
- Final UI direction selected by user: concise Mem0-inspired operations dashboard, prioritizing a fixed sidebar, clean grid, metric row, compact table scanning, restrained badges, and low-motion interactions.
- Preserve current dark parchment/glass visual direction.
- Requests Monitor is an observability surface, not a control surface.
- Read-only boundary applies to memory/session/vector/domain data. Telemetry is separate operational append-only data.

### Metis Review (gaps addressed)
- Telemetry storage must be physically separate from memory data.
- Gateway and Visualizer must write separate JSONL files to avoid multi-process append contention.
- Store pathname only; never raw URL/query/body/response/headers/secrets/content.
- Skip health/static/request-monitor routes by default.
- Telemetry write/read/parse failures must fail open and never break primary requests.
- Missing/corrupt/unwritable telemetry states must have explicit tests.
- Do not add even disabled mutation placeholders.

### Oracle Phase 1
- `VERDICT: GO` received. Oracle confirmed scope, test strategy, privacy boundaries, and architecture decisions are sufficient for plan generation.

## Work Objectives
### Core Objective
Build a safer, clearer, Mem0-inspired local dashboard for TencentDB Agent Memory, with read-only Requests Monitor observability across Gateway and Visualizer requests.

### Deliverables
- `App.tsx` responsibility split into shell, route registry, auth gate, route pages, hooks, and primitives.
- Request telemetry shared contract and sanitizer.
- JSONL writer/reader/summary implementation with deterministic read-window/limit behavior.
- Gateway telemetry wrapper in `src/gateway/server.ts` flow.
- Visualizer telemetry wrapper in `apps/memory-visualizer/src/server/index.ts` flow.
- Gateway read-only visualizer DTO endpoints for requests telemetry.
- Visualizer read-only API endpoints for requests telemetry.
- Requests Monitor UI route.
- Docker compose and README updates for separate writable telemetry volume/path.
- Unit, integration, E2E, safety, and docker checks.

### Definition of Done (verifiable conditions with commands)
- `npm test`
- `npm --prefix apps/memory-visualizer run typecheck`
- `npm --prefix apps/memory-visualizer test`
- `npm --prefix apps/memory-visualizer run build`
- `npm --prefix apps/memory-visualizer run safety:readonly`
- `npm --prefix apps/memory-visualizer run check:docker`
- `npm --prefix apps/memory-visualizer run test:e2e`
- `rg "delete|edit|merge|reindex|capture|seed|retry|replay|session-end|api key|settings" apps/memory-visualizer/src` must show no executable mutation controls in the visualizer UI. Documentation-only or explicit prohibition text is acceptable.
- Docker compose config keeps memory data mounted read-only for visualizer and adds a separate writable telemetry volume/path.

### Must Have
- UI route: `/requests-monitor`.
- Visualizer API routes: `GET /api/requests`, `GET /api/requests/summary`.
- Gateway visualizer DTO routes: `GET /visualizer/requests`, `GET /visualizer/requests/summary`.
- Telemetry env resolution:
  - Gateway writer: `TDAI_GATEWAY_TELEMETRY_DIR` → `TDAI_TELEMETRY_DIR` → telemetry disabled.
  - Visualizer writer/reader: `TDAI_VIS_TELEMETRY_DIR` → `TDAI_TELEMETRY_DIR` → telemetry disabled.
  - Standalone Docker sets `TDAI_TELEMETRY_DIR=/data/request-telemetry` using a separate named volume `tdai_request_telemetry`.
- JSONL files:
  - `request-logs.gateway.jsonl`
  - `request-logs.visualizer.jsonl`
- Request API defaults:
  - `limit` default `50`, maximum `200`.
  - `offset` default `0`.
  - Non-integer or negative `limit`/`offset` returns HTTP 400 with sanitized message.
  - Results sorted newest-first after merging Gateway and Visualizer logs.
- Summary API fields:
  - `total`, `last24h`, `errorRate`, `p95LatencyMs`, `recent5xx`, `sources`, `warnings`.
- Retention/read-window behavior:
  - First version is append-only with bounded read/summary windows only.
  - Reader considers at most newest 10,000 valid records per file.
  - No automatic deletion, truncation, compaction, or rewrite in first version.
  - Files over 10MB return newest readable records plus `telemetry-file-too-large` warning.
- Telemetry directory safety:
  - Resolved telemetry dir must not be the memory data root or under the read-only memory mount.
  - If resolved telemetry dir is unsafe, telemetry is disabled/degraded with warning and primary requests still succeed.
- Sanitized telemetry schema:
  - `id`, `source`, `method`, `path`, `routePattern`, `statusCode`, `outcome`, `latencyMs`, `authType`, `createdAt`, `queryKeys`, `warningCodes`.
  - `source`: `visualizer-api` or `gateway`.
  - `outcome`: `ok`, `error`, `unauthorized`, `blocked`, `aborted`.
  - `authType`: `none`, `local`, `api_key`, `visualizer_api_key`, `gateway_api_key`, `unknown`.
- Sanitizer stores pathname only and allowlisted query key names only; first version allowlist: `limit`, `offset`, `source`, `status`, `type`.
- Skip policy: health, static assets, favicon, source maps, `/api/requests`, `/api/requests/summary`, `/visualizer/requests`, `/visualizer/requests/summary`.
- Missing telemetry dir/file returns empty results plus warning, not crash.
- Corrupt JSONL lines are skipped and counted in warnings.
- Unwritable telemetry dir logs warning and primary request still succeeds.

### Must NOT Have
- No Next.js migration.
- No Redux introduction.
- No mutation UI, mutation endpoints, disabled mutation placeholders, command palette mutation actions, keyboard shortcuts, retry/replay, export, delete/clear logs, memory edit/delete/merge, reindex, capture, seed, session-end, API key management, account/settings mutation, cloud/pro upsell.
- No raw request body, response body, raw URL, raw query string, Authorization header, Cookie header, bearer token, API key, recall/search query text, memory content, conversation content, prompt content, or response content in telemetry.
- No browser direct access to Gateway internals beyond existing safe visualizer DTO/debug flows.

## Verification Strategy
> ZERO HUMAN INTERVENTION - all verification is agent-executed.
- Test decision: tests-after + existing Vitest/Playwright infrastructure. Avoid TDD because the work is a broad refactor with existing tests and E2E harnesses.
- QA policy: Every task has agent-executed scenarios.
- Evidence: `.omo/evidence/task-{N}-{slug}.{ext}`.

## Execution Strategy
### Parallel Execution Waves
> Target: 5-8 tasks per wave. <3 per wave except final = under-splitting.
> Implementation + tests stay in the same task.

Wave 1: Tasks 1-5 (contracts, UI primitives/shell, docs/env decisions, telemetry storage core)
Wave 2: Tasks 6-9 (Gateway telemetry, Visualizer telemetry, read APIs, route pages)
Wave 3: Tasks 10-12 (Requests UI, Docker/docs, full verification hardening)
Wave 4: Final verification wave F1-F4

#### Actual Parallel Sub-Waves
- Wave 1A: Tasks 1, 2 in parallel.
- Wave 1B: Tasks 3 and 5 in parallel after their prerequisites are met.
- Wave 1C: Task 4 after Task 3.
- Wave 2A: Tasks 6 and 7 in parallel after Tasks 1 and 5.
- Wave 2B: Tasks 8 and 9 in parallel after their server telemetry prerequisites.
- Wave 3A: Tasks 10 and 11 in parallel after API/shell prerequisites.
- Wave 3B: Task 12 after Tasks 6, 7, 10, and 11.
- Wave 4: F1-F4 in parallel after Task 12.

### Dependency Matrix (full, all tasks)
- Task 1 blocks Tasks 5, 6, 7, 8, 9, 10.
- Task 2 blocks Tasks 3, 4, 10.
- Task 3 blocks Tasks 4, 10.
- Task 4 blocks Task 10.
- Task 5 blocks Tasks 6, 7, 8, 9.
- Task 6 blocks Tasks 8, 9, 10, 12.
- Task 7 blocks Tasks 8, 10, 12.
- Task 8 blocks Task 10.
- Task 9 blocks Task 10.
- Task 10 blocks Task 12.
- Task 11 blocks Task 12.
- Task 12 blocks Final Verification Wave.

### Agent Dispatch Summary
- Wave 1 → 5 tasks → quick, visual-engineering, unspecified-high.
- Wave 2 → 4 tasks → unspecified-high, quick.
- Wave 3 → 3 tasks → visual-engineering, writing, unspecified-high.
- Wave 4 → 4 review tasks → oracle, unspecified-high, deep.

## TODOs
> Implementation + Test = ONE task. Every task has QA scenarios. Executor has no interview context; references are exhaustive.

- [x] 1. Define sanitized Requests telemetry contract and route classifier

  **What to do**: Add a shared telemetry contract/sanitizer module in a neutral non-UI location (recommended `src/telemetry/request-telemetry.ts`, with app import path adjusted by existing build constraints). Define `SanitizedRequestLog`, summary types, source/outcome/auth enums, route classification, query-key allowlist, path normalization, skip policy, and secret omission behavior. Include unit tests covering safe fields, dangerous fields, route patterns, query key allowlist, and skip decisions.
  **Must NOT do**: Do not import React/Vite UI modules into Gateway. Do not store raw query, headers, body, response, memory, conversation, prompt, token, key, cookie, or authorization values.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - Reason: security-sensitive shared data contract and sanitizer.
  - Skills: [] - No specialized skill required beyond TypeScript testing.
  - Omitted: [`frontend-ui-ux`] - No UI work in this task.

  **Parallelization**: Can Parallel: YES | Wave 1 | Blocks: 5,6,7,8,9,10 | Blocked By: none

  **References**:
  - Pattern: `apps/memory-visualizer/src/contracts/dashboard.ts:1` - Existing serializable DTO style and read-only dashboard contract.
  - Pattern: `src/gateway/types.ts:1` - Existing Gateway request/response type organization.
  - Security reference: `mem0/server/models.py:43` - Mem0 basic request log fields to adapt, not copy wholesale.
  - Security reference: `mem0/server/main.py:278` - Mem0 middleware telemetry concept.

  **Acceptance Criteria**:
  - [ ] `npm test` passes with new sanitizer/classifier tests.
  - [ ] Test input `/api/search?q=my-secret-password&limit=10&token=abc123` produces `path: "/api/search"`, `queryKeys: ["limit"]`, and no secret values.
  - [ ] Tests assert output JSON does not contain `my-secret-password`, `abc123`, `Authorization`, `Cookie`, `Bearer`, `token=`, `q=`, `body`, `response_body`, `memory`, or `conversation`.
  - [ ] Tests assert `/api/requests`, `/api/requests/summary`, `/visualizer/requests`, `/visualizer/requests/summary`, health, favicon, source maps, and static asset paths are skipped.

  **QA Scenarios**:
  ```
  Scenario: Sanitizer drops secret-bearing query and headers
    Tool: Bash
    Steps: Run `npm test` after adding a unit test for `/api/search?q=my-secret-password&limit=10&token=abc123` with Authorization and Cookie headers.
    Expected: Test passes; serialized telemetry contains pathname and `limit` key only, with no secret strings.
    Evidence: .omo/evidence/task-1-telemetry-sanitizer.txt

  Scenario: Skip policy prevents recursive/noisy logs
    Tool: Bash
    Steps: Run `npm test` after adding unit tests for request monitor, health, favicon, source map, and static paths.
    Expected: Classifier marks each as skipped and no log record is produced.
    Evidence: .omo/evidence/task-1-skip-policy.txt
  ```

  **Commit**: YES | Message: `feat(telemetry): add sanitized request log contract` | Files: [`src/telemetry/request-telemetry.ts`, tests]

- [x] 2. Extract design tokens and read-only UI primitives from visualizer styles

  **What to do**: Refactor `apps/memory-visualizer/src/ui/styles.css` into clearer semantic sections and add reusable class patterns for the selected concise Mem0-inspired operations dashboard: fixed sidebar, clean content grid, metric row, compact table, restrained badges, empty/error/loading states, and detail drawer while preserving the existing TencentDB dark parchment/glass identity as a subtle local-dashboard treatment. Add or update UI primitive components under `apps/memory-visualizer/src/ui/components/` as needed.
  **Must NOT do**: Do not adopt Mem0 exact purple/gold SaaS palette. Do not introduce Tailwind, Radix, Redux, or Next.js. Do not use the archive-card, network-cockpit/timeline, or split-pane diagnostics concepts as the primary final layout.

  **Recommended Agent Profile**:
  - Category: `visual-engineering` - Reason: UI system extraction and visual consistency.
  - Skills: [`frontend-ui-ux`] - Needed for design-system discipline.
  - Omitted: [`git-master`] - No git history task.

  **Parallelization**: Can Parallel: YES | Wave 1 | Blocks: 3,4,10 | Blocked By: none

  **References**:
  - Current style: `apps/memory-visualizer/src/ui/styles.css:1` - Existing dark parchment/glass variables and layout classes.
  - Mem0 token method: `mem0/server/dashboard/src/styles/globals.css:5` - Token discipline to borrow conceptually.
  - Mem0 table: `mem0/server/dashboard/src/components/shared/data-table.tsx:25` - Compact table idea to adapt.
  - Mem0 requests UI: `mem0/server/dashboard/src/app/(root)/dashboard/requests/page.tsx:199` - Metric card layout idea to adapt.

  **Acceptance Criteria**:
  - [ ] `npm --prefix apps/memory-visualizer run typecheck` passes.
  - [ ] `npm --prefix apps/memory-visualizer test` passes.
  - [ ] `npm --prefix apps/memory-visualizer run build` passes.
  - [ ] Existing visualizer routes still render headings in UI tests.
  - [ ] No dependencies added for Tailwind, Radix, Redux, or Next.js.

  **QA Scenarios**:
  ```
  Scenario: Existing UI still renders after primitive extraction
    Tool: Bash
    Steps: Run `npm --prefix apps/memory-visualizer test`.
    Expected: Existing App UI shell tests pass without route text regressions.
    Evidence: .omo/evidence/task-2-ui-primitives-tests.txt

  Scenario: Build remains dependency-light
    Tool: Bash
    Steps: Run `npm --prefix apps/memory-visualizer run build` and inspect `apps/memory-visualizer/package.json` diff.
    Expected: Build passes; no Next.js/Tailwind/Radix/Redux dependency added.
    Evidence: .omo/evidence/task-2-ui-primitives-build.txt
  ```

  **Commit**: YES | Message: `refactor(visualizer): extract read-only ui primitives` | Files: [`apps/memory-visualizer/src/ui/styles.css`, `apps/memory-visualizer/src/ui/components/*`, tests]

- [x] 3. Split `App.tsx` into shell, route registry, auth gate, hooks, and route modules without behavior changes

  **What to do**: Mechanically extract from `apps/memory-visualizer/src/ui/App.tsx`: `AppShell`, `AuthGate`, route definitions, navigation helpers, `useDashboardData`, `useSourceQuery`, and existing route components into separate files. Preserve current routes and labels before adding Requests Monitor. Keep all existing tests green.
  **Must NOT do**: Do not change API behavior, add Requests Monitor, or alter security/auth semantics in this task.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - Reason: broad but mechanical TypeScript refactor.
  - Skills: [] - No special skill required.
  - Omitted: [`frontend-ui-ux`] - Visual design not changed in this task.

  **Parallelization**: Can Parallel: NO | Wave 1 | Blocks: 4,10 | Blocked By: 2

  **References**:
  - Source monolith: `apps/memory-visualizer/src/ui/App.tsx:83` - Current route definitions.
  - Source auth gate: `apps/memory-visualizer/src/ui/App.tsx:308` - Current shared-key login rendering.
  - Source data loading: `apps/memory-visualizer/src/ui/App.tsx:1546` - Current `requestDashboardData` flow.
  - Existing tests: `apps/memory-visualizer/src/ui/App.ui-shell.test.tsx`, `App.scene-routes.test.tsx`, `App.memory-routes.test.tsx`, `App.offload-gateway.test.tsx`.

  **Acceptance Criteria**:
  - [ ] `npm --prefix apps/memory-visualizer run typecheck` passes.
  - [ ] `npm --prefix apps/memory-visualizer test` passes.
  - [ ] `npm --prefix apps/memory-visualizer run build` passes.
  - [ ] `apps/memory-visualizer/src/ui/App.tsx` becomes a thin composition file and no longer contains all route implementations.
  - [ ] Existing route labels and auth login behavior remain covered by tests.

  **QA Scenarios**:
  ```
  Scenario: Mechanical extraction preserves current routes
    Tool: Bash
    Steps: Run `npm --prefix apps/memory-visualizer test`.
    Expected: Existing route tests for overview, scene, memory, evidence, offload, debug, and settings pass.
    Evidence: .omo/evidence/task-3-app-split-tests.txt

  Scenario: Type/build catch import mistakes
    Tool: Bash
    Steps: Run `npm --prefix apps/memory-visualizer run typecheck` then `npm --prefix apps/memory-visualizer run build`.
    Expected: Both pass with no missing exports or circular runtime failures.
    Evidence: .omo/evidence/task-3-app-split-build.txt
  ```

  **Commit**: YES | Message: `refactor(visualizer): split app shell and routes` | Files: [`apps/memory-visualizer/src/ui/App.tsx`, `apps/memory-visualizer/src/ui/routes/*`, `apps/memory-visualizer/src/ui/hooks/*`, tests]

- [x] 4. Add Mem0-inspired dashboard shell navigation grouping

  **What to do**: Update the extracted shell/nav to use task-oriented groups: `Overview`, `Observability`, `Explore`, `Trace`, `Debug`, `System`. Keep existing routes, reserve the `Observability` group for the later Requests Monitor route, and maintain source query propagation. Do not show a clickable `Requests Monitor` entry until Task 10 implements the real route. Use Mem0's sidebar grouping concept but keep current visualizer design.
  **Must NOT do**: Do not copy Mem0 `ACTIVITY/CLOUD FEATURES/ACCOUNT` labels, account menu, logout menu, cloud/pro badges, or control-plane links.

  **Recommended Agent Profile**:
  - Category: `visual-engineering` - Reason: dashboard shell and navigation UX.
  - Skills: [`frontend-ui-ux`] - Needed for information architecture and visual layout.
  - Omitted: [] - No omitted specialized skill.

  **Parallelization**: Can Parallel: NO | Wave 1 | Blocks: 10 | Blocked By: 2,3

  **References**:
  - Current nav list: `apps/memory-visualizer/src/ui/App.tsx:398` - Existing nav rendering to preserve behavior from.
  - Mem0 grouping concept: `mem0/server/dashboard/src/app/(root)/dashboard/components/main-nav.tsx:55`.
  - Mem0 shell concept: `mem0/server/dashboard/src/app/(root)/dashboard/components/nav-wrapper.tsx:44`.

  **Acceptance Criteria**:
  - [ ] `npm --prefix apps/memory-visualizer test` passes with updated shell/nav tests.
  - [ ] `npm --prefix apps/memory-visualizer run build` passes.
  - [ ] Navigation includes the `Observability` group without a visible/clickable broken `Requests Monitor` placeholder before Task 10.
  - [ ] Source query parameters remain preserved when navigating existing routes.

  **QA Scenarios**:
  ```
  Scenario: Grouped nav keeps route navigation working
    Tool: Bash
    Steps: Add/update UI shell test to click each grouped route link, then run `npm --prefix apps/memory-visualizer test`.
    Expected: Active route changes and source query string remains preserved.
    Evidence: .omo/evidence/task-4-grouped-nav-tests.txt

  Scenario: No Mem0 control-plane labels copied
    Tool: Bash
    Steps: Run `rg "CLOUD FEATURES|ACCOUNT|API Keys|Delete memory|PRO|Export|Webhooks" apps/memory-visualizer/src/ui`.
    Expected: No executable navigation/control labels for these Mem0 control-plane concepts appear.
    Evidence: .omo/evidence/task-4-no-control-plane.txt
  ```

  **Commit**: YES | Message: `feat(visualizer): add grouped dashboard navigation` | Files: [`apps/memory-visualizer/src/ui/*`, tests]

- [x] 5. Implement append-only JSONL telemetry store with bounded read/summary behavior

  **What to do**: Implement telemetry directory resolution, separate Gateway/Visualizer JSONL filenames, append writer, tail/merge reader, summary calculator, corrupt-line handling, disabled/missing/unwritable warnings, limit/offset validation, and bounded read/summary windows. First-version retention decision: append-only files are never deleted, truncated, compacted, or rewritten automatically; readers consider at most the newest 10,000 valid records per file, and files over 10MB return newest readable records plus `telemetry-file-too-large` warning.
  **Must NOT do**: Do not write inside the memory data root or under the read-only memory mount. If the resolved telemetry dir equals or nests under the memory data root/read-only mount, disable/degrade telemetry with a warning while preserving primary request behavior. Standalone defaults must use a separate named volume path. Do not let telemetry errors affect primary requests.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - Reason: file IO, validation, edge cases, and privacy-critical behavior.
  - Skills: [] - No domain skill required.
  - Omitted: [`frontend-ui-ux`] - No UI work.

  **Parallelization**: Can Parallel: YES | Wave 1 | Blocks: 6,7,8,9 | Blocked By: 1

  **References**:
  - Existing local provider warning patterns: `apps/memory-visualizer/src/providers/local-dashboard-data-provider.ts:145`.
  - Existing server validation style: `apps/memory-visualizer/src/server/index.ts:211`.
  - Mem0 retention context: `mem0/server/README.md` request log retention section.

  **Acceptance Criteria**:
  - [ ] Unit tests cover missing directory, missing files, corrupt JSONL, oversized file warning, unwritable write path, merge newest-first, summary p95/error calculations, `limit` cap, invalid `limit`/`offset`.
  - [ ] Unit tests cover unsafe telemetry dir detection when telemetry dir equals or nests under a configured memory data root/read-only mount; telemetry is disabled/degraded with warning.
  - [ ] Unit tests prove no automatic deletion, truncation, compaction, or rewrite occurs in first version.
  - [ ] `npm test` passes.
  - [ ] No telemetry write function throws to callers on filesystem failure; it returns/records warning instead.

  **QA Scenarios**:
  ```
  Scenario: Corrupt JSONL is degraded not fatal
    Tool: Bash
    Steps: Run unit test using JSONL lines `{valid}`, `not-json`, `{valid}`.
    Expected: Reader returns two valid records and warning count/code for one corrupt line.
    Evidence: .omo/evidence/task-5-corrupt-jsonl.txt

  Scenario: Unwritable telemetry path fails open
    Tool: Bash
    Steps: Run unit test with telemetry writer pointed at an unwritable/non-directory path.
    Expected: Writer returns warning; simulated primary handler response remains success.
    Evidence: .omo/evidence/task-5-unwritable-failopen.txt
  ```

  **Commit**: YES | Message: `feat(telemetry): add append-only request log store` | Files: [`src/telemetry/*`, tests]

- [x] 6. Wrap Gateway request handling with sanitized telemetry

  **What to do**: Integrate telemetry in `src/gateway/server.ts` around the central `handleRequest` flow. Record Gateway routes except skip-policy routes. Ensure success, 401, 404, 500, and thrown errors are logged with sanitized records and latency. Use env resolution `TDAI_GATEWAY_TELEMETRY_DIR` → `TDAI_TELEMETRY_DIR` → disabled. Classify request types for `/recall`, `/capture`, `/search/memories`, `/search/conversations`, `/session/end`, `/seed`, `/visualizer/*`; observing mutation-capable Gateway routes is allowed, but the Visualizer UI must not provide controls to invoke them.
  **Must NOT do**: Do not expose new write-capable endpoints. Do not persist request body or query text. Do not break existing auth behavior.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - Reason: server request lifecycle and auth/error path handling.
  - Skills: [] - No special skill required.
  - Omitted: [`frontend-ui-ux`] - Server-only.

  **Parallelization**: Can Parallel: YES | Wave 2 | Blocks: 8,9,10,12 | Blocked By: 1,5

  **References**:
  - Gateway router: `src/gateway/server.ts:240` - Central request handling.
  - Gateway auth: `src/gateway/server.ts:326` - Existing bearer auth gate.
  - Gateway tests: `src/gateway/server.test.ts:24` - Existing visualizer DTO endpoint tests.
  - Mem0 middleware: `mem0/server/main.py:278` - Conceptual reference.

  **Acceptance Criteria**:
  - [ ] `npm test` passes.
  - [ ] Tests prove `/recall`, `/search/memories`, unauthorized request, not-found request, thrown-error request create sanitized Gateway records when telemetry dir is configured.
  - [ ] Tests prove primary request still succeeds when telemetry path is unwritable.
  - [ ] Tests prove `/health` and `/visualizer/requests` endpoints are skipped.

  **QA Scenarios**:
  ```
  Scenario: Gateway records success and error outcomes
    Tool: Bash
    Steps: Run `npm test` after adding Gateway telemetry tests for successful recall/search and 404/401 paths.
    Expected: Sanitized Gateway JSONL contains source `gateway`, pathname-only path, status codes, and latency; no body/query/header values.
    Evidence: .omo/evidence/task-6-gateway-telemetry.txt

  Scenario: Gateway telemetry failure does not affect response
    Tool: Bash
    Steps: Run test with `TDAI_GATEWAY_TELEMETRY_DIR` pointing at unwritable path and invoke `GET /health` plus a protected route.
    Expected: Original route behavior unchanged; warning is recorded/logged; no uncaught exception.
    Evidence: .omo/evidence/task-6-gateway-failopen.txt
  ```

  **Commit**: YES | Message: `feat(gateway): record sanitized request telemetry` | Files: [`src/gateway/server.ts`, `src/gateway/server.test.ts`, telemetry files]

- [x] 7. Wrap Visualizer API server with sanitized telemetry

  **What to do**: Integrate telemetry in `apps/memory-visualizer/src/server/index.ts` for read-only `/api/*` and debug proxy endpoints. Use env resolution `TDAI_VIS_TELEMETRY_DIR` → `TDAI_TELEMETRY_DIR` → disabled. Record auth failures, 404, malformed body, body-too-large, gateway debug success/failure, and ordinary snapshot/page reads. Skip Requests Monitor APIs and health/static routes.
  **Must NOT do**: Do not log raw debug recall/search queries or request bodies. Do not change visualizer auth behavior or fail-closed semantics for protected data APIs.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - Reason: server auth/error flow and security-sensitive logging.
  - Skills: [] - No special skill required.
  - Omitted: [`frontend-ui-ux`] - Server-only.

  **Parallelization**: Can Parallel: YES | Wave 2 | Blocks: 8,10,12 | Blocked By: 1,5

  **References**:
  - Visualizer server: `apps/memory-visualizer/src/server/index.ts:54` - Server creation and route switch.
  - Auth gate: `apps/memory-visualizer/src/server/auth.ts:15` - Visualizer shared API key behavior.
  - Existing server tests: `apps/memory-visualizer/src/server/server.test.ts:28`.

  **Acceptance Criteria**:
  - [ ] `npm --prefix apps/memory-visualizer test` passes.
  - [ ] Tests prove `/api/snapshot`, `/api/gateway/recall-debug`, unauthorized `/api/snapshot`, malformed JSON, body-too-large, and 404 paths create sanitized Visualizer records when telemetry dir is configured.
  - [ ] Tests prove `/api/requests`, `/api/requests/summary`, and `/health` are skipped.
  - [ ] Tests prove debug request body query `my-secret-password` is absent from telemetry.

  **QA Scenarios**:
  ```
  Scenario: Visualizer records debug proxy without query leakage
    Tool: Bash
    Steps: Run visualizer server test posting `{ "query": "my-secret-password", "session_key": "session-alpha" }` to `/api/gateway/recall-debug`.
    Expected: Log record path is `/api/gateway/recall-debug`; telemetry file does not contain `my-secret-password` or `session-alpha`.
    Evidence: .omo/evidence/task-7-visualizer-debug-sanitized.txt

  Scenario: Requests Monitor APIs are not self-logged
    Tool: Bash
    Steps: Run visualizer server test calling `/api/requests` and `/api/requests/summary`.
    Expected: Telemetry record count does not increase for those routes.
    Evidence: .omo/evidence/task-7-visualizer-skip.txt
  ```

  **Commit**: YES | Message: `feat(visualizer): record sanitized api telemetry` | Files: [`apps/memory-visualizer/src/server/index.ts`, tests, telemetry files]

- [x] 8. Add read-only request telemetry APIs to Visualizer server

  **What to do**: Add `GET /api/requests` and `GET /api/requests/summary` in `apps/memory-visualizer/src/server/index.ts`. They read the configured Visualizer telemetry dir, merge Gateway and Visualizer JSONL files when available, enforce default/max limit and offset validation, return warnings, and require existing visualizer auth like other `/api/*` routes.
  **Must NOT do**: Do not add delete/clear/export endpoints. Do not return raw file paths if they expose sensitive local directories; return source labels and warning codes instead.

  **Recommended Agent Profile**:
  - Category: `quick` - Reason: endpoint wiring after store exists.
  - Skills: [] - No special skill required.
  - Omitted: [`frontend-ui-ux`] - API-only.

  **Parallelization**: Can Parallel: YES | Wave 2 | Blocks: 10 | Blocked By: 5,6,7

  **References**:
  - Existing API pagination: `apps/memory-visualizer/src/server/index.ts:211`.
  - Existing auth behavior tests: `apps/memory-visualizer/src/server/server.test.ts:71`.
  - Mem0 requests API concept: `mem0/server/routers/requests.py:31`.

  **Acceptance Criteria**:
  - [ ] `GET /api/requests?limit=20` returns at most 20 newest-first items.
  - [ ] `GET /api/requests?limit=99999` caps at 200.
  - [ ] `GET /api/requests?limit=abc` returns HTTP 400 sanitized error.
  - [ ] Missing telemetry files return HTTP 200 with empty items and warning.
  - [ ] `/api/requests/summary` returns total/last24h/errorRate/p95LatencyMs/recent5xx/sources/warnings without client scanning all logs.
  - [ ] `npm --prefix apps/memory-visualizer test` passes.

  **QA Scenarios**:
  ```
  Scenario: Requests API paginates and caps limits
    Tool: Bash
    Steps: Run visualizer server tests for `limit=20`, `limit=99999`, `offset=10`.
    Expected: Responses are newest-first, max 200, and offset is applied after merge sort.
    Evidence: .omo/evidence/task-8-requests-api-pagination.txt

  Scenario: Missing telemetry file shows empty degraded response
    Tool: Bash
    Steps: Run visualizer server test with configured telemetry dir containing no JSONL files.
    Expected: HTTP 200, empty items, total 0, warning code such as `telemetry-file-missing` or `telemetry-disabled`.
    Evidence: .omo/evidence/task-8-requests-api-empty.txt
  ```

  **Commit**: YES | Message: `feat(visualizer): expose read-only request telemetry api` | Files: [`apps/memory-visualizer/src/server/index.ts`, tests, telemetry files]

- [x] 9. Add Gateway `/visualizer/requests` DTO endpoints for remote visualizer mode

  **What to do**: Add protected `GET /visualizer/requests` and `GET /visualizer/requests/summary` to `src/gateway/server.ts`. These use the same telemetry reader against the configured telemetry directory and read both `request-logs.gateway.jsonl` and `request-logs.visualizer.jsonl` when present, merge records, sort newest-first, and apply offset/limit after merge. They return sanitized DTOs for `TDAI_VIS_DATA_SOURCE=gateway` deployments and require Gateway API key just like existing `/visualizer/*` DTO routes.
  **Must NOT do**: Do not expose unprotected request logs. Do not add mutation endpoints. Do not include raw local paths/secrets.

  **Recommended Agent Profile**:
  - Category: `quick` - Reason: Gateway endpoint wiring after store exists.
  - Skills: [] - No special skill required.
  - Omitted: [`frontend-ui-ux`] - API-only.

  **Parallelization**: Can Parallel: YES | Wave 2 | Blocks: 10 | Blocked By: 5,6

  **References**:
  - Existing Gateway visualizer routes: `src/gateway/server.ts:288`.
  - Existing Gateway visualizer tests: `src/gateway/server.test.ts:24`.
  - Remote provider pattern: `apps/memory-visualizer/src/providers/remote-dashboard-data-provider.ts:40`.

  **Acceptance Criteria**:
  - [ ] `npm test` passes.
  - [ ] Tests prove `/visualizer/requests` requires `TDAI_GATEWAY_API_KEY`; without it returns existing fail-closed 503 behavior for visualizer DTOs.
  - [ ] Tests prove valid auth returns sanitized request page and summary.
  - [ ] Tests prove Gateway DTO endpoints read both `request-logs.gateway.jsonl` and `request-logs.visualizer.jsonl`, merge, sort newest-first, and apply offset/limit after merge.
  - [ ] Tests prove `/visualizer/requests` is skipped from telemetry to avoid recursion.

  **QA Scenarios**:
  ```
  Scenario: Gateway request DTO endpoint is protected
    Tool: Bash
    Steps: Run Gateway server test with and without API key for `/visualizer/requests`.
    Expected: Without configured key fail-closed; with valid bearer returns sanitized items.
    Evidence: .omo/evidence/task-9-gateway-requests-protected.txt

  Scenario: Remote DTO endpoint does not leak query/body
    Tool: Bash
    Steps: Seed telemetry fixture containing dangerous fields; request `/visualizer/requests`.
    Expected: Response contains only sanitized schema fields.
    Evidence: .omo/evidence/task-9-gateway-requests-sanitized.txt
  ```

  **Commit**: YES | Message: `feat(gateway): expose request telemetry visualizer dtos` | Files: [`src/gateway/server.ts`, `src/gateway/server.test.ts`, provider files]

- [x] 10. Build Requests Monitor UI route

  **What to do**: Add `RequestsMonitorRoute` under `/requests-monitor`. Integrate it into grouped nav under `Observability`. Use `/api/requests` and `/api/requests/summary` through the dashboard API client. Implement the selected concise Mem0-inspired operations dashboard layout: top metric strip, simple filter/refresh row, compact request table as the primary scan surface, restrained method/status/source/auth badges, pagination, empty/degraded states, and sanitized detail drawer opened from a row. Use first-version table columns: Time, Source, Type/Pattern, Method, Path, Result, Status, Latency, Auth.
  **Must NOT do**: No retry/replay/delete/clear/export/edit controls, no raw body/query viewer, no mutation buttons, no cloud/pro upsell. Do not replace the primary table with card-only, timeline-only, graph/cockpit, or permanent three-pane diagnostics layouts.

  **Recommended Agent Profile**:
  - Category: `visual-engineering` - Reason: new dashboard route and UX.
  - Skills: [`frontend-ui-ux`] - Needed for visual hierarchy and Mem0-inspired UI adaptation.
  - Omitted: [] - No omitted specialized skill.

  **Parallelization**: Can Parallel: NO | Wave 3 | Blocks: 12 | Blocked By: 1,3,4,8,9

  **References**:
  - Mem0 Requests page: `mem0/server/dashboard/src/app/(root)/dashboard/requests/page.tsx:83` - Metric/table/badge/refresh pattern to adapt.
  - Current API client: `apps/memory-visualizer/src/ui/api-client.ts` - Existing API access pattern.
  - Current status cards: `apps/memory-visualizer/src/ui/App.tsx:518` - Existing overview metric style before extraction.
  - Current E2E harness: `apps/memory-visualizer/e2e/helpers/visualizer-harness.ts`.

  **Acceptance Criteria**:
  - [ ] `npm --prefix apps/memory-visualizer run typecheck` passes.
  - [ ] `npm --prefix apps/memory-visualizer test` passes.
  - [ ] `npm --prefix apps/memory-visualizer run build` passes.
  - [ ] UI tests verify `/requests-monitor` route renders metric cards and table from fixture telemetry.
  - [ ] UI/E2E tests verify empty telemetry state renders without crash.
  - [ ] `rg "retry|replay|delete|clear logs|export|edit|capture|seed|session-end" apps/memory-visualizer/src/ui` shows no executable Requests Monitor controls.

  **QA Scenarios**:
  ```
  Scenario: Requests Monitor renders sanitized telemetry
    Tool: Playwright
    Steps: Start visualizer harness with telemetry fixture, visit `/requests-monitor`, click a request row.
    Expected: Metric cards visible; table shows source/method/status/latency; detail drawer contains sanitized fields only.
    Evidence: .omo/evidence/task-10-requests-monitor.png

  Scenario: Requests Monitor has no mutation controls
    Tool: Bash
    Steps: Run `rg "retry|replay|delete|clear logs|export|edit|capture|seed|session-end" apps/memory-visualizer/src/ui` and `npm --prefix apps/memory-visualizer run test:e2e`.
    Expected: Search finds no executable controls; E2E verifies no buttons named retry/replay/delete/export are visible on `/requests-monitor`.
    Evidence: .omo/evidence/task-10-no-mutation-controls.txt
  ```

  **Commit**: YES | Message: `feat(visualizer): add requests monitor route` | Files: [`apps/memory-visualizer/src/ui/routes/*`, `api-client.ts`, tests, e2e]

- [x] 11. Update Docker, README, and safety checks for separate telemetry storage

  **What to do**: Update standalone compose/GHCR compose/Dockerfile/docs/check scripts so memory data remains read-only in visualizer and a separate writable telemetry volume/path is configured. Add docs for `TDAI_TELEMETRY_DIR`, `TDAI_GATEWAY_TELEMETRY_DIR`, `TDAI_VIS_TELEMETRY_DIR`, skip policy, privacy guarantees, and Requests Monitor scope.
  **Must NOT do**: Do not mount memory data writable into visualizer. Do not hardcode secrets. Do not enable Gateway debug proxy by default.

  **Recommended Agent Profile**:
  - Category: `writing` - Reason: docs and deployment plan updates with config clarity.
  - Skills: [] - No special skill required.
  - Omitted: [`frontend-ui-ux`] - No UI implementation.

  **Parallelization**: Can Parallel: YES | Wave 3 | Blocks: 12 | Blocked By: 5,6,7

  **References**:
  - Standalone compose: `docker/standalone/docker-compose.yml:29` - Visualizer sidecar mount and ports.
  - Visualizer Dockerfile: `apps/memory-visualizer/Dockerfile:13` - Runtime env defaults.
  - Visualizer README: `apps/memory-visualizer/README.md:40`.
  - Docker sidecar checker: `apps/memory-visualizer/scripts/check-docker-sidecar.mjs`.

  **Acceptance Criteria**:
  - [ ] `npm --prefix apps/memory-visualizer run check:docker` passes and explicitly checks separate telemetry path/volume.
  - [ ] `npm --prefix apps/memory-visualizer run safety:readonly` passes.
  - [ ] Docs state telemetry is operational append-only data separate from memory data and does not store secrets/content.
  - [ ] Compose keeps `tdai_memory_data:/data/memory-tdai:ro` for visualizer and adds separate writable telemetry volume.

  **QA Scenarios**:
  ```
  Scenario: Docker config preserves read-only memory mount
    Tool: Bash
    Steps: Run `npm --prefix apps/memory-visualizer run check:docker`.
    Expected: Check confirms visualizer memory mount remains read-only and telemetry uses separate writable volume/path.
    Evidence: .omo/evidence/task-11-docker-check.txt

  Scenario: Safety docs mention no secret/content logging
    Tool: Bash
    Steps: Run `npm --prefix apps/memory-visualizer run safety:readonly` and `node apps/memory-visualizer/scripts/check-docs.mjs` if present.
    Expected: Safety checks pass; docs include telemetry envs and privacy constraints.
    Evidence: .omo/evidence/task-11-safety-docs.txt
  ```

  **Commit**: YES | Message: `docs(visualizer): document request telemetry storage` | Files: [`docker/standalone/*`, `apps/memory-visualizer/Dockerfile`, `README.md`, docs/check scripts]

- [x] 12. Harden full verification suite and fixtures for Requests Monitor

  **What to do**: Add deterministic fixtures for complete telemetry, empty telemetry, corrupt telemetry, and dangerous secret-bearing requests. Update unit/integration/E2E tests so all new behavior is covered. Run full verification commands and store outputs in `.omo/evidence`.
  **Must NOT do**: Do not rely on manual visual inspection. Do not require real secrets, external services, or public Gateway exposure.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - Reason: cross-cutting test hardening and full QA execution.
  - Skills: [] - No special skill required.
  - Omitted: [] - No omitted specialized skill.

  **Parallelization**: Can Parallel: NO | Wave 3 | Blocks: Final Verification Wave | Blocked By: 6,7,10,11

  **References**:
  - App tests: `apps/memory-visualizer/src/ui/App.ui-shell.test.tsx` and route tests.
  - Server tests: `apps/memory-visualizer/src/server/server.test.ts:28`.
  - Gateway tests: `src/gateway/server.test.ts:24`.
  - E2E harness: `apps/memory-visualizer/e2e/helpers/visualizer-harness.ts`.
  - Scripts: `apps/memory-visualizer/package.json:6`.

  **Acceptance Criteria**:
  - [ ] `npm test` passes.
  - [ ] `npm --prefix apps/memory-visualizer run typecheck` passes.
  - [ ] `npm --prefix apps/memory-visualizer test` passes.
  - [ ] `npm --prefix apps/memory-visualizer run build` passes.
  - [ ] `npm --prefix apps/memory-visualizer run safety:readonly` passes.
  - [ ] `npm --prefix apps/memory-visualizer run check:docker` passes.
  - [ ] `npm --prefix apps/memory-visualizer run test:e2e` passes.
  - [ ] Evidence files exist for sanitizer, corrupt JSONL, unwritable telemetry, missing telemetry, skip policy, UI route, no mutation controls, docker read-only mount.

  **QA Scenarios**:
  ```
  Scenario: Full automated verification passes
    Tool: Bash
    Steps: Run all Definition of Done commands sequentially.
    Expected: Every command exits 0; outputs stored under `.omo/evidence/`.
    Evidence: .omo/evidence/task-12-full-verification.txt

  Scenario: Secret-leak regression scan passes
    Tool: Bash
    Steps: Run tests and grep generated fixture/evidence outputs for `my-secret-password`, `secret-token`, `secret-cookie`, `Authorization`, `Cookie`, `token=`.
    Expected: Secret strings only appear in test source input fixtures, never in telemetry API responses or logged output fixtures.
    Evidence: .omo/evidence/task-12-secret-leak-scan.txt
  ```

  **Commit**: YES | Message: `test(visualizer): harden requests monitor verification` | Files: [`apps/memory-visualizer/fixtures/*`, tests, e2e, evidence references]

## Final Verification Wave (MANDATORY — after ALL implementation tasks)
> 4 review agents run in PARALLEL. ALL must APPROVE. Present consolidated results to user and get explicit "okay" before completing.
> **Do NOT auto-proceed after verification. Wait for user's explicit approval before marking work complete.**
> **Never mark F1-F4 as checked before getting user's okay.** Rejection or user feedback -> fix -> re-run -> present again -> wait for okay.
- [x] F1. Plan Compliance Audit — oracle
- [x] F2. Code Quality Review — unspecified-high
- [x] F3. Agent-Executed Playwright QA — unspecified-high (+ playwright). No manual visual inspection; artifacts must be screenshots/logs produced by the agent-run harness.
- [x] F4. Scope Fidelity Check — deep

## Commit Strategy
- Prefer one commit per TODO task after its tests pass.
- Commit messages listed per task are required defaults unless repository style suggests a more specific scope.
- Never commit secrets, generated huge telemetry logs, or `.omo/evidence` unless the repository already tracks evidence artifacts for this workflow.
- If a task spans multiple files, stage only files listed in that task and directly related tests/docs.

## Success Criteria
- Current visualizer becomes easier to maintain: `App.tsx` is thin and route implementations live in dedicated modules.
- Dashboard UX uses the selected concise Mem0-inspired operations-dashboard layout while retaining TencentDB visual identity and read-only purpose.
- Requests Monitor gives useful observability across Visualizer and Gateway sources without leaking secrets/content.
- Memory data remains read-only in visualizer deployments; telemetry has a separate writable path.
- All automated tests, safety checks, docker checks, build, and E2E pass.
- Final review agents approve and user explicitly accepts consolidated verification results.
