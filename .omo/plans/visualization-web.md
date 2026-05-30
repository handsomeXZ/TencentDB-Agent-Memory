# TencentDB Agent Memory 可视化 Web 实现方案

## TL;DR
> **Summary**: 新增一个独立、只读、可替换的 Web Dashboard，用于把 TencentDB-Agent-Memory 的 L3 Persona、L2 场景、L1 结构化记忆、L0 证据和短期 Offload Mermaid 画布组织成可浏览的记忆地图。实现必须旁路读取现有 Gateway API 与 `dataDir` 白盒文件，不改核心记忆管线、schema、hook 或写入路径。
> **Deliverables**:
> - `apps/memory-visualizer/` 独立 Web app 与只读本地 API server
> - `DashboardDataProvider` + DTO + capability/warning 模型
> - metadata/profile/records/conversations/offload/Gateway 只读 adapters
> - Overview、Scene Map、Memory Explorer、Evidence Drill-down、Offload Task Canvas、Search/Recall Debug、Settings/Status 页面
> - parser/adapter/UI/e2e/safety-readonly 测试与文档
> **Effort**: Large
> **Parallel**: YES - limited parallelism, 9 dependency batches
> **Critical Path**: Task 1 → Task 2 → Task 3 → Task 4 → Task 5 → Task 6 → Task 7 → Tasks 8-10 → Task 12

## Context
### Original Request
用户要求：“编写这份可视化WEB的实现方案”。此前用户补充要求：方案需要概括可视化内容和路线，并分析当前项目如何在不大规模改动代码、适配后续更新提交的情况下实现这些内容；同时考虑官方后续可能自己推出可视化工具。

### Interview Summary
- 目标不是直接实现，而是输出可交给执行 Agent 的实现计划。
- 可视化核心路线：`L3 Persona → L2 Scene → L1 Memory → L0 Evidence`，并补充短期 Offload Mermaid/MMD 任务画布。
- 实现策略必须非侵入：只读、旁路、独立 Web，不改核心 pipeline/schema/hooks/write path。
- 数据来源优先级：本地 `dataDir` 白盒文件为主，Gateway API 为健康检查与搜索/召回调试辅助。
- Gateway `/search/*` 当前返回格式化字符串，不得强行作为结构化主数据源。
- 官方未来可能推出可视化工具，因此本 Web 必须通过 adapter/DTO 隔离，后续可替换、降级为导出器或下线。

### Metis Review (gaps addressed)
- 收束为“薄 UI + 只读 adapter + capability/warning 模型”。
- 默认新增路径为 `apps/memory-visualizer/`，不污染 `src/core`、`src/gateway`、`src/offload`。
- 固定只读数据源优先级：metadata → scene/persona → records/conversations → offload → Gateway debug。
- 明确禁止编辑、删除、重索引、capture、seed、session-end、自动迁移、数据库管理器。
- 增加 `DashboardDataProvider` 和 DTO 边界，保障官方工具发布后的可替换性。
- 增加静态只读安全检查：生产代码不得调用危险 Gateway 端点，不得使用文件写操作。

### Oracle Phase 1 Verification
Oracle 返回 `VERDICT: GO`。非阻塞提醒已纳入本计划：明确 `dataDir`/offload 路径发现与手动配置优先级；所有 parser 宽容解析并返回 warnings；前端技术栈选择最小依赖且不影响现有 `tsdown` 插件构建。

## Work Objectives
### Core Objective
实现一个仓库内独立的只读 Web Dashboard，使人可以通过总览、场景、记忆、证据和短期任务画布理解并管理当前记忆状态，同时不改变任何现有记忆生产、检索、同步或压缩行为。

### Deliverables
- `apps/memory-visualizer/package.json`、`tsconfig.json`、`vite.config.ts`、测试配置与脚本。
- `apps/memory-visualizer/src/server/`：只读 Node HTTP/Vite middleware server 与 API routes。
- `apps/memory-visualizer/src/providers/`：`DashboardDataProvider`、本地文件 adapters、Gateway debug adapter。
- `apps/memory-visualizer/src/contracts/`：内部 DTO、capability、warning 类型。
- `apps/memory-visualizer/src/parsers/`：metadata、scene/persona、L1/L0 JSONL、offload、Mermaid/MMD parser。
- `apps/memory-visualizer/src/ui/`：React/Vite 页面与组件。
- `apps/memory-visualizer/fixtures/`：正常、缺失、损坏、空数据、offload 异常等测试夹具。
- `apps/memory-visualizer/scripts/check-readonly.mjs`：Task 1 创建的只读安全静态检查，后续任务持续复用。
- `docs/visualization-web.md`：使用方式、边界、兼容/替换策略。

### Definition of Done (verifiable conditions with commands)
- `npm --prefix apps/memory-visualizer install` succeeds from a clean checkout.
- `npm --prefix apps/memory-visualizer test` passes parser/adapter/unit tests.
- `npm --prefix apps/memory-visualizer run test:e2e` passes UI smoke tests against fixtures.
- `npm --prefix apps/memory-visualizer run build` produces a production bundle/server without touching root `dist/`.
- `npm --prefix apps/memory-visualizer run safety:readonly` passes static checks for forbidden write APIs and dangerous Gateway endpoints.
- `npm test` at repo root still passes existing project tests.
- `npm run build` at repo root still passes and remains scoped to existing plugin/scripts build unless a deliberate root script is added and documented.

### Must Have
- Independent app path: `apps/memory-visualizer/`.
- Minimal stack decision: **Vite + React + TypeScript + Node native HTTP + Vitest + Playwright + Mermaid** inside the app package only.
- No root package workspace requirement for MVP; use `npm --prefix apps/memory-visualizer ...` commands.
- Manual path configuration in UI and CLI args/env: `TDAI_VIS_DATA_DIR`, `TDAI_VIS_OFFLOAD_ROOT`, `TDAI_VIS_GATEWAY_URL`, `TDAI_VIS_GATEWAY_API_KEY`.
- Path discovery priority:
  1. Explicit UI/API request value
  2. Environment variable
  3. App config file under app-local config dir
  4. Documented default examples only; no hard-coded user-specific path
