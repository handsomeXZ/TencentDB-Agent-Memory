# TencentDB Agent Memory Gateway Standalone Docker

This directory builds a Gateway Docker image for TencentDB Agent Memory and wires an optional read-only Memory Visualizer sidecar. The Gateway image clones the GitHub release tag `v1.0.0-beta.1`, verifies that the checked-out commit is exactly `36b0537676dc31b7b1a61f23521303c9a148b509`, installs runtime dependencies from that source tree, and starts the Node Gateway. It does not install or run Hermes, OpenClaw, or any host agent.

The standalone config uses OpenRouter embeddings with `qwen/qwen3-embedding-8b` at 4096 dimensions. The L1/L2/L3 memory extraction pipeline still needs a separate chat/completion LLM, configured with `TDAI_LLM_BASE_URL`, `TDAI_LLM_API_KEY`, and `TDAI_LLM_MODEL`.

## Files

- `Dockerfile`: Node 22.16 Gateway-only image pinned to GitHub tag `v1.0.0-beta.1` and verified against commit `36b0537676dc31b7b1a61f23521303c9a148b509`.
- `docker-compose.yml`: Gateway service, read-only visualizer sidecar, shared data volume, config mount, port mappings, and healthchecks.
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
```

The container fails fast at startup if `OPENROUTER_API_KEY`, `TDAI_LLM_API_KEY`, or `TDAI_GATEWAY_API_KEY` is empty or still set to the example placeholder value.

Do not put real API keys in `Dockerfile`, `docker-compose.yml`, or `tdai-gateway.standalone.yaml`.

## Build

Both commands below build from the `docker/standalone` directory. During the image build, Docker clones GitHub tag `v1.0.0-beta.1` inside the image, verifies that `git rev-parse HEAD` matches `36b0537676dc31b7b1a61f23521303c9a148b509`, and then installs dependencies instead of pulling the beta package from npm.

```bash
cd docker/standalone
docker compose build
```

Or build directly:

```bash
cd docker/standalone
docker build -t tdai-memory-gateway:1.0.0-beta.1 .
```

## Publish To GHCR

The repository includes `.github/workflows/publish-ghcr.yml` for publishing the standalone Gateway image to GitHub Container Registry. It runs on pushes to `main`, semantic version tags matching `v*.*.*`, and manual `workflow_dispatch` runs.

Published images use this path:

```text
ghcr.io/<github-owner-lowercase>/tencentdb-agent-memory
```

Every workflow build pushes `latest` in addition to traceable tags:

- branch builds also push the branch tag, for example `main`.
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
```

`GHCR_TOKEN` needs `write:packages` permission. If a deployment platform cannot pull the image, make the GitHub Package public or configure GHCR pull credentials there.

## Run

```bash
cd docker/standalone
docker compose up -d
```

The default compose publish is `127.0.0.1:8420:8420`, so the Gateway listens on `http://127.0.0.1:8420` by default and stores data in the named Docker volume `tdai_memory_data`, mounted read-write at `/data/memory-tdai` inside the Gateway container.

The compose file also starts `tdai-visualizer` on `http://127.0.0.1:8421`. It mounts the same `tdai_memory_data` volume read-only at `/data/memory-tdai:ro`, sets `TDAI_VIS_DATA_DIR=/data/memory-tdai` and `TDAI_VIS_OFFLOAD_ROOT=/data/memory-tdai/offload`, and serves the dashboard plus read-only `/api/*` endpoints from one Node process. It does not run the Vite development server.

Gateway Search/Recall Debug proxying is disabled by default in the sidecar because recall and search can reveal memory contents. To opt in for a trusted local deployment, add `TDAI_VIS_GATEWAY_URL=http://tdai-gateway:8420` to the `tdai-visualizer` environment and add `TDAI_VIS_GATEWAY_API_KEY=${TDAI_GATEWAY_API_KEY:-}` only when the Gateway requires the bearer token. The visualizer still allows only fixed read/query debug endpoints and no `/capture`, `/seed`, or `/session/end` passthrough.

If you need to expose the Gateway beyond localhost, first set a strong non-empty `TDAI_GATEWAY_API_KEY`, then add network controls such as a firewall rule, reverse proxy allow-list, private subnet, or VPN before changing the published host binding.

If you need to open the visualizer to another machine, prefer an authenticated HTTPS reverse proxy in front of `127.0.0.1:8421`. Do not expose the Gateway write-capable `8420` port publicly just to view memory data.

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
```

The visualizer sidecar sets these runtime values:

```bash
TDAI_VIS_DATA_DIR=/data/memory-tdai
TDAI_VIS_OFFLOAD_ROOT=/data/memory-tdai/offload
TDAI_VIS_HOST=0.0.0.0
TDAI_VIS_PORT=8421
```

`TDAI_VIS_GATEWAY_URL` is intentionally absent from those defaults. Set it explicitly only when enabling Search/Recall Debug in a trusted environment.

The Gateway command is:

```bash
node --import tsx/esm src/gateway/server.ts
```

The visualizer command is:

```bash
node dist-server/production.js
```
