# Visualization Web

## Overview

Memory Visualizer is a local-only, read-only, app-local web surface for inspecting TencentDB Agent Memory artifacts without changing them. It is intentionally non-invasive and replaceable. Run it from `apps/memory-visualizer/`, keep it outside the root runtime, and treat it as a debugging helper for layered memory data rather than an official control plane.

The visualizer is meant for white-box inspection. You point it at existing memory data, read capability states and parser warnings, and drill from overview data into scene blocks, L1 memory records, L0 conversation evidence, and offload canvases. When an official visualization tool arrives, this app can be removed without changing server, plugin, or memory storage contracts.

For Docker-based server use, the supported shape is a read-only sidecar next to the Gateway container. The Gateway continues to own writes; the visualizer mounts the same memory volume read-only and serves a browser dashboard on a separate localhost-bound port.

## Run Locally

Run all commands from the repository root so the app stays app-local:

```bash
npm --prefix apps/memory-visualizer install
npm --prefix apps/memory-visualizer run dev
npm --prefix apps/memory-visualizer run build
npm --prefix apps/memory-visualizer run start
npm --prefix apps/memory-visualizer test
```

Useful verification commands:

```bash
node apps/memory-visualizer/scripts/check-docs.mjs
npm --prefix apps/memory-visualizer run typecheck
npm --prefix apps/memory-visualizer run safety:readonly
npm --prefix apps/memory-visualizer run check:docker
```

`run dev` is only for local frontend development. The production `run start` command serves built `dist/` assets and `/api/*` from one Node process after `run build` has completed. Direct `npm --prefix apps/memory-visualizer run start` listens on `127.0.0.1:8421` by default. Docker explicitly sets `TDAI_VIS_HOST=0.0.0.0` inside the visualizer container so the localhost-bound host publish can reach the Node process without changing the local-only default for non-Docker starts.

## Docker Sidecar Deployment

The standalone Docker deployment starts two services from `docker/standalone/docker-compose.yml` for local builds or `docker/standalone/docker-compose.ghcr.yml` for published GHCR images:

- `tdai-gateway`: the write-capable memory Gateway, bound to `127.0.0.1:8420:8420` by default.
- `tdai-visualizer`: the read-only dashboard sidecar, bound to `127.0.0.1:8421:8421` by default.

Both services use the same Docker named volume, `tdai_memory_data`. The Gateway mounts it read-write at `/data/memory-tdai`; the visualizer mounts it read-only at `/data/memory-tdai:ro`, reads it through `TDAI_VIS_DATA_DIR=/data/memory-tdai`, and expects offload data at `TDAI_VIS_OFFLOAD_ROOT=/data/memory-tdai/offload`.

Typical commands:

```bash
cd docker/standalone
docker compose build tdai-visualizer
docker compose up -d tdai-gateway tdai-visualizer
curl http://127.0.0.1:8421/health
docker compose -f docker-compose.ghcr.yml up -d tdai-gateway tdai-visualizer
```

Use `http://127.0.0.1:8421` for local inspection. `TDAI_VIS_API_KEY` is optional and unset by default so existing local-only usage keeps working unchanged. When it is set, `GET /health` stays open, the production SPA shell and static assets still load, and every read-only `/api/*` route requires `Authorization: Bearer <key>`. The browser then shows a login form, validates the shared key by calling normal dashboard APIs, stores it in `sessionStorage` for that tab only, and clears it on logout. For remote browser access, still put HTTPS and any operator-facing authentication or allow-list in front of the visualizer because this is only a shared Bearer-token gate, not a multi-user login UI. Do not expose the Gateway write-capable `8420` port to the public internet for dashboard access.

In GHCR deployments, `ghcr.io/<owner>/tencentdb-agent-memory` remains Gateway-only. The visualizer runs as the separate `ghcr.io/<owner>/tencentdb-agent-memory-visualizer` sidecar, and the expected startup log `Memory Visualizer listening on http://0.0.0.0:8421` belongs to the visualizer container logs.