- Read-only data loading from `dataDir` and optional offload root.
- Capability report for every layer: metadata, persona, scenes, L1 records, L0 conversations, offload, Gateway.
- Parser warnings and partial data rendering instead of throwing whole-dashboard errors.
- Search/Recall Debug page treats Gateway `/search/*` responses as raw formatted text.
- Evidence drill-down links L1 → source IDs where available → L0 snippets → offload `result_ref` where available.
- Large data handling: pagination/lazy loading for records, conversations, refs, and MMD files.

### Must NOT Have (guardrails, AI slop patterns, scope boundaries)
- No memory editing, deletion, merging, reindexing, profile sync writes, scene file writes, persona writes.
- No calls to Gateway write-like endpoints in production code: `/capture`, `/session/end`, `/seed`.
- No writes to `dataDir`, offload root, `vectors.db`, `records/`, `conversations/`, `scene_blocks/`, `persona.md`, `mmds/`, `refs/`, `.metadata/`.
- No SQLite/TCVDB schema migration or mutation.
- No changes to `src/core/**`, `src/offload/**`, `src/gateway/**`, `index.ts`, or OpenClaw hook behavior for MVP.
- No raw embedding/vector payload display; only derived stats, counts, similarity labels, and warnings.
- No production auth/multi-tenant/remote hosting scope in v1; local-only dashboard with optional Gateway bearer token for debug reads.
- No dependency on official future visualization internals; use adapter boundaries so the app can be replaced.

## Verification Strategy
> ZERO HUMAN INTERVENTION - all verification is agent-executed.
- Test decision: tests-after + Vitest/Playwright within `apps/memory-visualizer`, preserving root Vitest tests.
- QA policy: Every task has agent-executed scenarios.
- Evidence: `.omo/evidence/task-{N}-{slug}.{ext}`.
- Safety policy: `safety:readonly` is mandatory before completion and must fail if production code imports or calls write APIs / dangerous endpoints.

## Execution Strategy
### Parallel Execution Waves
> This plan has intentionally limited parallelism because app scaffold → contracts → fixtures → parsers → provider → server → UI shell are real serial dependencies.
> Only Wave 6 and Wave 8 contain safely parallel tasks. Do not dispatch tasks in the same numbered wave unless their `Parallelization` line says `Can Parallel: YES`.

Wave 1: Task 1 app scaffold.
Wave 2: Task 2 contracts/DTOs.
Wave 3: Task 3 fixtures + fixture validation scripts.
Wave 4: Task 4 file parsers.
Wave 5: Task 5 provider aggregation.
Wave 6: Task 6 Gateway debug adapter/API server + Task 11 docs (parallel).
Wave 7: Task 7 UI shell/status.
Wave 8: Task 8 scene/persona pages + Task 9 memory/evidence pages + Task 10 offload/search pages (parallel).
Wave 9: Task 12 complete QA/safety/e2e/root regression.

### Dependency Matrix (full, all tasks)
| Task | Depends On | Blocks |
|---|---|---|
| 1 | None | 2, 3, 4, 6, 7, 12 |
| 2 | 1 | 4, 5, 6, 7, 8, 9, 10 |
| 3 | 1, 2 | 4, 5, 8, 9, 10, 12 |
| 4 | 1, 2, 3 | 5, 8, 9, 10 |
| 5 | 2, 4 | 6, 7, 8, 9, 10, 11 |
| 6 | 1, 2, 5 | 7, 10, 12 |
| 7 | 1, 2, 5, 6 | 8, 9, 10 |
| 8 | 4, 5, 7 | 12 |
| 9 | 4, 5, 7 | 12 |
| 10 | 4, 5, 6, 7 | 12 |
| 11 | 1, 2, 5 | 12 |
| 12 | 1-11 | Final Verification |

### Agent Dispatch Summary (wave → task count → categories)
| Wave | Tasks | Categories |
|---|---:|---|
| 1 | 1 | unspecified-high |
| 2 | 1 | unspecified-high |
| 3 | 1 | quick |
| 4 | 1 | unspecified-high |
| 5 | 1 | unspecified-high |
| 6 | 2 | unspecified-high, writing |
| 7 | 1 | visual-engineering |
| 8 | 3 | visual-engineering |
| 9 | 1 | unspecified-high |

## TODOs
> Implementation + Test = ONE task. Never separate.
> EVERY task MUST have: Agent Profile + Parallelization + QA Scenarios.

