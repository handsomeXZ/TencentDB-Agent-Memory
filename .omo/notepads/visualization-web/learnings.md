## Task 1 - Scaffold isolated visualizer app

- Root `tsdown.config.ts` only targets plugin/server Node outputs under root `dist/`; the visualizer scaffold can stay fully app-local without root workspace or root script changes.
- The visualizer scaffold uses `npm --prefix apps/memory-visualizer ...` with app-local Vite, React, TypeScript, Vitest, Playwright, and Mermaid dependencies.
- `safety:readonly` scans production code under `src/` only, excluding tests and its own script, so later tasks can extend production checks without creating script self-matches.
- Playwright defaults can write `test-results/.last-run.json` relative to the invocation working directory; with `npm --prefix`, set `outputDir` in app-local `playwright.config.ts` so E2E artifacts stay under `apps/memory-visualizer/`.

## Task 2 - Read-only dashboard contracts

- Visualizer contracts now stay app-local in `apps/memory-visualizer/src/contracts/dashboard.ts`; they map root L1/L0/Profile/offload concepts by field shape only and do not import root runtime modules.
- The stable DTO layer uses readonly object properties and readonly arrays so later parser/provider/server/UI tasks can pass serializable `/api/*` payloads without depending on mutable upstream internals.
- `CapabilityReport` explicitly models all degraded states needed by later UI work: `available`, `missing`, `partial`, `error`, and `disabled`.

## Task 3 - Representative read-only fixtures

- Visualizer fixtures now live under `apps/memory-visualizer/fixtures/` with nine stable scenario names; each scenario has a tiny `fixture.json` manifest so later parser tests can depend on deterministic paths without consulting external docs.
- The complete fixture mirrors the documented seed output shape (`conversations/`, `records/`, `scene_blocks/`, `.metadata/`) and the offload layout (`refs/`, `mmds/`, `offload-<session>.jsonl`, `state.json`) using only tiny synthetic records and IDs.
- The fixture secret scan intentionally traverses only `apps/memory-visualizer/fixtures/**`, not scripts, so the forbidden pattern list can be enforced against sample content without self-reporting on the scanner source.

## Task 4 - Tolerant local file parsers

- Parser APIs now accept app-local `DataSourceConfig` and derive all reads from its paths, keeping the visualizer boundary independent from root runtime types.
- Fixture records use both dashboard DTO field names and root writer field names, so parsers map tolerant aliases such as `recordId`/`id`, `sceneName`/`scene_name`, and `resultRef`/`result_ref`.
- Offload MMD fixtures include YAML-ish front matter rather than only the root `%%{...}%%` metadata shape; the parser preserves invalid Mermaid as fallback raw preview metadata and emits warnings instead of failing.

## Task 5 - DashboardDataProvider aggregation

- `LocalDashboardDataProvider` stays app-local under `apps/memory-visualizer/src/providers/` and composes Task 4 parser output into the Task 2 `DashboardSnapshot` contract without importing root runtime modules.
- Aggregation helpers expose counts, distributions, scene heat, recent timeline, evidence links, offload canvas summaries, and offset/limit pages outside the snapshot so the core DTO remains stable and serializable.
- Missing `dataDir` produces a safe empty snapshot with provider warnings, while absent `offloadRootPath` disables only the offload capability and keeps other parsed layers available.
- Config env resolution now prioritizes the plan-required `TDAI_VIS_DATA_DIR`, `TDAI_VIS_OFFLOAD_ROOT`, `TDAI_VIS_GATEWAY_URL`, and `TDAI_VIS_GATEWAY_API_KEY` names before fallback aliases and app-local injected config.

## Task 11 - Operation and boundary documentation

- Visualizer docs now state the required source resolution order as request or UI path, then environment variables, then app-local config, then empty state and default examples, matching the provider's read-only config flow.
- The app-local docs checker validates required headings, exact root-run commands, the four primary `TDAI_VIS_*` env vars, supported view names, and explicit no-write boundary phrases without depending on brittle paragraph formatting.
- Gateway `/search/*` is documented as raw debug text rather than structured primary data, which keeps the visualizer positioned as a white-box local inspector instead of a write-capable product surface.

## Task 6 - Read-only local API server and Gateway debug adapter

