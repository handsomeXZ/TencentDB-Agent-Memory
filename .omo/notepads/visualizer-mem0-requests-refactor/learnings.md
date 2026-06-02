## 2026-06-01T15:04:06Z Task: session-start
Plan loaded: Memory Visualizer Mem0-Style Refactor + Requests Monitor.

Key constraints from plan:
- Preserve Vite/React + Node API sidecar; do not migrate to Next.js.
- Requests Monitor is observability-only, not a control surface.
- Memory/session/vector/domain data stays read-only; telemetry is separate operational append-only data.
- Store pathname only; never raw URL/query/body/response/headers/secrets/content.
- Gateway and Visualizer write separate JSONL files to avoid multi-process append contention.

## 2026-06-01 Task: Wave 1A Task 2 visualizer UI primitive/style exploration

Files inspected:
- apps/memory-visualizer/src/ui/styles.css
- apps/memory-visualizer/src/ui/App.tsx
- apps/memory-visualizer/src/ui/memory-evidence-panels.tsx
- apps/memory-visualizer/src/ui/persona-scene-panels.tsx
- apps/memory-visualizer/src/ui/App.ui-shell.test.tsx
- apps/memory-visualizer/src/ui/App.scene-routes.test.tsx
- apps/memory-visualizer/src/ui/App.memory-routes.test.tsx
- apps/memory-visualizer/src/ui/App.offload-gateway.test.tsx
- apps/memory-visualizer/package.json

Patterns identified:
- Visual identity is TencentDB dark parchment/glass: serif display/body fonts, warm ink/parchment tokens, smoky radial background, subtle fixed grid texture, glass panels with blur, amber/cool-blue accents, status colors for available/missing/partial/error/disabled.
- styles.css is currently token/reset/layout/component/state/route-specific in one file. Shared glass surfaces are grouped at lines 92-105; core layout at 79-90 and 131-239; state/card/table primitives at 231-349; route-specific scene/offload/memory/debug/form styles follow afterward.
- Class naming is semantic/kebab-case, mostly noun-role based: app-shell, shell-frame, shell-panel, hero-panel, route-panel, metric-card, table-card, state-card, stack-row, table-row, meta-label, table-label, route-copy. State is generally expressed by data-tone/data-status/data-active attributes.
- Repeated UI atoms exist across App.tsx, memory-evidence-panels.tsx, and persona-scene-panels.tsx: StateCard/LoadingState/ErrorState/WarningState/EmptyState, StatusBadge/CapabilityBadge/StatusPill, MetaPair, table header rows, table-card shells, json-hint pre blocks, summary rows, page controls.
- Safe primitives to add under apps/memory-visualizer/src/ui/components/ without behavior changes: StateCard plus LoadingState/ErrorState/WarningState/EmptyState wrappers; StatusBadge/CapabilityBadge; MetaPair with an `as` or variant option because App.tsx currently renders metric-card while memory-evidence-panels renders stack-row; Panel/Surface wrappers for shell-panel/table-card/metric-card only if they preserve exact element semantics; SectionHeader/TableHeaderRow; JsonHintCard; Button class wrapper only if native button props/disabled/type/onClick are passed through unchanged; PageControls can move only with existing text and pagination math preserved.
- Avoid extracting route/business logic yet: MemoryFilterBar, PathConfigurationForm, GatewayDebugFormSection, DebugResponsePanel, MermaidPreview, Persona/Scene/Memory/Evidence route panels contain behavioral state, API calls, or route-specific copy and should remain in route files during style extraction.
- Tests that should remain green after primitive/style extraction: App.ui-shell.test.tsx validates read-only banner/navigation/auth/settings copy; App.scene-routes.test.tsx validates overview metrics, persona summary, scene sorting/focus and empty scene warnings; App.memory-routes.test.tsx validates memory filters, JSONL fallback warnings, missing evidence details; App.offload-gateway.test.tsx validates Mermaid fallback and raw Gateway search text. These tests mostly assert text, route behavior, href/history, form interaction and sessionStorage, so element tags/accessible labels/text must remain stable.
- package.json confirms no Tailwind/Radix/Redux/Next dependencies; keep Vite React TypeScript with existing React/mermaid only.