- [x] 1. Scaffold isolated visualizer app

  **What to do**: Create `apps/memory-visualizer/` with its own `package.json`, TypeScript config, Vite config, Vitest config, Playwright config, app-local README stub, empty `src/{server,providers,contracts,parsers,ui,utils}` directories, and `scripts/check-readonly.mjs`. Choose stack exactly: Vite + React + TypeScript + Node native HTTP + Vitest + Playwright + Mermaid. Scripts must include `dev`, `build`, `test`, `test:e2e`, `safety:readonly`, and `typecheck`. `safety:readonly` must be a real static checker from Task 1 that scans production visualizer code for forbidden file-write APIs and forbidden Gateway endpoints; later tasks may extend patterns, but Task 1 must make it executable. Do not add root workspaces or modify root scripts unless absolutely necessary; default commands use `npm --prefix apps/memory-visualizer ...`.
  **Must NOT do**: Do not modify root `tsdown.config.ts`, root `src/**`, root `index.ts`, OpenClaw hooks, core package exports, or root `dist/`. Do not add global frontend dependencies to the root package.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - Reason: project scaffolding and build isolation require careful package boundary decisions.
  - Skills: [] - no domain-specific skill required.
  - Omitted: [`frontend-ui-ux`] - UI design is not implemented in this scaffold task.

  **Parallelization**: Can Parallel: NO | Wave 1 | Blocks: 2, 3, 4, 6, 7, 12 | Blocked By: None

  **References** (executor has NO interview context - be exhaustive):
  - Pattern: `package.json:22-38` - existing root scripts; avoid changing unless necessary.
  - Pattern: `package.json:87-99` - current root dependencies are backend/plugin oriented; keep web deps app-local.
  - Pattern: `package.json:131-137` - existing devDependencies include TypeScript/Vitest but do not assume root workspace.
  - Pattern: `tsdown.config.ts:13-59` - existing plugin build targets; do not wire web into `tsdown`.

  **Acceptance Criteria** (agent-executable only):
  - [ ] `npm --prefix apps/memory-visualizer install` exits 0.
  - [ ] `npm --prefix apps/memory-visualizer run typecheck` exits 0.
  - [ ] `npm --prefix apps/memory-visualizer run build` exits 0 and writes only inside `apps/memory-visualizer/dist/`.
  - [ ] `npm --prefix apps/memory-visualizer run safety:readonly` exits 0 and scans app production directories.
  - [ ] `npm run build` at repository root still exits 0.

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```
  Scenario: App package builds independently
    Tool: Bash
    Steps: Run `npm --prefix apps/memory-visualizer install`; run `npm --prefix apps/memory-visualizer run build`; inspect command exit codes.
    Expected: Both commands exit 0; generated files stay under `apps/memory-visualizer/dist/`.
    Evidence: .omo/evidence/task-1-scaffold-build.txt

  Scenario: Root plugin build remains unaffected
    Tool: Bash
    Steps: Run `npm run build` from repository root.
    Expected: Existing root build exits 0 and does not require web app dependencies to be installed globally.
    Evidence: .omo/evidence/task-1-root-build.txt

  Scenario: Read-only safety script is executable from scaffold
    Tool: Bash
    Steps: Run `npm --prefix apps/memory-visualizer run safety:readonly`.
    Expected: Command exits 0 and reports the production directories scanned; no placeholder/no-op script is accepted.
    Evidence: .omo/evidence/task-1-readonly-safety.txt
  ```

  **Commit**: NO | Message: `feat(visualizer): scaffold isolated web app` | Files: [`apps/memory-visualizer/**`]

- [x] 2. Define read-only dashboard contracts and DTOs

  **What to do**: Add `apps/memory-visualizer/src/contracts/dashboard.ts` defining stable internal DTOs and interfaces: `DashboardDataProvider`, `PersonaSummary`, `SceneBlockSummary`, `StructuredMemorySummary`, `ConversationEvidence`, `OffloadCanvas`, `GatewayStatus`, `CapabilityReport`, `ParserWarning`, `DashboardSnapshot`, `DataSourceConfig`. Include explicit `readonly` semantics in comments and type names where useful. Add contract unit tests verifying DTO defaults and `CapabilityReport` statuses (`available`, `missing`, `partial`, `error`, `disabled`).
  **Must NOT do**: Do not import types from `src/core/**` directly into UI contracts; these DTOs must be app-local and stable even if upstream internals change.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - Reason: contract design determines long-term replaceability.
  - Skills: [] - no specific skill required.
  - Omitted: [`frontend-ui-ux`] - this is architecture/data contract work, not visual design.

  **Parallelization**: Can Parallel: NO | Wave 2 | Blocks: 3, 4, 5, 6, 7, 8, 9, 10 | Blocked By: 1

  **References**:
  - API/Type: `src/core/store/types.ts:40-97` - L1 result/row fields to map, without importing directly.
  - API/Type: `src/core/store/types.ts:103-163` - L0 record/search/group fields to map.
  - API/Type: `src/core/store/types.ts:200-212` - ProfileRecord concept for L2/L3 summaries.
  - API/Type: `src/offload/types.ts:11-28` - OffloadEntry fields to map into `OffloadCanvas` and evidence links.
  - API/Type: `src/offload/mmd-meta.ts:6-16` - MMD metadata shape for task canvas summaries.

  **Acceptance Criteria**:
  - [ ] `npm --prefix apps/memory-visualizer test -- contracts` exits 0.
  - [ ] `npm --prefix apps/memory-visualizer run typecheck` exits 0.
  - [ ] No file under `apps/memory-visualizer/src/contracts/` imports from `../../../src/core`, `../../../src/gateway`, or `../../../src/offload`.

  **QA Scenarios**:
  ```
  Scenario: Contracts compile without upstream imports
    Tool: Bash
    Steps: Run `npm --prefix apps/memory-visualizer run typecheck`; run app-local test filter for contracts.
    Expected: Typecheck and tests pass; contracts are app-local.
    Evidence: .omo/evidence/task-2-contracts-typecheck.txt

  Scenario: Capability statuses cover degraded states
    Tool: Bash
    Steps: Run `npm --prefix apps/memory-visualizer test -- contracts`.
    Expected: Tests assert statuses for available, missing, partial, error, disabled.
    Evidence: .omo/evidence/task-2-capability-tests.txt
  ```

  **Commit**: NO | Message: `feat(visualizer): define read-only dashboard contracts` | Files: [`apps/memory-visualizer/src/contracts/**`]