## Data Sources

### Data source priority

The visualizer resolves data sources in this order:

1. Request or UI path.
2. Environment variables.
3. App-local config.
4. Empty state and default examples.

This priority keeps the app easy to point at a different local dataset without changing shared repository config.

### Required environment variables

The primary visualizer environment variable names are:

- `TDAI_VIS_DATA_DIR`
- `TDAI_VIS_OFFLOAD_ROOT`
- `TDAI_VIS_GATEWAY_URL`
- `TDAI_VIS_GATEWAY_API_KEY`
- `TDAI_VIS_API_KEY`

Use `TDAI_VIS_DATA_DIR` for the memory root, `TDAI_VIS_OFFLOAD_ROOT` for offload files when they live outside the default root layout, `TDAI_VIS_GATEWAY_URL` for explicit opt-in debug connectivity, and `TDAI_VIS_GATEWAY_API_KEY` only when the local Gateway requires a bearer token. `TDAI_VIS_API_KEY` is the visualizer's own optional shared Bearer-token gate. Leave it unset for local-only defaults, or set it when you want every read-only `/api/*` route except `GET /health` to require `Authorization: Bearer <key>`, while static SPA assets stay public for the login screen. The Docker sidecar leaves `TDAI_VIS_GATEWAY_URL` unset by default so Search/Recall Debug degrades to disabled instead of proxying recall or search through a reverse proxy accidentally.

### Expected local layout

The visualizer reads layered memory artifacts from a local memory root. A representative seed output layout looks like this:

```text
<data-dir>/
├── conversations/
├── records/
├── scene_blocks/
├── profiles/
├── .metadata/
└── offload/
    └── <agent>/
        ├── refs/
        ├── mmds/
        ├── offload-<session>.jsonl
        └── state.json
```

The seed command writes the documented memory directories such as `conversations/`, `records/`, `scene_blocks/`, and `.metadata/`. Offload inspection expects `refs/`, `mmds/`, `offload-<session>.jsonl`, and `state.json` under the selected offload agent directory.

For live plugin data, point the visualizer at the plugin `dataDir` you already use locally. For example, if your plugin config sets `dataDir` to a workspace-specific memory folder, pass that same folder through `TDAI_VIS_DATA_DIR` or the request path. Do not hardcode another user's home path into docs, config, or screenshots.

### Capability and warning model

Each layer reports a capability status of `available`, `missing`, `partial`, `error`, or `disabled`. Parser and provider warnings are part of the normal degraded-state model. Missing persona files, absent offload roots, corrupt JSONL lines, or invalid Mermaid should degrade to warnings and partial visibility, not surprise writes or repair actions.

### Gateway debug note

Gateway integration is optional and debug-only in this app. `GET /health`, recall checks, and `/search/*` responses are for diagnostics. Gateway `/search/*` output is raw formatted debug text, not structured primary data, and the visualizer should not treat it as the canonical source of records or conversations. The standalone Docker sidecar disables this proxy path by default; to opt in, set `TDAI_VIS_GATEWAY_URL=http://tdai-gateway:8420` and, when auth is enabled, `TDAI_VIS_GATEWAY_API_KEY` in a trusted deployment. The server still exposes only the fixed read/query debug endpoints and no Gateway `/capture`, `/seed`, or `/session/end` passthrough.

### Visualizer access auth note

Visualizer access auth is optional and unset by default. When `TDAI_VIS_API_KEY` is set, `GET /health` stays open and the production static SPA pages continue loading so the browser can render a login screen, but every read-only `/api/*` endpoint still requires `Authorization: Bearer <key>`. Missing or wrong API tokens return HTTP 401 from `/api/*`, the browser login shows a clear error, and no dashboard data renders until the shared key is accepted.

Example protected API request:

```bash
curl -H "Authorization: Bearer $TDAI_VIS_API_KEY" \
     http://127.0.0.1:8421/api/snapshot
```