Exact extraction guidance:
- First create ui/components/state-card.tsx, status-badge.tsx, meta-pair.tsx, json-hint-card.tsx, section-header.tsx, and optionally page-controls.tsx; export from ui/components/index.ts.
- Use existing class names unchanged and keep data-tone/data-status/data-active values unchanged.
- Do not alter copy, aria-labels, button labels, input names, route paths, sessionStorage key, buildSourceQueryString usage, Mermaid rendering, or API state handling.
- If MetaPair is unified, support both current presentations: metric-card variant for App.tsx/offload counters and stack-row variant for memory/evidence details. Do not force one markup everywhere in the first extraction.
- Keep styles.css tokens and class blocks intact initially; only reorganize with comments if needed. If splitting later, preserve cascade order: tokens/reset -> shell/layout -> shared surfaces/cards/state/table -> route-specific scene/offload/memory/debug/forms -> responsive.

## 2026-06-01 Task: Task 1/5 telemetry prerequisites exploration
- Gateway routing lives in src/gateway/server.ts: handleRequest parses URL once, uses pathname for routeKey/switch, leaves GET /health open, fail-closes /visualizer/* without Gateway apiKey, then applies optional Bearer auth before protected routes.
- Gateway DTOs live in src/gateway/types.ts and use serializable readonly-free interfaces with snake_case request/response field names for public HTTP payloads.
- Visualizer API routing lives in apps/memory-visualizer/src/server/index.ts: createVisualizerServer uses routeKey switch, Cache-Control no-store, health open, checkVisualizerAuth for /api/*, fixed read-only Gateway debug endpoints only, HttpError with stable error code.
- Visualizer DTO contracts live in apps/memory-visualizer/src/contracts/dashboard.ts and are mirrored under src/visualizer/contracts/dashboard.ts for root build imports; style is JsonValue, string-literal unions plus as const arrays, readonly interfaces, default factory helpers, JSON-serializable snapshots/pages.
- Existing tests to extend: src/gateway/server.test.ts for protected Gateway /visualizer/* API behavior; apps/memory-visualizer/src/server/server.test.ts for auth/routing/debug/error redaction; apps/memory-visualizer/src/contracts/dashboard.test.ts for serializable DTO contract defaults.
- Shared neutral telemetry module should avoid app-only imports. Recommended home: src/telemetry/request-telemetry.ts (or src/telemetry/index.ts) for RequestTelemetryRecord, RequestRouteKind, sanitize/classify helpers, append-only JSONL writer; app-local visualizer can mirror or import only if build boundaries allow. Keep Gateway and Visualizer JSONL paths separate.
- Route classifier should accept only method + pathname + status/duration metadata; never raw URL/search/body/headers. Prefer centralized classification to keep Gateway and Visualizer route labels consistent while preserving pathname-only storage.
- Verification commands: npm test -- src/gateway/server.test.ts; npm --prefix apps/memory-visualizer test -- src/server/server.test.ts src/contracts/dashboard.test.ts; npm --prefix apps/memory-visualizer run typecheck when touching visualizer contracts/server.

## 2026-06-01 Task: Wave 1A Task 1 telemetry contract/classifier
- Added neutral root-only telemetry contract in `src/telemetry/request-telemetry.ts`; it intentionally imports no Gateway, Visualizer, React, Vite, file IO, or app provider modules.
- Sanitizer input surface is pathname/query metadata only. Extra accidental fields such as headers/body/response_body are ignored by construction and are not copied into `SanitizedRequestLog`.
- Query handling keeps allowlisted key names only (`limit`, `offset`, `source`, `status`, `type`) and never stores query values or a raw query string.
- Route classifier accepts method plus normalized pathname and covers Gateway `/recall`, `/capture`, `/search/memories`, `/search/conversations`, `/session/end`, `/seed`, Visualizer `/visualizer/*`, generic `/api/*`, health/static/request-monitor skip routes, and unknown-route warnings.
- Gotcha: npm argument forwarding on this repo's `npm test -- ... -t` produced npm warnings, so final evidence files were regenerated with direct `npx vitest run ... --testNamePattern ...` while full verification still used `npm test`.
- Retry fix: `createSanitizedRequestLog` now derives allowlisted query keys from `input.path` when `input.query` is omitted, while still storing only the normalized pathname. `RequestTelemetrySummary` was aligned to the plan-required shape: `total`, `last24h`, `errorRate`, `p95LatencyMs`, `recent5xx`, `sources`, `warnings`.

## 2026-06-01 Task: Wave 1A Task 2 UI primitives implementation
- Extracted read-only UI primitives under apps/memory-visualizer/src/ui/components: StateCard wrappers, StatusBadge/CapabilityBadge, MetaPair with stack/metric variants, JsonHintCard, TableHeaderRow/SectionHeader, and PageControls.
- Preserved existing TencentDB dark parchment/glass identity by keeping current tokens and adding only semantic style hooks for app-layout, fixed-sidebar, content-grid, metric-row, compact-table, status-badge alias, and detail-drawer.
- MetaPair defaults to stack-row for memory/evidence/persona detail rows; App/offload/debug metric usages pass variant=metric to preserve metric-card presentation.
- Verification evidence saved to .omo/evidence/task-2-ui-primitives-tests.txt and .omo/evidence/task-2-ui-primitives-build.txt.

## 2026-06-02 Task: Wave 1A Task 3 App split
- `apps/memory-visualizer/src/ui/App.tsx` is now a thin composition file: it wires `useSourceQuery`, `useDashboardData`, `AuthGate`, `AppShell`, and the route renderer without embedding route bodies.
- Source-query/navigation behavior remains centralized around `buildRouteUrl`, `readLocationState`, `readSelectedSceneId`, and `readSelectedMemoryId`; the `sceneId` and `memoryId` extras are still propagated exactly through URL query parameters.
- Auth/session behavior remains centralized around the `tdai-memory-visualizer-api-key` sessionStorage key; the hook preserves stored-key retry, auth-not-configured handling, login validation, and logout clearing semantics.
- Route labels/paths remain unchanged and no Requests Monitor or grouped navigation was added in this task. Evidence saved to `.omo/evidence/task-3-app-split-tests.txt` and `.omo/evidence/task-3-app-split-build.txt`.

## 2026-06-02 Task: Wave 1A Task 3 App split
- `App.tsx` is now a thin composition layer around `useSourceQuery`, `useDashboardData`, `AuthGate`, `AppShell`, and route rendering; route paths, labels, source query propagation, selected scene/memory IDs, and `tdai-memory-visualizer-api-key` sessionStorage semantics were preserved.
- Shell/auth/navigation/dashboard loading helpers now live under app-local UI modules, while current route entrypoints live under `apps/memory-visualizer/src/ui/routes/*`.
- Verification evidence saved to `.omo/evidence/task-3-app-split-tests.txt` and `.omo/evidence/task-3-app-split-build.txt`.

## 2026-06-01 Task: Wave 1A Task 5 telemetry JSONL store
- Added append-only request telemetry storage in `src/telemetry/request-telemetry-store.ts`; Gateway and Visualizer records write to separate `request-logs.gateway.jsonl` and `request-logs.visualizer.jsonl` files derived from the sanitized `source` field.
- Directory resolution follows role-specific env precedence (`TDAI_GATEWAY_TELEMETRY_DIR` or `TDAI_VIS_TELEMETRY_DIR`, then `TDAI_TELEMETRY_DIR`) and disables telemetry with warnings when unset or when the resolved telemetry dir equals/nests under a configured memory data root/read-only mount.
- Writer intentionally never throws to callers; filesystem failures return `telemetry-write-failed` warnings so future Gateway/Visualizer wrappers can fail open.
- Reader is bounded without retention mutation: no delete/truncate/compact/rewrite, per-file newest valid record cap is 10,000, read window is 10MB, and oversized files emit `telemetry-file-too-large` while returning newest readable records.
- Page validation is endpoint-ready: default limit 50, cap 200, offset default 0, invalid/non-integer/negative values return typed 400-style validation objects rather than throwing.
- Summary calculation stays plan-aligned with `total`, `last24h`, `errorRate`, `p95LatencyMs`, `recent5xx`, `sources`, and `warnings`.

## 2026-06-02 Task: Wave 1A Task 5 fresh storage implementation pass
- Added concrete Task 5 changes in `src/telemetry/request-telemetry-store.ts` and `src/telemetry/request-telemetry-store.test.ts`; this pass is not a no-op and is independent of Gateway/Visualizer server integration.
- Storage remains append-only: implementation uses `mkdir` and `appendFile` for writes and does not import or call delete, truncate, rewrite, rotation, compaction, or retention cleanup operations.
- Reader reconstructs sanitized records from whitelisted fields only, so accidental extra JSONL fields are not returned to future APIs.
- Targeted telemetry verification passed with `npm test -- src/telemetry`; corrupt JSONL and unwritable fail-open evidence files were refreshed under `.omo/evidence/`.

## 2026-06-02 Task: Wave 1C Task 4 grouped shell navigation
- Grouped shell navigation now lives in `apps/memory-visualizer/src/ui/navigation.ts` as `NAVIGATION_GROUPS`, keeping `App.tsx` thin and leaving `route-registry.ts` as the single source of truth for concrete route labels/paths.
- `AppShell` renders group cards from that data and continues to build every nav href through `buildRouteUrl(...)`, so source query propagation remains aligned with the existing hook/navigation path instead of a shell-local string concatenation.
- The `Observability` group is intentionally structural-only in this task: it renders a reserved read-only group state with no `Requests Monitor` link, so Task 10 can add the real route later without exposing a broken clickable entry now.

## 2026-06-02 Task: Wave 1A Task 6 Gateway telemetry integration
- Gateway telemetry is wrapped once around `TdaiGateway.handleRequest` with a `finally` block, avoiding per-route append calls while preserving existing auth, CORS, health, and route response shapes.
- The Gateway passes pathname-only `path` plus a URLSearchParams containing only allowlisted query key names into `createSanitizedRequestLog`; raw URL/search/body/header/content values are not passed to the persisted record.
- Gateway writes use `appendRequestTelemetryLog` with `source: "gateway"`, `env: process.env`, and the data directory as an unsafe root, so `TDAI_GATEWAY_TELEMETRY_DIR` wins over `TDAI_TELEMETRY_DIR`, unset env disables telemetry, and Gateway/Visualizer JSONL files remain split by source.
- Tests cover 200 `/recall`, 401 unauthorized, 404 unknown, thrown 500 via invalid visualizer pagination, `/search/memories` secret-bearing body/query/header sanitization, skip policy for `/health` plus request monitor paths, env precedence/disabled behavior, and fail-open append failure when the telemetry path is not a directory.

## 2026-06-02 Task: Wave 1A Task 7 Visualizer telemetry integration
- Visualizer API telemetry now mirrors the Gateway's single-wrapper pattern in `createVisualizerServer`: request metadata is captured once, existing auth/route/body handling runs unchanged, and a `finally` block appends a sanitized `source: "visualizer-api"` record when configured.
- The Visualizer passes only `requestUrl.pathname` plus a rebuilt URLSearchParams containing allowlisted key names into `createSanitizedRequestLog`; debug recall/search request bodies, bearer tokens, raw query values, and response payloads never enter the telemetry input.
- `TDAI_VIS_TELEMETRY_DIR` resolves before `TDAI_TELEMETRY_DIR` through the shared store; unset telemetry remains disabled, and Visualizer records write to `request-logs.visualizer.jsonl` instead of the Gateway JSONL file.
- The skip policy is shared with the contract: `/health`, `/api/requests`, `/api/requests/summary`, and static assets produce no Visualizer telemetry even when the Visualizer server returns an auth or 404 response for those direct server paths.

## 2026-06-02T09:47:45.9269760+08:00 Task: Wave 1A Task 9 Gateway request monitor endpoints
- Gateway now exposes protected `GET /visualizer/requests` and `GET /visualizer/requests/summary` using shared `readRequestTelemetryPage` and `readRequestTelemetrySummary` rather than ad-hoc JSONL parsing.
- Important integration detail: the Gateway must resolve one telemetry directory first, then read both `request-logs.gateway.jsonl` and `request-logs.visualizer.jsonl` from that same directory; otherwise source-specific env resolution can silently drop the Visualizer file when only `TDAI_GATEWAY_TELEMETRY_DIR` is set.
- Endpoint pagination errors stay sanitized by returning only the shared validation message (`Telemetry limit/offset must be a non-negative integer.`) and not surfacing validation detail payloads.
- Tests seed unsafe extra fields into raw JSONL fixtures to confirm the store coercion layer strips them from the DTO response, preserving the pathname-only telemetry contract.

## 2026-06-02T12:00:00Z Task: Wave 1A Task 8 Visualizer request telemetry APIs
- `apps/memory-visualizer/src/server/index.ts` now exposes authenticated read-only `GET /api/requests` and `GET /api/requests/summary` by delegating directly to shared store readers, so Gateway and Visualizer JSONL files merge and sort newest-first in one place.
- Endpoint warnings are intentionally redacted to `{ code, message, source, detail: null }` before returning to clients; this preserves operability signals while avoiding leakage of local telemetry file paths or protected roots from shared store warnings.
- Pagination validation stays store-owned: default `limit=50`, `offset=0`, max `limit=200`, invalid or negative values return HTTP 400 `invalid-telemetry-pagination`, and capped limits still return HTTP 200 with a warning.

## 2026-06-02T10:17:39.9933447+08:00 Task: Wave 1A Task 10 Requests Monitor UI route
- Added a dedicated `requests-monitor-route.tsx` module registered through `route-registry.ts`, `navigation.ts`, and `routes/app-routes.tsx`, keeping `App.tsx` thin while finally activating the `Observability` navigation group with a real read-only page.
- The UI consumes `client.getRequests(...)` and `client.getRequestsSummary(...)` from the shared dashboard API client, then renders a Mem0-style compact operations surface: top metrics, source buckets, filter/refresh strip, compact request table, server-backed pagination, and a sanitized detail drawer that intentionally limits itself to path, route pattern, query key names, status/auth metadata, and warning codes.
- E2E gotcha: the first Playwright assertion for `Gateway API` accidentally matched hidden `<option>` nodes in the filter row. Anchoring the browser check to visible request rows and drawer content made the verification stable while still proving the real browser surface works and saving `.omo/evidence/task-10-requests-monitor.png`.

## 2026-06-02 Task: Wave 1A Task 11 standalone telemetry storage docs and checks
- Standalone Docker now treats telemetry as a separate operational volume: `tdai_memory_data` stays mounted read-only in the visualizer at `/data/memory-tdai:ro`, while `tdai_request_telemetry` is mounted writable at `/data/request-telemetry` with shared default `TDAI_TELEMETRY_DIR=/data/request-telemetry`.
- The key operator rule is path separation, not just env naming: `TDAI_GATEWAY_TELEMETRY_DIR` and `TDAI_VIS_TELEMETRY_DIR` may override the shared default, but telemetry must never equal or nest under `/data/memory-tdai` because that would blur read-only memory inspection with append-only request logs.
- Docs now spell out Requests Monitor scope and privacy: observability-only, skips health/static/request monitor routes by default, stores pathname plus allowlisted query key names only, and never stores raw URL/query/body/response/headers/prompts/tokens/secrets/content.

## 2026-06-02 Task: Visualizer E2E fixture cwd fix
- `npm --prefix apps/memory-visualizer run test:e2e` executes Playwright with `apps/memory-visualizer` as the working directory, so specs that used `path.resolve("apps/memory-visualizer/fixtures/...")` accidentally resolved to `apps/memory-visualizer/apps/memory-visualizer/fixtures/...` and loaded empty degraded fixtures.
- The fix keeps `repoRoot` screenshot behavior unchanged and adds a harness-level `resolveVisualizerFixturePath(...)` helper that resolves from the app's real fixture root via `import.meta.url`, making degraded-fixture specs and shell fallback setup cwd-independent.

## 2026-06-02 Task: Task 12 full verification hardening
- Existing coverage already exercised complete telemetry, empty/missing telemetry, corrupt/oversized telemetry, sanitized Gateway/Visualizer request APIs, and E2E Requests Monitor rendering; Task 12 only tightened deterministic test fixtures and assertions for exact dangerous literals (`my-secret-password`, `secret-token`, `secret-cookie`, `Authorization`, `Cookie`, `token=`).
- Added explicit Requests Monitor no-mutation-control checks in unit/E2E coverage; production route AST search shows the only button remains the read-only refresh control.
- Full DoD verification evidence is UTF-8 readable at `.omo/evidence/task-12-full-verification.txt` with all command exit codes 0 and `OverallExitCode: 0`.
- Secret-leak evidence is UTF-8 readable at `.omo/evidence/task-12-secret-leak-scan.txt`; it generated temp secret-bearing telemetry API responses, scanned responses plus full verification evidence, and recorded zero forbidden hits before cleaning temp scripts/files.

## 2026-06-02 Task: Task 12 final E2E hardening addendum
- Background coverage review suggested making Requests Monitor UI/E2E coverage explicit for empty and corrupt telemetry states, so `apps/memory-visualizer/e2e/requests-monitor.spec.ts` now covers happy-path telemetry, empty/missing telemetry warnings, and corrupt telemetry warnings with unsafe fields absent from the browser surface.
- After the E2E hardening addendum, full DoD evidence was regenerated: `.omo/evidence/task-12-full-verification.txt` is UTF-8 readable, all listed commands have exit code 0, and Playwright now records 12 passed tests.
- Secret-leak evidence was regenerated after the final DoD run: `.omo/evidence/task-12-secret-leak-scan.txt` records generated telemetry API page/summary status 200, zero forbidden hits in generated responses, zero forbidden hits in the full verification evidence, and removal of the temporary scan script.
