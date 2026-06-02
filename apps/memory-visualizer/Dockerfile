FROM node:22.16-bookworm-slim AS builder

WORKDIR /repo

COPY apps/memory-visualizer/package.json apps/memory-visualizer/package-lock.json ./apps/memory-visualizer/
WORKDIR /repo/apps/memory-visualizer
RUN npm ci

WORKDIR /repo
COPY apps/memory-visualizer/index.html apps/memory-visualizer/tsconfig.json apps/memory-visualizer/vite.config.ts apps/memory-visualizer/vite.server.config.ts ./apps/memory-visualizer/
COPY apps/memory-visualizer/src ./apps/memory-visualizer/src
COPY src/telemetry ./src/telemetry
WORKDIR /repo/apps/memory-visualizer
RUN npm run build

FROM node:22.16-bookworm-slim AS runtime

ENV NODE_ENV=production
ENV TDAI_VIS_HOST=0.0.0.0
ENV TDAI_VIS_PORT=8421
ENV TDAI_VIS_DATA_DIR=/data/memory-tdai
ENV TDAI_VIS_OFFLOAD_ROOT=/data/memory-tdai/offload
ENV TDAI_TELEMETRY_DIR=/data/request-telemetry

WORKDIR /app

COPY apps/memory-visualizer/package.json ./
COPY --from=builder /repo/apps/memory-visualizer/dist ./dist
COPY --from=builder /repo/apps/memory-visualizer/dist-server ./dist-server

EXPOSE 8421

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8421/health').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist-server/production.js"]
