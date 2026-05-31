FROM node:22.16-bookworm-slim

ARG TDAI_RELEASE_TAG=v1.0.0-beta.1
ARG TDAI_RELEASE_COMMIT=36b0537676dc31b7b1a61f23521303c9a148b509
ARG TDAI_REPO=https://github.com/Tencent/TencentDB-Agent-Memory.git

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/tdai-gateway

RUN git init . \
    && git remote add origin "${TDAI_REPO}" \
    && git fetch --depth 1 origin "${TDAI_RELEASE_TAG}" \
    && git checkout --detach FETCH_HEAD \
    && test "$(git rev-parse HEAD)" = "${TDAI_RELEASE_COMMIT}" \
    && npm install --omit=dev \
    && rm -rf .git \
    && npm cache clean --force

ENV TDAI_GATEWAY_CONFIG=/config/tdai-gateway.standalone.yaml
ENV TDAI_DATA_DIR=/data/memory-tdai
ENV TDAI_GATEWAY_HOST=0.0.0.0
ENV TDAI_GATEWAY_PORT=8420
ENV TDAI_DEPLOY_MODE=standalone
ENV TDAI_RELEASE_COMMIT=${TDAI_RELEASE_COMMIT}

WORKDIR /opt/tdai-gateway

RUN printf '%s\n' \
  '#!/bin/sh' \
  'set -eu' \
  '' \
  'require_env() {' \
  '  name="$1"' \
  '  placeholder="$2"' \
  '  value=$(printenv "$name" || true)' \
  '  if [ -z "$value" ] || [ "$value" = "$placeholder" ]; then' \
  '    echo "error: required env $name is missing or still set to the example placeholder" >&2' \
  '    exit 1' \
  '  fi' \
  '}' \
  '' \
  'require_env OPENROUTER_API_KEY your-openrouter-api-key' \
  'require_env TDAI_LLM_API_KEY your-chat-llm-api-key' \
  'require_env TDAI_GATEWAY_API_KEY replace-with-a-long-random-token' \
  '' \
  'exec node --import tsx/esm src/gateway/server.ts' \
  > /usr/local/bin/tdai-gateway-entrypoint \
  && chmod +x /usr/local/bin/tdai-gateway-entrypoint

EXPOSE 8420
VOLUME ["/data/memory-tdai"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://127.0.0.1:8420/health || exit 1

CMD ["/usr/local/bin/tdai-gateway-entrypoint"]