- [x] 3. Add representative read-only data fixtures

  **What to do**: Create `apps/memory-visualizer/fixtures/` with deterministic fixture directories: `complete-data-dir/`, `missing-metadata/`, `corrupt-json/`, `empty-scenes/`, `missing-persona/`, `empty-conversations/`, `offload-invalid-mermaid/`, `offload-missing-refs/`, `windows-paths/`. Fixtures must follow documented seed layout and offload layout. Include tiny records only; no secrets or real user data. In this same task, create `apps/memory-visualizer/scripts/validate-fixtures.mjs` and `apps/memory-visualizer/scripts/check-fixture-secrets.mjs` so Task 3 acceptance is executable immediately; Task 12 only reruns and hardens these checks.
  **Must NOT do**: Do not copy real local memory files, API keys, tokens, or private conversations into fixtures.

  **Recommended Agent Profile**:
  - Category: `quick` - Reason: fixture creation is bounded and file-oriented.
  - Skills: [] - no specialized skill needed.
  - Omitted: [`frontend-ui-ux`] - no UI work.

  **Parallelization**: Can Parallel: NO | Wave 3 | Blocks: 4, 5, 8, 9, 10, 12 | Blocked By: 1, 2

  **References**:
  - Pattern: `src/cli/README.md:141-153` - seed output directory structure to mimic.
  - Pattern: `src/cli/README.md:155-173` - manifest example fields.
  - Pattern: `src/offload/storage.ts:1-9` - offload storage isolation and file purposes.
  - Pattern: `src/offload/storage.ts:22-53` - offload directory/file names: refs, mmds, offload JSONL, state.
  - Pattern: `src/core/scene/scene-format.ts:5-15` - scene block meta fields.

  **Acceptance Criteria**:
  - [ ] `node apps/memory-visualizer/scripts/validate-fixtures.mjs` exits 0.
  - [ ] Fixture content contains no strings matching `apiKey`, `Bearer `, `TDAI_GATEWAY_API_KEY=`, or `PRIVATE_KEY=`.
  - [ ] Fixture directory names match the list in this task.

  **QA Scenarios**:
  ```
  Scenario: Fixtures match expected layouts
    Tool: Bash
    Steps: Run `node apps/memory-visualizer/scripts/validate-fixtures.mjs`.
    Expected: Validator exits 0 and reports all fixture directories present.
    Evidence: .omo/evidence/task-3-fixture-validation.txt

  Scenario: Fixtures contain no obvious secrets
    Tool: Bash
    Steps: Run `node apps/memory-visualizer/scripts/check-fixture-secrets.mjs` or equivalent app-local script.
    Expected: Script exits 0; no forbidden secret patterns found.
    Evidence: .omo/evidence/task-3-fixture-secret-scan.txt
  ```

  **Commit**: NO | Message: `test(visualizer): add read-only data fixtures` | Files: [`apps/memory-visualizer/fixtures/**`, `apps/memory-visualizer/scripts/**`]

- [x] 4. Implement tolerant local file parsers

  **What to do**: Implement parser modules for `.metadata/manifest.json`, `.metadata/checkpoint.json`, `persona.md`, `.metadata/scene_index.json`, `scene_blocks/*.md`, `records/*.jsonl`, `conversations/*.jsonl`, offload `mmds/*.mmd`, offload `offload-*.jsonl`, and `refs/*.md` metadata links. Parsers must accept `DataSourceConfig`, return partial DTOs plus `ParserWarning[]`, ignore unknown fields, tolerate missing/corrupt files, and never write to disk. JSONL parsers must skip corrupt lines and emit line-specific warnings. MMD parser must extract metadata/node summaries when possible and fallback to raw text for invalid Mermaid.
  **Must NOT do**: Do not mutate files, create indexes, repair corrupted data, or parse raw embedding vectors for UI display.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - Reason: multiple file formats and defensive parsing edge cases.
  - Skills: [] - no specialized skill required.
  - Omitted: [`frontend-ui-ux`] - parser task has no visual design.

  **Parallelization**: Can Parallel: NO | Wave 4 | Blocks: 5, 8, 9, 10 | Blocked By: 1, 2, 3

  **References**:
  - API/Type: `src/core/conversation/l0-recorder.ts:44-52` - L0 JSONL message fields.
  - API/Type: `src/core/record/l1-writer.ts:47-72` - L1 MemoryRecord JSONL fields.
  - API/Type: `src/core/scene/scene-index.ts:9-15` - scene index entry fields.
  - Pattern: `src/core/scene/scene-format.ts:24-48` - existing scene block meta parsing behavior to emulate defensively.
  - API/Type: `src/offload/types.ts:11-28` - OffloadEntry JSONL fields.
  - Pattern: `src/offload/mmd-meta.ts:18-66` - MMD meta extraction behavior to mirror or improve.

  **Acceptance Criteria**:
  - [ ] `npm --prefix apps/memory-visualizer test -- parsers` exits 0.
  - [ ] Parser tests cover all fixture directories listed in Task 3.
  - [ ] Tests assert corrupt JSON/JSONL produces warnings and partial data, not uncaught exceptions.
  - [ ] `npm --prefix apps/memory-visualizer run safety:readonly` exits 0.

  **QA Scenarios**:
  ```
  Scenario: Complete fixture parses into all major layers
    Tool: Bash
    Steps: Run `npm --prefix apps/memory-visualizer test -- parsers complete-data-dir`.
    Expected: Snapshot includes metadata, persona, scenes, L1 memories, L0 conversations, offload canvas with no fatal errors.
    Evidence: .omo/evidence/task-4-complete-parser.txt

  Scenario: Corrupt files degrade gracefully
    Tool: Bash
    Steps: Run `npm --prefix apps/memory-visualizer test -- parsers corrupt-json offload-invalid-mermaid`.
    Expected: Tests pass; parser returns warnings and partialData; dashboard DTO remains serializable.
    Evidence: .omo/evidence/task-4-corrupt-parser.txt
  ```

  **Commit**: NO | Message: `feat(visualizer): add tolerant read-only parsers` | Files: [`apps/memory-visualizer/src/parsers/**`, `apps/memory-visualizer/src/utils/**`, `apps/memory-visualizer/**/*.test.ts`]