- `createVisualizerServer` remains app-local under `apps/memory-visualizer/src/server/` and dispatches API routes through an explicit method/path allow-list rather than exposing file read or generic proxy routes.
- Server route data comes from `LocalDashboardDataProvider` snapshot/page helpers, so `/api/snapshot`, layer page APIs, offload, and evidence responses share the same parser/provider sanitization boundary.
- Gateway debug is isolated in an app-local fetch adapter that only targets `/health`, `/recall`, `/search/memories`, and `/search/conversations`; search results stay as raw formatted strings and timeout/non-JSON/500 cases return warning payloads with secret redaction.
- Query path overrides are normalized beneath the already configured `dataDir`/offload root, and traversal segments like `..` are rejected before provider resolution.

## Task 7 - UI shell, navigation, and status model

- The shell can stay fully app-local without a router dependency by using browser `history.pushState`, a route table, and query-string sourced read-path state; that keeps the navigation testable while preserving local-only replacement boundaries.
- UI code can consume the existing read-only DTOs without importing Node runtime modules by using contract types plus app-local `/api/*` fetch helpers, while degraded capability semantics come directly from `CapabilityReport` and provider warnings.
- Playwright shell smoke became simplest when the test owned a tiny harness that serves built `dist/` assets and proxies `/api/*` to `createVisualizerServer`, which also made root `.omo/evidence/` screenshots deterministic for both complete and missing-data scenarios.
- Under `CapabilityReport`, `generatedAt` is the only non-object value, so `Object.values(report)` needs a precise local `CapabilityState` type guard before reading `.status` or `.label`; relying on `'status' in value` alone is not enough for TypeScript to exclude the string branch.
- App-local Vite React projects may still need a local `src/vite-env.d.ts` with `declare module "*.css"` for side-effect CSS imports when the scaffold does not already ship one.

## Task 8 - Persona and Scene Map views

- Scene Map cannot rely solely on parsed `scene_blocks/*.md` files when fixtures or real datasets only preserve `scene_index` entries; keeping index-only fallback summaries in the parser lets the read-only UI still render missing-persona scenes without inventing write paths.
- UI-side snapshot summarization should stay inside `src/ui/**` helpers rather than importing provider aggregation modules, because provider entrypoints pull Node-only parser dependencies that Vite will externalize in the browser build.
- Stable Playwright assertions for the visualizer are easiest when they target unique headings or use `.first()` on repeated content like heat badges and source hints, since the spotlight panel and scene cards intentionally repeat the same scene metadata.

## Task 9 - Memory Explorer and Evidence Drill-down

- Memory Explorer works best as a page-aware view: fetch current `offset`/`limit` windows from `/api/memories`, then label filters and summaries as current-page results so the UI stays honest about lazy loading instead of implying a permanently complete in-memory dataset.
- Evidence Drill-down can stay app-local and read-only by joining three already-available DTO surfaces on the client: paged `StructuredMemorySummary`, paged `EvidenceLinkIndexEntry`, and paged `ConversationEvidence`; offload refs can then be added as a soft session-key correlation rather than a new API contract.
- Deterministic Task 9 coverage needed fixture data aligned with the real 0-100 L1 priority contract, so adding `persona` memories at `85` and `92` in `complete-data-dir` was cleaner than inventing UI-only scaling or weakening the `priority>=80` acceptance path.

## Task 10 - Offload Task Canvas and Search/Recall Debug (2026-05-30)

- Offload Mermaid rendering needed one more DTO field at the parser boundary: preserving a sanitized `mermaidSource` string inside `rawMetadata` lets the browser render valid graphs with app-local Mermaid while still falling back to raw preview text for invalid fixtures.
- The Search/Recall Debug route works best as a request/response workbench rather than a summary card: separate request panels, live health probe output, and an explicitly labeled raw `/search/*` text panel make the gateway boundary honest without implying structured primary data.
- Playwright fixture paths in this app should resolve from the app root, not the repo root, because `npm --prefix apps/memory-visualizer run test:e2e` executes Playwright inside `apps/memory-visualizer/`; using `path.resolve("fixtures/...")` keeps fixture-backed browser tests deterministic.

## Task 12 - Automated QA, safety, and regression verification

- Full app-local verification needs the unfiltered `npm --prefix apps/memory-visualizer run test:e2e` command because route interactions across shell, scene, memory, offload, and gateway debug specs can expose strict-mode collisions that filtered runs miss.
- The authoritative read-only boundary remains `safety:readonly`; broad grep is still useful as a Task 12 audit layer, but it can report production text false positives such as `unlinked` and component names containing `rm`.
- Root regression checks can reveal unrelated-but-real gate failures outside the visualizer path; when they block Task 12, the safest repair is the smallest root fix that makes the existing root test expectation pass without touching visualizer scope.
