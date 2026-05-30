## Task 1 - Scaffold isolated visualizer app

- No implementation issues recorded during scaffolding.

## Task 1 - Verification cleanup

- Root `test-results/.last-run.json` was generated because Playwright did not have an app-local `outputDir`; fixed by setting `outputDir: "./test-results"` in the visualizer Playwright config and ignoring app-local generated output directories.

## Task 2 - Read-only dashboard contracts

- No implementation issues recorded for contract DTO definition; parser/provider tasks will still need to decide how to derive scene heat scores and source IDs from real files/databases.

## Task 3 - Representative read-only fixtures

- No fixture implementation defects were found during validation, secret scan, typecheck, or readonly safety verification.
- Workspace-wide LSP diagnostics reported that the optional `biome` server is configured but not installed in this environment; file-level diagnostics for the two new `.mjs` scripts were still clean.

## Task 4 - Tolerant local file parsers

- No parser implementation issues recorded beyond expected fixture degradation cases; corrupt JSON/JSONL, invalid Mermaid, missing refs, and missing persona are represented as `ParserWarning[]` with partial serializable data.

## Task 5 - DashboardDataProvider aggregation

- No provider implementation issues recorded; SQLite metadata reading was intentionally left disabled behind a provider warning/fallback path so `vectors.db` is never required for dashboard snapshots.

## Task 11 - Operation and boundary documentation

- Initial `check-docs.mjs` path resolution only walked up one directory and looked for `apps/docs/visualization-web.md`; fixed by resolving the repository root from `apps/memory-visualizer/` with two parent segments.
- Initial forbidden-phrase matching treated explicit exclusion prose like `trigger session-end` and `memory editor` as positive promises; fixed by narrowing checks to positive UI capability claims and keeping exclusion sentences valid.

## Task 6 - Read-only local API server and Gateway debug adapter

- Initial typecheck flagged `expectRecord` returning a broad `object` type from a local `typeof` guard; fixed by reusing the adapter's `isRecord` guard so debug request validation returns `Record<string, unknown>` without casts.
- The first server evidence assertion expected a single evidence item in a page that legitimately returned two records; fixed the test to assert `total` and array containment instead of over-constraining the whole page.

## Task 7 - UI shell, navigation, and status model

- Initial shell unit assertions were written against route-section titles that were not always visible once nested data panels rendered; fixed by asserting stable route-specific content that matches the actual UI shell output.
- Early Playwright evidence screenshots were written to `apps/.omo/evidence/` because the harness root path walked up only three segments from `e2e/helpers/`; fixed by resolving the repository root with four parent segments and rerunning the shell smoke to regenerate screenshots under root `.omo/evidence/`.
- `npm run test:e2e -- --grep "shell"` passes in this environment, but npm emits a warning that `--grep` is being treated as an unknown config before forwarding the trailing argument into `playwright test shell`; behavior is currently acceptable, though the script shape may need refinement if npm tightens argument parsing later.
- Atlas follow-up verification rejected Task 7 because `npm --prefix apps/memory-visualizer run typecheck` failed on four local typing gaps: missing CSS side-effect declaration, `CapabilityReport` value narrowing in `summarizeCapabilities`, `CapabilityBadge` children being inferred as JSX text array for `heat {value}`, and `JSX.Element` namespace usage in `DataRouteSection`; fixed locally with `src/vite-env.d.ts`, a `CapabilityState` guard, string interpolation, and `ReactNode` typing.

## Task 8 - Persona and Scene Map views

- Initial Task 8 UI code imported provider aggregation helpers directly into production `src/ui/**`, which pulled Node-only parser modules into the Vite browser graph and produced browser-compatibility externalization warnings; fixed by moving the required scene/persona snapshot summarization into an app-local UI helper.
- Initial `missing-persona` E2E coverage exposed a real parser gap: `scene_blocks/index.json` entries were dropped when the matching `.md` file was absent, so Scene Map incorrectly showed an empty state for the fixture; fixed by falling back to index-only scene summaries in `parseSceneBlocks` and adding a parser regression test.
- `npm --prefix apps/memory-visualizer run test:e2e -- --grep "scene"` still emits the same npm forwarding warning as Task 7 before successfully running `playwright test scene`; current behavior is green but the script signature remains somewhat brittle.

