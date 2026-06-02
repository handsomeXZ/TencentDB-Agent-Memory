## 2026-06-01T15:04:06Z Task: session-start
No implementation issues recorded yet.

## 2026-06-01 Task: Wave 1A Task 2 UI primitives diagnostics gotcha
- lsp_diagnostics on styles.css could not run because the configured biome LSP command is not installed in this environment. TS/TSX diagnostics for changed component files passed, and the full visualizer typecheck/test/build passed.

## 2026-06-02 Task: Wave 1A Task 3 rejected monolith fix
- Atlas rejected the first Task 3 attempt because `routes/app-routes.tsx` still contained the old monolith and route files were only re-export stubs. The fix moved real implementations into dedicated route modules, left `app-routes.tsx` as a small renderer/registry file, and restored `MetaPair variant="metric"` for Offload and Debug metric-card layouts.

## 2026-06-02 Task: Wave 1A Task 6 Gateway telemetry test gotcha
- The first sanitization assertion overmatched legal telemetry field names (`gateway_api_key`, `queryKeys`) while trying to forbid raw secret/query material. The test was narrowed to forbid raw secret values and sensitive header/parameter content rather than contract field names.

## 2026-06-02 Task: Wave 1A Task 7 Visualizer telemetry evidence gotcha
- PowerShell `*>` redirection produced UTF-16 evidence files that the repository `read` tool treated as binary. The evidence commands were rerun with `Out-File -Encoding utf8`, and targeted tests were run through app-local `npx vitest` because npm argument forwarding did not preserve `--testNamePattern` cleanly.

## 2026-06-02 Task: Wave 1A Task 7 Visualizer telemetry typecheck follow-up
- Importing shared `request-telemetry-store.ts` through the Visualizer app typecheck exposed stricter TypeScript inference errors: encoded `readFile` made the Buffer fallback branch unreachable, and tuple `map().filter()` inferred summary bucket keys too narrowly. The follow-up kept behavior unchanged by decoding file content through explicit helpers and building summary buckets with an explicitly typed array.

## 2026-06-02T09:55:08.3162377+08:00 Task: Wave 1A Task 9 Gateway warning redaction fix
- The first Gateway `/visualizer/requests` implementation returned shared store warnings verbatim, which meant `detail` could leak local telemetry paths or protected-root metadata through public DTOs.
- The fix was intentionally applied in the Gateway response layer, not the shared store: page/summary warnings are now mapped to `{ code, message, source, detail: null }`, matching the Visualizer API privacy boundary.
- A second gotcha surfaced while fixing this: unsafe telemetry directory resolution had been collapsed into an unconfigured read path. The Gateway now preserves that warning signal with an empty sanitized page/summary response instead of dropping it.

## 2026-06-02 Task: Requests Monitor readonly scan regression
- The first `detectRequestType` implementation in `src/ui/routes/requests-monitor-route.tsx` hardcoded Gateway mutation endpoint literals (`/capture`, `/session/end`, `/seed`) just to classify rows as `Gateway API`, which tripped the production UI readonly safety scan even though the page remained observational.
- The fix switched request-type classification to sanitized telemetry metadata (`record.source`) so Gateway-origin rows still render as `Gateway API` and Visualizer-origin rows as `Visualizer API` without embedding forbidden mutation endpoint strings in production UI code.

## 2026-06-02 Task: F2 Final Verification remote request telemetry reject
- F2 rejected the final wave because `TDAI_VIS_DATA_SOURCE=gateway` still served `/api/requests` and `/api/requests/summary` from the Visualizer's local telemetry directory instead of the Gateway DTO APIs.
- The fix added remote provider methods for Gateway `/visualizer/requests` and `/visualizer/requests/summary`, then branched Visualizer request telemetry reads to those methods only for the remote data source so local merged JSONL behavior stays unchanged.
- Regression coverage now asserts remote pagination forwarding, Gateway Bearer auth attachment, and Visualizer response-layer warning redaction to `detail: null` for both request telemetry page and summary responses.

## 2026-06-02 Task: GHCR visualizer Docker root context
- Confirmed the GHCR Visualizer build failure root cause: the workflow and local compose used `apps/memory-visualizer` as the Docker context, but the Visualizer server now imports shared root telemetry modules from `src/telemetry/*`.
- The fix keeps the runtime image small by using the repository root context only in the builder stage and copying only built `dist`, `dist-server`, and app package metadata into runtime; `dist-server/production.js` bundles the telemetry modules.