- [x] 5. Build DashboardDataProvider aggregation layer

  **What to do**: Implement `LocalDashboardDataProvider` that composes parsers into a single `DashboardSnapshot`. It must compute counts, type distributions, priority distributions, scene heat lists, recent update timelines, capability statuses, evidence link indices, offload canvas summaries, and warnings. Add config resolution with priority: request-provided path → env vars → app-local config → no data empty state. Add pagination/lazy APIs for large L1/L0/offload/ref datasets. Include optional SQLite `vectors.db` metadata read only if implemented behind `SqliteMetadataReader` capability; if it fails, fall back to JSONL with warning.
  **Must NOT do**: Do not make UI depend on parser internals. Do not require `vectors.db` to exist. Do not query `l1_vec`/`l0_vec` raw vector payloads.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - Reason: provider aggregation coordinates contracts, parsers, capabilities, pagination, and fallback rules.
  - Skills: [] - no specialized skill required.
  - Omitted: [`frontend-ui-ux`] - not a UI layout task.

  **Parallelization**: Can Parallel: NO | Wave 5 | Blocks: 6, 7, 8, 9, 10, 11 | Blocked By: 2, 4

  **References**:
  - Pattern: `src/core/store/factory.ts:33-44` - project pattern for config-driven data backend creation.
  - Pattern: `src/core/store/factory.ts:90-124` - `vectors.db` path convention for sqlite backend.
  - Pattern: `src/core/store/sqlite.ts:567-580` - optional L1 metadata table if SQLite read-only fallback is implemented.
  - Pattern: `src/core/store/sqlite.ts:654-662` - optional L0 metadata table if SQLite read-only fallback is implemented.
  - Pattern: `src/core/profile/profile-sync.ts:70-117` - local L2/L3 profile listing behavior.

  **Acceptance Criteria**:
  - [ ] `npm --prefix apps/memory-visualizer test -- providers` exits 0.
  - [ ] Provider tests assert missing `dataDir` returns empty snapshot with `CapabilityReport` warnings.
  - [ ] Provider tests assert `offloadRoot` absent disables offload capability without failure.
  - [ ] Provider tests assert no raw vector fields are exposed in `DashboardSnapshot`.

  **QA Scenarios**:
  ```
  Scenario: Snapshot aggregation from complete fixture
    Tool: Bash
    Steps: Run `npm --prefix apps/memory-visualizer test -- providers complete-data-dir`.
    Expected: Snapshot includes counts for L0/L1/L2/L3/offload and no raw vector payload fields.
    Evidence: .omo/evidence/task-5-provider-complete.txt

  Scenario: Missing dataDir produces safe empty state
    Tool: Bash
    Steps: Run `npm --prefix apps/memory-visualizer test -- providers missing-data-dir`.
    Expected: Provider returns empty snapshot, `metadata` capability is `missing` or `error`, and no uncaught exception occurs.
    Evidence: .omo/evidence/task-5-provider-missing.txt
  ```

  **Commit**: NO | Message: `feat(visualizer): aggregate read-only dashboard data` | Files: [`apps/memory-visualizer/src/providers/**`]

- [x] 6. Implement read-only local API server and Gateway debug adapter

  **What to do**: Add Node native HTTP server under `apps/memory-visualizer/src/server/` that serves app APIs and Vite middleware/static bundle. API routes must include `GET /api/snapshot`, `GET /api/scenes`, `GET /api/memories`, `GET /api/conversations`, `GET /api/offload`, `GET /api/evidence`, `GET /api/gateway/health`, `POST /api/gateway/recall-debug`, `POST /api/gateway/search-memories-debug`, `POST /api/gateway/search-conversations-debug`. Gateway adapter may call only `/health`, `/recall`, `/search/memories`, `/search/conversations`; return raw string responses for search pages. Add request validation, path normalization, timeout handling, and redaction of API keys in errors.
  **Must NOT do**: Do not implement proxy routes for `/capture`, `/session/end`, `/seed`. Do not expose arbitrary file read endpoints. Do not allow client-supplied paths outside configured `dataDir`/offload root.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - Reason: server/API work requires security and read-only boundaries.
  - Skills: [] - no specialized skill required.
  - Omitted: [`frontend-ui-ux`] - server API task only.

  **Parallelization**: Can Parallel: YES (with Task 11 only) | Wave 6 | Blocks: 7, 10, 12 | Blocked By: 1, 2, 5

  **References**:
  - API/Type: `src/gateway/server.ts:1-14` - existing Gateway endpoint list; only safe read/debug endpoints are allowed here.
  - API/Type: `src/gateway/types.ts:18-26` - HealthResponse fields.
  - API/Type: `src/gateway/types.ts:32-42` - RecallRequest/RecallResponse fields.
  - API/Type: `src/gateway/types.ts:66-77` - MemorySearchResponse returns formatted string.
  - API/Type: `src/gateway/types.ts:83-92` - ConversationSearchResponse returns formatted string.
  - Pattern: `src/adapters/opencode/policy.ts:84-107` - sensitive text redaction pattern to emulate for errors/logs.

  **Acceptance Criteria**:
  - [ ] `npm --prefix apps/memory-visualizer test -- server` exits 0.
  - [ ] `npm --prefix apps/memory-visualizer run safety:readonly` exits 0 and confirms no production route calls `/capture`, `/session/end`, `/seed`.
  - [ ] Server tests assert path traversal like `../../` is rejected.
  - [ ] Gateway timeout/non-JSON/500 cases return debug warnings, not process crashes.

  **QA Scenarios**:
  ```
  Scenario: Snapshot API serves fixture data read-only
    Tool: Bash
    Steps: Run server test suite with `complete-data-dir` fixture; request `GET /api/snapshot`.
    Expected: Response status 200; JSON includes capabilities and counts; no file writes occur.
    Evidence: .omo/evidence/task-6-api-snapshot.txt

  Scenario: Dangerous Gateway endpoints unavailable
    Tool: Bash
    Steps: Run `npm --prefix apps/memory-visualizer run safety:readonly`.
    Expected: Static safety script exits 0 and reports no production code references to `/capture`, `/session/end`, `/seed`.
    Evidence: .omo/evidence/task-6-dangerous-endpoints.txt
  ```

  **Commit**: NO | Message: `feat(visualizer): add read-only dashboard server` | Files: [`apps/memory-visualizer/src/server/**`, `apps/memory-visualizer/src/providers/gateway*`]