## Task 9 - Memory Explorer and Evidence Drill-down

- Initial Task 9 route extraction reused `renderRoute(...model)` spreading, but the new `MemoryExplorerRoute` and `EvidenceRoute` expected renamed props like `initialMemoryState`; this caused an immediate unit-test crash on `undefined.data` and was fixed by passing explicit prop mappings from `App.tsx`.
- Playwright memory coverage initially failed under strict mode because repeated warning/source strings made `getByText(...)` resolve to multiple nodes; fixed by targeting `.first()` on intentionally duplicated text rather than weakening the UI.
- `npm --prefix apps/memory-visualizer run test:e2e -- --grep "memory"` still emits the known npm forwarding warning and currently resolves to `playwright test memory`, which passed after the new memory/spec assertions were tightened; the command remains green but the script forwarding behavior is still somewhat brittle.

## Task 10 - Offload Task Canvas and Search/Recall Debug (2026-05-30)

- Initial Gateway debug type additions widened the app-local API client contract and immediately broke existing route tests that provided only the old six methods; fixed by adding deterministic safe-endpoint stubs to the existing `App.*.test.tsx` client factories.
- The first Task 10 Playwright spec resolved the invalid-mermaid fixture from `apps/memory-visualizer/apps/memory-visualizer/...` because `path.resolve(...)` ran from the app package working directory; fixed by resolving from `fixtures/...` relative to the app root instead of prepending `apps/memory-visualizer/` again.
- Raw search debug assertions initially used broad `getByText(...)` selectors and hit strict-mode collisions because the formatted string appears both inside the JSON response mirror and the dedicated raw debug panel; fixed by targeting the `.json-hint` panel that intentionally carries the raw formatted string.

## Task 12 - Automated QA, safety, and regression verification

- Full Playwright E2E initially failed because `getByRole("heading", { name: "Offload Task Canvas" })` also matched the table heading `Offload task canvases` under strict mode; fixed `apps/memory-visualizer/e2e/shell.spec.ts` by adding `exact: true` to the main route-heading assertion.
- Root `npm test` initially failed in `src/adapters/opencode/config.test.ts` because explicit empty `apiKey` was treated as absent and could fall through the config helper path; fixed `src/adapters/opencode/config.ts` by checking explicit `apiKey` presence before env fallback. This was a minimal root regression fix required for Task 12 gates.

## Task 13 - Scene Map 404 gotcha (2026-05-30)

- The visualizer dev script (
pm --prefix apps/memory-visualizer run dev) starts Vite only (pps/memory-visualizer/package.json:7) and the app Vite config has no /api proxy (pps/memory-visualizer/vite.config.ts:1-10). If the separate local API server is not running, browser requests like /api/scenes fall back to the Vite origin and return 404. The app-local server does exist (pps/memory-visualizer/src/server/index.ts:47-90) but must be launched separately (or via the E2E harness, which starts both static + API servers in pps/memory-visualizer/e2e/helpers/visualizer-harness.ts:37-63).

## Post-review Docker sidecar remediation (2026-05-30)

- Security review blockers were remediated by making unexpected production/API 500 responses generic for clients while retaining detailed server logs, keeping controlled 400/404/405 messages exposed.
- Docker sidecar defaults now keep Gateway published only as `127.0.0.1:8420:8420`, leave visualizer Gateway debug proxy env unset unless explicitly opted in, and keep visualizer offload rooted at `/data/memory-tdai/offload` on the read-only volume.
- Root CI now runs the visualizer typecheck, tests, build, read-only safety, Docker sidecar check, and docs check so these boundaries are covered before merge.
- Follow-up verification aligned the standalone Gateway commented offload `dataDir` example to `/data/memory-tdai/offload`.
