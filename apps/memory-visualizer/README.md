# Memory Visualizer

Isolated Vite + React + TypeScript scaffold for a future read-only TencentDB Agent Memory visualizer.

Run commands from the repository root with `npm --prefix apps/memory-visualizer ...` so this app remains app-local and replaceable.

## Usage Notes

This app is local-only, read-only, non-invasive, and app-local. It is meant for white-box inspection of existing TencentDB Agent Memory artifacts, not for operating the memory system.

Primary commands:

```bash
npm --prefix apps/memory-visualizer install
npm --prefix apps/memory-visualizer run dev
npm --prefix apps/memory-visualizer run build
npm --prefix apps/memory-visualizer run start
npm --prefix apps/memory-visualizer test
```

Required verification commands:

```bash
node apps/memory-visualizer/scripts/check-docs.mjs
npm --prefix apps/memory-visualizer run typecheck
npm --prefix apps/memory-visualizer test
npm --prefix apps/memory-visualizer run build
npm --prefix apps/memory-visualizer run safety:readonly
npm --prefix apps/memory-visualizer run check:docker
```

Production sidecar commands:

```bash
docker build -f apps/memory-visualizer/Dockerfile -t tdai-memory-visualizer:local apps/memory-visualizer
docker compose -f docker/standalone/docker-compose.yml config
docker compose -f docker/standalone/docker-compose.ghcr.yml config
```

The production `start` command serves the built Vite assets and the read-only `/api/*` DTO endpoints from one Node process. It does not run the Vite development server. Direct `npm --prefix apps/memory-visualizer run start` listens on `127.0.0.1:8421` by default; the Dockerfile and compose service explicitly set `TDAI_VIS_HOST=0.0.0.0` only for container-internal listening. In the standalone Docker compose files, the `tdai-visualizer` sidecar mounts `tdai_memory_data` at `/data/memory-tdai:ro`, uses `TDAI_VIS_OFFLOAD_ROOT=/data/memory-tdai/offload`, and binds `127.0.0.1:8421:8421` by default.

The GHCR deployment stays split by design: `ghcr.io/<owner>/tencentdb-agent-memory` is Gateway-only, while `ghcr.io/<owner>/tencentdb-agent-memory-visualizer` is the sidecar image. The expected startup log `Memory Visualizer listening on http://0.0.0.0:8421` appears in the visualizer container logs, not in the Gateway container logs.

Primary data source env vars:

- `TDAI_VIS_DATA_DIR`
- `TDAI_VIS_OFFLOAD_ROOT`
- `TDAI_VIS_GATEWAY_URL`
- `TDAI_VIS_GATEWAY_API_KEY`

Visualizer access auth env var:

- `TDAI_VIS_API_KEY`

Data source priority is request or UI path, then environment variables, then app-local config, then empty state and default examples.

Read-only boundary summary:

- no edit
- no delete
- no merge
- no reindex
- no capture
- no seed
- no session-end

Gateway `/search/*` is debug text, not structured primary data. The Docker sidecar disables Gateway debug proxying by default; leave `TDAI_VIS_GATEWAY_URL` unset unless a trusted operator explicitly opts in to the fixed read/query debug endpoints. For fuller scope, boundaries, supported views, privacy guidance, and the official replacement plan, see [`../../docs/visualization-web.md`](../../docs/visualization-web.md).

For visualizer access, `TDAI_VIS_API_KEY` is optional and unset by default so existing local-only usage keeps working unchanged. When it is set, `GET /health` stays open, the production static SPA pages and assets still load so the browser can show the login screen, and every read-only `/api/*` route continues to require `Authorization: Bearer <key>`. Missing or wrong API tokens return HTTP 401 from `/api/*`, and the browser UI prompts for the shared key, stores it in `sessionStorage` for the current tab, and attaches `Authorization: Bearer <key>` to subsequent dashboard requests until logout clears that session value.

Example protected API request:

```bash
curl -H "Authorization: Bearer $TDAI_VIS_API_KEY" \
     http://127.0.0.1:8421/api/snapshot
```

`GET /health` stays open without a token for health checks. `TDAI_VIS_API_KEY` is still a shared Bearer-token gate rather than a multi-user auth backend; the login screen only lets a browser reuse that same shared secret for `/api/*`. For remote browser access, still put HTTPS and any operator-facing authentication or allow-list in front of the visualizer. Do not expose the Gateway write-capable `8420` port publicly just to view this dashboard.