- [x] 7. Build UI shell, navigation, and status model

  **What to do**: Implement React UI shell with routes/tabs for Overview, Scene Map, Memory Explorer, Evidence Drill-down, Offload Task Canvas, Search/Recall Debug, Settings/Status. Add shared API client, loading/error/empty/warning components, capability badges, path configuration form, and a top-level “Read-only mode” banner. Create the Playwright e2e bootstrap in this task: app-local test server startup helper, fixture dataDir configuration helper, and `e2e/shell.spec.ts`. UI must consume only `/api/*` DTOs, not local files directly.
  **Must NOT do**: Do not add memory editing controls, destructive buttons, or language implying changes are written back.

  **Recommended Agent Profile**:
  - Category: `visual-engineering` - Reason: UI shell, navigation, empty states, and status affordances.
  - Skills: [`frontend-ui-ux`] - use for clear dashboard layout and state communication.
  - Omitted: [`playwright`] - e2e interaction is in QA scenarios and Task 12, not primary implementation guidance.

  **Parallelization**: Can Parallel: NO | Wave 7 | Blocks: 8, 9, 10 | Blocked By: 1, 2, 5, 6

  **References**:
  - Pattern: `README.md:70-99` - product concept of layered memory and progressive disclosure.
  - Pattern: `README.md:126-154` - symbolic memory / Mermaid canvas explanation for user-facing copy.
  - Pattern: `README.md:339-362` - white-box debuggability and drill-down chain phrasing.

  **Acceptance Criteria**:
  - [ ] `npm --prefix apps/memory-visualizer run build` exits 0.
  - [ ] `npm --prefix apps/memory-visualizer test -- ui-shell` exits 0.
  - [ ] `npm --prefix apps/memory-visualizer run test:e2e -- --grep "shell"` exits 0.
  - [ ] UI shell displays read-only banner on every route.

  **QA Scenarios**:
  ```
  Scenario: UI shell loads all routes
    Tool: Playwright
    Steps: Start visualizer against `fixtures/complete-data-dir`; visit `/`; click each navigation item by visible text: Overview, Scene Map, Memory Explorer, Evidence Drill-down, Offload Task Canvas, Search/Recall Debug, Settings/Status.
    Expected: Each route renders heading and read-only banner; no console error containing `Unhandled`.
    Evidence: .omo/evidence/task-7-ui-shell.png

  Scenario: Missing data shows empty status not crash
    Tool: Playwright
    Steps: Start visualizer with a non-existent dataDir; visit `/`.
    Expected: Overview renders missing capability warnings and empty states; app remains navigable.
    Evidence: .omo/evidence/task-7-missing-data.png
  ```

  **Commit**: NO | Message: `feat(visualizer): add read-only UI shell` | Files: [`apps/memory-visualizer/src/ui/**`]

- [x] 8. Implement Persona and Scene Map views

  **What to do**: Add Overview widgets for Persona availability, scene count, top scene heat, recent scene updates, and parser warnings. Add Scene Map page showing `scene_index` entries as cards/table with heat, summary, updated time, link to scene detail, and robust empty/corrupt states. Add Persona panel showing stripped persona content/summary and scene navigation links without writing `persona.md`.
  **Must NOT do**: Do not edit scene files, refresh persona navigation, or invoke profile sync.

  **Recommended Agent Profile**:
  - Category: `visual-engineering` - Reason: scene/persona are central user-facing memory visualizations.
  - Skills: [`frontend-ui-ux`] - needed for clear information hierarchy and visual emphasis.
  - Omitted: []

  **Parallelization**: Can Parallel: YES (with Tasks 9 and 10) | Wave 8 | Blocks: 12 | Blocked By: 4, 5, 7

  **References**:
  - API/Type: `src/core/scene/scene-index.ts:9-15` - scene index fields to display.
  - Pattern: `src/core/scene/scene-navigation.ts:38-53` - heat sorting and navigation concept.
  - Pattern: `src/core/profile/profile-sync.ts:95-117` - persona.md is L3 local profile content, navigation stripped for body.
  - Pattern: `src/core/scene/scene-format.ts:53-68` - scene META formatting.

  **Acceptance Criteria**:
  - [ ] `npm --prefix apps/memory-visualizer test -- scene` exits 0.
  - [ ] `npm --prefix apps/memory-visualizer run test:e2e -- --grep "scene"` exits 0.
  - [ ] Empty `scene_blocks/` fixture shows an empty state and warning, not a crash.
  - [ ] Missing `persona.md` fixture shows Persona capability as missing and Scene Map still works.

  **QA Scenarios**:
  ```
  Scenario: Scene Map renders heat-sorted scenes
    Tool: Playwright
    Steps: Start visualizer with `complete-data-dir`; open Scene Map.
    Expected: Scene cards/table show summaries, heat values, update timestamps, and the highest heat scene appears first.
    Evidence: .omo/evidence/task-8-scene-map.png

  Scenario: Missing persona degrades only persona panel
    Tool: Playwright
    Steps: Start visualizer with `missing-persona`; open Overview and Scene Map.
    Expected: Persona panel displays missing state; Scene Map still renders scene fixtures.
    Evidence: .omo/evidence/task-8-missing-persona.png
  ```

  **Commit**: NO | Message: `feat(visualizer): visualize persona and scenes` | Files: [`apps/memory-visualizer/src/ui/**`, `apps/memory-visualizer/src/providers/**`]

- [x] 9. Implement Memory Explorer and Evidence Drill-down

  **What to do**: Add Memory Explorer page showing L1 memories as searchable/filterable cards/table by type, priority range, scene, sessionKey/sessionId, updated time, and warning status. Add charts or simple summaries for type distribution and priority distribution. Add Evidence Drill-down page linking selected memory to `source_message_ids` where available, L0 conversation snippets, JSONL source file/line metadata, and offload/ref evidence where available. Use pagination/lazy loading for large lists.
  **Must NOT do**: Do not provide delete/edit/merge buttons. Do not claim JSONL append-only entries are guaranteed current without warning when SQLite effective records are unavailable.

  **Recommended Agent Profile**:
  - Category: `visual-engineering` - Reason: core dashboard pages requiring UX clarity and data filtering.
  - Skills: [`frontend-ui-ux`] - needed for card/table/filter design.
  - Omitted: []

  **Parallelization**: Can Parallel: YES (with Tasks 8 and 10) | Wave 8 | Blocks: 12 | Blocked By: 4, 5, 7

  **References**:
  - API/Type: `src/core/record/l1-writer.ts:47-72` - L1 memory fields: content, type, priority, scene, source IDs, timestamps, sessions.
  - API/Type: `src/core/conversation/l0-recorder.ts:44-52` - L0 message evidence fields.
  - Pattern: `src/core/record/l1-reader.ts:37-48` - SQLite/VectorStore is preferred for efficient current L1 queries when available.
  - Pattern: `src/core/record/l1-writer.ts:7-11` - JSONL is append-only and may contain old update/merge records; UI must warn.

  **Acceptance Criteria**:
  - [ ] `npm --prefix apps/memory-visualizer test -- memory` exits 0.
  - [ ] `npm --prefix apps/memory-visualizer run test:e2e -- --grep "memory"` exits 0.
  - [ ] Memory Explorer filter by `type=persona` and `priority>=80` returns deterministic fixture rows.
  - [ ] Evidence Drill-down shows missing evidence warning when `source_message_ids` cannot be resolved.

  **QA Scenarios**:
  ```
  Scenario: Memory filters and summaries work
    Tool: Playwright
    Steps: Start visualizer with `complete-data-dir`; open Memory Explorer; select type filter `persona`; set priority min `80`.
    Expected: List narrows to fixture persona memories with priority >= 80; distribution summary updates.
    Evidence: .omo/evidence/task-9-memory-filters.png

  Scenario: Evidence drill-down handles missing source
    Tool: Playwright
    Steps: Start visualizer with fixture containing a memory whose `source_message_ids` do not exist; open its drill-down.
    Expected: Page shows memory details and a warning that source evidence is missing; no crash.
    Evidence: .omo/evidence/task-9-missing-evidence.png
  ```

  **Commit**: NO | Message: `feat(visualizer): add memory explorer and evidence drilldown` | Files: [`apps/memory-visualizer/src/ui/**`, `apps/memory-visualizer/src/providers/**`]

