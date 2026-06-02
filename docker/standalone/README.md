# TencentDB Agent Memory Gateway Standalone Docker

This directory builds a Gateway Docker image for TencentDB Agent Memory and wires an optional read-only Memory Visualizer sidecar. The Gateway image clones a configured Git ref, installs runtime dependencies from that source tree, and starts the Node Gateway. Local builds default to the `dev` ref so the standalone Gateway can pick up current Gateway APIs; release and GHCR builds pass an exact commit through `TDAI_RELEASE_COMMIT` for reproducibility. It does not install or run Hermes, OpenClaw, or any host agent.

The standalone config uses OpenRouter embeddings with `qwen/qwen3-embedding-8b` at 4096 dimensions. The L1/L2/L3 memory extraction pipeline still needs a separate chat/completion LLM, configured with `TDAI_LLM_BASE_URL`, `TDAI_LLM_API_KEY`, and `TDAI_LLM_MODEL`.

## Files

- `Dockerfile`: Node 22.16 Gateway-only image that clones `TDAI_RELEASE_TAG` from `TDAI_REPO`, optionally verifies `TDAI_RELEASE_COMMIT`, and starts the Gateway.
- `docker-compose.yml`: local build-from-source Gateway service, read-only visualizer sidecar, shared memory volume, separate telemetry volume, config mount, port mappings, and healthchecks.
- `docker-compose.ghcr.yml`: GHCR-based Gateway plus read-only visualizer sidecar using published images instead of local build contexts.
- `tdai-gateway.standalone.yaml`: Gateway, data, LLM, and OpenRouter embedding config.
- `.env.example`: Secret-safe template. Copy it to `.env.local` before running.

## Configure Secrets

Create a local env file from the example and edit it with your real keys:

```bash
cd docker/standalone
cp .env.example .env.local
```

Set these values in `.env.local`:

```bash
OPENROUTER_API_KEY=your-openrouter-api-key
TDAI_LLM_BASE_URL=https://api.openai.com/v1
TDAI_LLM_API_KEY=your-chat-llm-api-key
TDAI_LLM_MODEL=gpt-4o-mini
TDAI_GATEWAY_API_KEY=replace-with-a-long-random-token
TDAI_VIS_API_KEY=replace-with-a-second-long-random-token
```

The container fails fast at startup if `OPENROUTER_API_KEY`, `TDAI_LLM_API_KEY`, or `TDAI_GATEWAY_API_KEY` is empty or still set to the example placeholder value.

Do not put real API keys in `Dockerfile`, `docker-compose.yml`, or `tdai-gateway.standalone.yaml`.

## Build

Both commands below build from the `docker/standalone` directory. During the image build, Docker clones `TDAI_RELEASE_TAG` from `TDAI_REPO` inside the image and installs dependencies from that source tree instead of pulling a package from npm. The default local build uses `TDAI_RELEASE_TAG=dev`; pass both `TDAI_RELEASE_TAG` and `TDAI_RELEASE_COMMIT` when you need an exact reproducible source revision.

```bash
cd docker/standalone
docker compose build
```

Or build directly:

```bash
cd docker/standalone
docker build -t tdai-memory-gateway:local .
```

## Publish To GHCR

The repository includes `.github/workflows/publish-ghcr.yml` for publishing the standalone Gateway image and the separate Memory Visualizer sidecar image to GitHub Container Registry. It runs on pushes to `dev`, semantic version tags matching `v*.*.*`, and manual `workflow_dispatch` runs.

Published images use these paths:

```text
ghcr.io/<github-owner-lowercase>/tencentdb-agent-memory
ghcr.io/<github-owner-lowercase>/tencentdb-agent-memory-visualizer
```

`ghcr.io/<owner>/tencentdb-agent-memory` is Gateway-only. It starts `tdai-gateway-entrypoint` and cannot emit the visualizer startup log because it does not run the visualizer process.

`ghcr.io/<owner>/tencentdb-agent-memory-visualizer` is the separate sidecar image. That container should log `Memory Visualizer listening on http://0.0.0.0:8421` during startup.

Every workflow build pushes matching tags for both images:

- branch builds also push the branch tag, for example `dev`.
- version tag builds also push the Git tag, for example `v1.0.0`.
- all builds push a commit tag, for example `sha-<commit>`.

The workflow builds from the triggering repository and commit, so forks publish their own GHCR image under the fork owner. GitHub repository and organization names are normalized to lowercase for Docker compatibility.

Manual local publish example:

```bash
echo "$GHCR_TOKEN" | docker login ghcr.io -u YOUR_GITHUB_USERNAME --password-stdin
docker build \
  --build-arg TDAI_REPO=https://github.com/YOUR_GITHUB_USERNAME/TencentDB-Agent-Memory.git \
  --build-arg TDAI_RELEASE_TAG=$(git rev-parse HEAD) \
  --build-arg TDAI_RELEASE_COMMIT=$(git rev-parse HEAD) \
  -f docker/standalone/Dockerfile \
  -t ghcr.io/your_github_username/tencentdb-agent-memory:latest \
  docker/standalone
docker push ghcr.io/your_github_username/tencentdb-agent-memory:latest

docker build \
  -f apps/memory-visualizer/Dockerfile \
  -t ghcr.io/your_github_username/tencentdb-agent-memory-visualizer:latest \
  .
docker push ghcr.io/your_github_username/tencentdb-agent-memory-visualizer:latest
```

Run the visualizer image build from the repository root. Its Dockerfile uses the root build context because the Visualizer server imports shared telemetry modules from `src/telemetry/*` outside `apps/memory-visualizer`.

`GHCR_TOKEN` needs `write:packages` permission. If a deployment platform cannot pull the image, make the GitHub Package public or configure GHCR pull credentials there.

## Run

```bash
cd docker/standalone
docker compose up -d
```

The default compose publish is `127.0.0.1:8420:8420`, so the Gateway listens on `http://127.0.0.1:8420` by default and stores memory data in the named Docker volume `tdai_memory_data`, mounted read-write at `/data/memory-tdai` inside the Gateway container.

The compose file also starts `tdai-visualizer` on `http://127.0.0.1:8421`. It mounts the same `tdai_memory_data` volume read-only at `/data/memory-tdai:ro`, sets `TDAI_VIS_DATA_DIR=/data/memory-tdai` and `TDAI_VIS_OFFLOAD_ROOT=/data/memory-tdai/offload`, mounts a separate writable `tdai_request_telemetry` volume at `/data/request-telemetry`, sets `TDAI_TELEMETRY_DIR=/data/request-telemetry`, and serves the dashboard plus read-only `/api/*` endpoints from one Node process. It does not run the Vite development server. Set `TDAI_VIS_API_KEY` in `.env.local`; production visualizer APIs fail closed without it.

Telemetry path precedence is role-specific. Gateway writer precedence is `TDAI_GATEWAY_TELEMETRY_DIR`, then `TDAI_TELEMETRY_DIR`, then disabled. Visualizer writer and reader precedence is `TDAI_VIS_TELEMETRY_DIR`, then `TDAI_TELEMETRY_DIR`, then disabled. Standalone compose uses the shared default `TDAI_TELEMETRY_DIR=/data/request-telemetry`, so both processes read and write telemetry without ever making `/data/memory-tdai` writable inside the visualizer.

To run from published GHCR images instead of local build contexts:

```bash
cd docker/standalone
docker compose -f docker-compose.ghcr.yml pull
docker compose -f docker-compose.ghcr.yml up -d
```

`docker-compose.ghcr.yml` defaults `TDAI_GHCR_OWNER` to `handsomexz` and `TDAI_GHCR_TAG` to `latest`. Override them when you want a different owner or a branch, release, or `sha-<commit>` tag:

```bash
cd docker/standalone
TDAI_GHCR_OWNER=your_github_username TDAI_GHCR_TAG=sha-<commit> docker compose -f docker-compose.ghcr.yml up -d
```

Gateway Search/Recall Debug proxying is disabled by default in the sidecar because recall and search can reveal memory contents. To opt in while still using the default local filesystem data source, leave `TDAI_VIS_DATA_SOURCE` unset or local, add `TDAI_VIS_GATEWAY_URL=http://tdai-gateway:8420` to the `tdai-visualizer` environment, and add `TDAI_VIS_GATEWAY_API_KEY=${TDAI_GATEWAY_API_KEY:-}` only when the Gateway requires the bearer token. The visualizer still allows only fixed read/query debug endpoints and no `/capture`, `/seed`, or `/session/end` passthrough.

Requests Monitor is observability-only. It reads append-only telemetry JSONL files and does not add capture, seed, session-end, reindex, or any other control surface.

Telemetry privacy is intentionally narrow: the monitor stores pathname and allowlisted query key names only. It does not store raw URL values, raw query values, request bodies, response bodies, headers, prompts, tokens, secrets, or memory content. Health, static asset, and Requests Monitor routes are skipped by default so the telemetry files stay focused on real operational traffic.

If you need to expose the Gateway beyond localhost, first set a strong non-empty `TDAI_GATEWAY_API_KEY`, then add network controls such as a firewall rule, reverse proxy allow-list, private subnet, or VPN before changing the published host binding.

If you need to open the visualizer to another machine, keep `TDAI_VIS_API_KEY` set on the `tdai-visualizer` service so every read-only `/api/*` route except `GET /health` requires `Authorization: Bearer <key>`, while the SPA shell itself still loads for the browser login screen. That gate is still only a shared Bearer token, not a multi-user auth backend, so prefer an authenticated HTTPS reverse proxy or allow-list in front of `127.0.0.1:8421`. Do not expose the Gateway write-capable `8420` port publicly just to view memory data.

## Health Check