`GET /health` stays open without a token for health checks. `TDAI_VIS_API_KEY` remains a shared Bearer-token gate rather than a new auth backend: the browser login simply reuses that shared secret for protected `/api/*` calls. Remote browser access still needs HTTPS and any operator-facing authentication or allow-list in front of the visualizer.

### Privacy guidance

Use the visualizer only against local datasets you are allowed to inspect. Memory folders can contain conversation evidence, profiles, scene summaries, and tool output references. Keep the app on a local machine, avoid copying raw datasets into shared screenshots, and prefer synthetic fixtures when demonstrating behavior.

## Read-only Boundary

This app is read-only by design. It does not edit memory, delete memory, merge memory, reindex data, capture conversations, run seed imports, trigger session-end flushes, sync profile writes, write persona files, write scene files, or run DB migrations.

The visualizer must not call or present write actions for these categories:

- no edit
- no delete
- no merge
- no reindex
- no capture
- no seed
- no session-end
- no profile sync writes
- no persona writes
- no scene writes
- no DB migrations

The current safety boundary also means the visualizer is not a replacement for operational tools. Use official CLI or host tools for capture, seed, session lifecycle, repair, or maintenance flows.

## Supported Views

The planned and implemented view set for v1 copy and contracts is:

- Overview
- Scene Map
- Memory Explorer
- Evidence Drill-down
- Offload Task Canvas
- Search/Recall Debug
- Settings/Status

These views are about inspection and debugging. They summarize what exists in local files and optional debug endpoints. They are not a memory editor.

## Limitations

- Local-only by default. Docker sidecar access is intended for trusted operators inspecting their own memory volume, not as a remote multi-user product.
- No multi-user login UI or remote multi-user product scope. `TDAI_VIS_API_KEY` is only an optional shared Bearer-token gate.
- No write-based memory management.
- No edit, delete, reindex, capture, seed, or session-end actions in the UI.
- Gateway `/search/*` is debug text and may not match the structured file-backed snapshot exactly.
- Capability states can be `missing`, `partial`, `error`, or `disabled` when local files are incomplete or degraded.
- SQLite, offload, persona, or scene inputs may exist in different combinations, so empty states and warnings are part of normal operation.

## Official Tool Replacement Strategy

This app is intentionally replaceable. The replacement plan is simple:

1. Keep contracts, docs, fixtures, and scripts app-local so the root plugin and gateway stay untouched.
2. Treat the visualizer as a disposable reader over readonly serializable DTOs and local file layouts.
3. When an official visualization tool ships, move users to that tool for supported UX and long-term ownership.
4. Retire this app by deleting `apps/memory-visualizer/` and this document, or keep it only as an internal fixture reader if still useful.

Because this app does not own writes, migrations, or storage formats, replacement is low-risk. The official tool can take over presentation without needing a compatibility layer for edit or maintenance behavior.

## QA Commands

Run these commands from the repository root:

```bash
node apps/memory-visualizer/scripts/check-docs.mjs
npm --prefix apps/memory-visualizer run typecheck
npm --prefix apps/memory-visualizer test
npm --prefix apps/memory-visualizer run build
npm --prefix apps/memory-visualizer run safety:readonly
npm --prefix apps/memory-visualizer run check:docker
```

The docs checker validates headings, exact commands, boundary exclusions, env vars, and replacement wording. Typecheck confirms the app-local code still compiles. Tests and build cover the server, provider, UI, and production bundle. The readonly safety script confirms production app code stays away from write APIs and forbidden Gateway write endpoints.

The Docker sidecar checker confirms that the standalone Gateway publish remains `127.0.0.1:8420:8420`, the visualizer remains localhost-bound, mounts the shared memory volume read-only, keeps `TDAI_VIS_OFFLOAD_ROOT=/data/memory-tdai/offload`, leaves Gateway debug proxying disabled by default, and does not run the Vite development server in the runtime image.