- [x] 10. Implement Offload Task Canvas and Search/Recall Debug views

  **What to do**: Add Offload Task Canvas page listing available MMD files, task goals, done/doing/todo counts, node summaries, linked offload entries, and `result_ref` refs. Render valid Mermaid using the app-local `mermaid` dependency; for invalid Mermaid, show fallback text and parser warning. Add Search/Recall Debug page with Gateway status, safe query forms for `/recall`, `/search/memories`, `/search/conversations`, request/response display, timeout/error states, and clear label that search results are formatted debug text.
  **Must NOT do**: Do not call `/capture`, `/session/end`, `/seed`. Do not fetch arbitrary ref paths outside offload root. Do not mutate offload state.

  **Recommended Agent Profile**:
  - Category: `visual-engineering` - Reason: Mermaid rendering and debug UX require careful presentation.
  - Skills: [`frontend-ui-ux`, `playwright`] - UI/UX for task canvas and browser verification.
  - Omitted: []

  **Parallelization**: Can Parallel: YES (with Tasks 8 and 9) | Wave 8 | Blocks: 12 | Blocked By: 4, 5, 6, 7

  **References**:
  - API/Type: `src/offload/types.ts:11-28` - OffloadEntry fields: node_id, tool_call, summary, result_ref, score.
  - API/Type: `src/offload/types.ts:41-55` - PluginState fields for active MMD and counters.
  - API/Type: `src/offload/mmd-meta.ts:6-16` - MmdMeta fields to display.
  - Pattern: `src/offload/storage.ts:417-451` - read all offload entries across sessions concept.
  - API/Type: `src/gateway/types.ts:38-42` - RecallResponse fields.
  - API/Type: `src/gateway/types.ts:73-77` - MemorySearchResponse raw formatted results.
  - API/Type: `src/gateway/types.ts:89-92` - ConversationSearchResponse raw formatted results.

  **Acceptance Criteria**:
  - [ ] `npm --prefix apps/memory-visualizer test -- offload gateway-debug` exits 0.
  - [ ] `npm --prefix apps/memory-visualizer run test:e2e -- --grep "offload|gateway"` exits 0.
  - [ ] Invalid Mermaid fixture shows fallback text and warning.
  - [ ] Gateway debug tests assert only safe endpoints are called.

  **QA Scenarios**:
  ```
  Scenario: Offload MMD renders or falls back safely
    Tool: Playwright
    Steps: Start visualizer with `offload-invalid-mermaid`; open Offload Task Canvas.
    Expected: Page lists MMD metadata and shows invalid Mermaid warning plus raw/fallback text; app does not crash.
    Evidence: .omo/evidence/task-10-invalid-mermaid.png

  Scenario: Search debug displays raw Gateway string response
    Tool: Playwright
    Steps: Start visualizer with mocked Gateway returning `{ results: "Memory search...", total: 1, strategy: "hybrid" }`; open Search/Recall Debug; submit memory search query `workspace`.
    Expected: Raw formatted `results` string appears in debug panel; UI does not try to parse it as structured cards.
    Evidence: .omo/evidence/task-10-search-debug.png
  ```

  **Commit**: NO | Message: `feat(visualizer): add offload canvas and gateway debug` | Files: [`apps/memory-visualizer/src/ui/**`, `apps/memory-visualizer/src/providers/**`, `apps/memory-visualizer/src/parsers/**`]