`GET /health` does not require authentication:

```bash
curl http://127.0.0.1:8420/health
curl http://127.0.0.1:8421/health
```

The Gateway container includes a Docker healthcheck for `http://127.0.0.1:8420/health`. The visualizer sidecar includes a Docker healthcheck for `http://127.0.0.1:8421/health`.

## Authenticated Requests

When `TDAI_GATEWAY_API_KEY` is set in `.env.local`, all routes except `GET /health` require a Bearer token.

Set the token in your shell:

```bash
export TDAI_GATEWAY_API_KEY="replace-with-a-long-random-token"
```

Test an authenticated recall request:

```bash
curl -X POST http://127.0.0.1:8420/recall \
  -H "Authorization: Bearer ${TDAI_GATEWAY_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"query":"test memory","session_key":"standalone-demo"}'
```

The visualizer has its own auth gate in production containers. Set `TDAI_VIS_API_KEY` on `tdai-visualizer` so every read-only `/api/*` route except `GET /health` requires a Bearer token.

Example protected visualizer request after exporting your own `TDAI_VIS_API_KEY`:

```bash
curl -H "Authorization: Bearer ${TDAI_VIS_API_KEY}" \
  http://127.0.0.1:8421/api/snapshot
```

`GET /health` stays open without a token for Docker healthchecks and other probes. The production static SPA shell and assets still load without a token so the browser can render the shared-key login screen, but dashboard data stays behind the Bearer check on `/api/*`.

## CORS

Set `TDAI_CORS_ORIGINS` in `.env.local` when a browser client needs cross-origin access:

```bash
TDAI_CORS_ORIGINS=http://localhost:3000
```

This works because `tdai-gateway.standalone.yaml` does not set `server.corsOrigins`. If `TDAI_CORS_ORIGINS` is unset, the default remains no CORS response headers.

## SDK v2 Notes

For SDK v2 clients, use:

- endpoint: `http://127.0.0.1:8420`
- serviceId or service_id: `default`
- apiKey or api_key: the same value as `TDAI_GATEWAY_API_KEY` when auth is enabled

If you explicitly disable gateway auth for local-only testing, use a non-empty local value such as `local` for the SDK field instead of an empty string.

## Logs And Shutdown

```bash
cd docker/standalone
docker compose logs -f tdai-gateway
docker compose logs -f tdai-visualizer
docker compose down
```

The visualizer startup log belongs in the `tdai-visualizer` container logs, not the Gateway logs:

```bash
cd docker/standalone
docker compose -f docker-compose.ghcr.yml logs tdai-visualizer
```

Look for:

```text
Memory Visualizer listening on http://0.0.0.0:8421
```

To remove the persisted memory volume as well:

```bash
cd docker/standalone
docker compose down -v
```

## Runtime Defaults

The image and compose file set these runtime values:

```bash
TDAI_GATEWAY_CONFIG=/config/tdai-gateway.standalone.yaml
TDAI_DATA_DIR=/data/memory-tdai
TDAI_GATEWAY_HOST=0.0.0.0
TDAI_GATEWAY_PORT=8420
TDAI_DEPLOY_MODE=standalone
TDAI_TELEMETRY_DIR=/data/request-telemetry
```

The visualizer sidecar sets these runtime values:

```bash
TDAI_VIS_DATA_DIR=/data/memory-tdai
TDAI_VIS_OFFLOAD_ROOT=/data/memory-tdai/offload
TDAI_VIS_HOST=0.0.0.0
TDAI_VIS_PORT=8421
TDAI_TELEMETRY_DIR=/data/request-telemetry
```

`TDAI_VIS_GATEWAY_URL` is intentionally absent from those defaults. Set it explicitly only when enabling Search/Recall Debug in a trusted local-source environment, or when `TDAI_VIS_DATA_SOURCE=gateway` makes Gateway `/visualizer/*` the primary dashboard DTO source.

If your deployment platform cannot mount the same `tdai_memory_data` volume into both containers, run the visualizer in remote Gateway data-source mode instead of using `TDAI_VIS_DATA_DIR`: set `TDAI_VIS_DATA_SOURCE=gateway`, `TDAI_VIS_GATEWAY_URL=http://<gateway-service>:8420`, and `TDAI_VIS_GATEWAY_API_KEY=${TDAI_GATEWAY_API_KEY}`. The Gateway `/visualizer/*` endpoints require `TDAI_GATEWAY_API_KEY` and only serve read-only dashboard DTOs; this mode is distinct from Search/Recall Debug even though it reuses the same Gateway URL variable.

`TDAI_VIS_API_KEY` is intentionally not hard-coded in the image. Set it in `.env.local` or the deployment platform environment; production `/api/*` requests fail closed with `auth-not-configured` when it is missing.

The Gateway command is:

```bash
node --import tsx/esm src/gateway/server.ts
```

The visualizer command is:

```bash
node dist-server/production.js
```