- [x] 11. Document operation, boundaries, and official-tool replacement strategy

  **What to do**: Add `docs/visualization-web.md`, app README updates, and `apps/memory-visualizer/scripts/check-docs.mjs`. Document install/build/run commands, supported data sources, config/env vars, read-only safety boundary, data source priority, capability/warning model, limitations, privacy guidance, and replacement strategy when official visualization arrives. Include examples for seed output directory and live plugin `dataDir`. Document that Gateway `/search/*` is debug text, not structured primary data. The docs check script must validate required headings, commands, and explicit no-write/no-edit exclusions in this same task; Task 12 only reruns it.
  **Must NOT do**: Do not promise production hosting, authentication, remote multi-user access, or write-based memory management.

  **Recommended Agent Profile**:
  - Category: `writing` - Reason: technical documentation and boundary communication.
  - Skills: [] - no specialized skill needed.
  - Omitted: [`frontend-ui-ux`] - no UI implementation.

  **Parallelization**: Can Parallel: YES (with Task 6 only) | Wave 6 | Blocks: 12 | Blocked By: 1, 2, 5

  **References**:
  - Pattern: `README.md:339-362` - white-box debuggability language.
  - Pattern: `README.md:381-386` - roadmap explicitly mentions visual debugging and memory observability dashboard.
  - Pattern: `src/cli/README.md:141-153` - seed output layout example.
  - Pattern: `src/gateway/server.ts:1-14` - Gateway endpoint list and safe endpoint caveat.

  **Acceptance Criteria**:
  - [ ] `docs/visualization-web.md` contains sections: Overview, Run Locally, Data Sources, Read-only Boundary, Supported Views, Limitations, Official Tool Replacement Strategy, QA Commands.
  - [ ] Documentation includes exact commands: `npm --prefix apps/memory-visualizer install`, `npm --prefix apps/memory-visualizer run dev`, `npm --prefix apps/memory-visualizer run build`, `npm --prefix apps/memory-visualizer test`.
  - [ ] Documentation explicitly states no edit/delete/reindex/capture/seed/session-end.
  - [ ] `node apps/memory-visualizer/scripts/check-docs.mjs` exits 0.

  **QA Scenarios**:
  ```
  Scenario: Documentation contains required safety sections
    Tool: Bash
    Steps: Run `node apps/memory-visualizer/scripts/check-docs.mjs`.
    Expected: Script exits 0 and confirms required headings and commands exist.
    Evidence: .omo/evidence/task-11-docs-check.txt

  Scenario: Documentation does not overpromise write features
    Tool: Bash
    Steps: Run docs check for forbidden phrases like `edit memory`, `delete memory`, `reindex from UI` unless under explicit exclusions.
    Expected: Script exits 0; any forbidden phrases appear only in exclusion/limitation context.
    Evidence: .omo/evidence/task-11-docs-boundary.txt
  ```

  **Commit**: NO | Message: `docs(visualizer): document read-only dashboard plan and usage` | Files: [`docs/visualization-web.md`, `apps/memory-visualizer/README.md`]

- [x] 12. Complete automated QA, safety checks, and regression verification

  **What to do**: Rerun and harden existing app-local scripts created by earlier tasks: `safety:readonly` from Task 1, `validate-fixtures` and `check-fixture-secrets` from Task 3, `check-docs` from Task 11. Run the Playwright e2e bootstrap created by Task 7 across all UI specs. Run full app and root verification commands. Ensure all test evidence files are produced. Fix any failing tests by adjusting app code, not by weakening guardrails.
  **Must NOT do**: Do not skip tests, remove safety checks, or whitelist production write APIs. Do not change root tests to hide regressions.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - Reason: cross-cutting QA, safety, and regression work.
  - Skills: [`playwright`] - required for browser-based UI smoke verification.
  - Omitted: [`git-master`] - no git operation requested.

  **Parallelization**: Can Parallel: NO | Wave 9 | Blocks: Final Verification | Blocked By: 1-11

  **References**:
  - Pattern: `package.json:34-36` - root test commands use Vitest.
  - Pattern: `src/adapters/opencode/policy.ts:84-107` - redaction patterns; safety checks should protect secrets.
  - Pattern: `src/gateway/server.ts:263-273` - route dispatch includes dangerous endpoints that visualizer production code must not call.

  **Acceptance Criteria**:
  - [ ] `npm --prefix apps/memory-visualizer run typecheck` exits 0.
  - [ ] `npm --prefix apps/memory-visualizer test` exits 0.
  - [ ] `npm --prefix apps/memory-visualizer run test:e2e` exits 0.
  - [ ] `npm --prefix apps/memory-visualizer run build` exits 0.
  - [ ] `npm --prefix apps/memory-visualizer run safety:readonly` exits 0.
  - [ ] `npm test` at repo root exits 0.
  - [ ] `npm run build` at repo root exits 0.

  **QA Scenarios**:
  ```
  Scenario: Full visualizer verification passes
    Tool: Bash
    Steps: Run `npm --prefix apps/memory-visualizer run typecheck`; run `npm --prefix apps/memory-visualizer test`; run `npm --prefix apps/memory-visualizer run test:e2e`; run `npm --prefix apps/memory-visualizer run build`; run `npm --prefix apps/memory-visualizer run safety:readonly`.
    Expected: All commands exit 0; test reports saved under app-local output and copied/summarized to `.omo/evidence/task-12-visualizer-verification.txt`.
    Evidence: .omo/evidence/task-12-visualizer-verification.txt

  Scenario: Root project regression checks pass
    Tool: Bash
    Steps: Run `npm test`; run `npm run build` from repository root.
    Expected: Existing root test/build commands exit 0 with no visualizer-induced regressions.
    Evidence: .omo/evidence/task-12-root-regression.txt
  ```

  **Commit**: NO | Message: `test(visualizer): complete read-only dashboard verification` | Files: [`apps/memory-visualizer/**`, `docs/visualization-web.md`]

## Final Verification Wave (MANDATORY — after ALL implementation tasks)
> 4 review agents run in PARALLEL. ALL must APPROVE. Present consolidated results to user and get explicit "okay" before completing.
> **Do NOT auto-proceed after verification. Wait for user's explicit approval before marking work complete.**
> **Never mark F1-F4 as checked before getting user's okay.** Rejection or user feedback -> fix -> re-run -> present again -> wait for okay.
- [x] F1. Plan Compliance Audit — oracle
- [x] F2. Code Quality Review — unspecified-high
- [x] F3. Real Manual QA — unspecified-high (+ playwright)
- [x] F4. Scope Fidelity Check — deep

## Commit Strategy
- Do not commit unless the user explicitly requests git commits.
- If commits are requested later, use small atomic commits:
  - `feat(visualizer): scaffold read-only dashboard app`
  - `feat(visualizer): parse memory data sources`
  - `feat(visualizer): add dashboard views`
  - `test(visualizer): add safety and e2e verification`
  - `docs(visualizer): document usage and boundaries`
- Never include real memory data, secrets, API keys, or local user paths in commits.

## Success Criteria
- The Web dashboard can be run locally against fixture data and real `dataDir` paths without modifying memory data.
- Humans can inspect persona, scenes, structured memories, evidence, offload task canvases, and Gateway debug responses.
- Missing/corrupt/partial data shows warnings and empty states instead of crashes.
- Production visualizer code does not contain write operations or dangerous Gateway endpoint calls.
- Existing root package build/test behavior remains intact.
- Future official visualization tooling can replace this app because parsing/provider code is isolated behind DTO contracts.
