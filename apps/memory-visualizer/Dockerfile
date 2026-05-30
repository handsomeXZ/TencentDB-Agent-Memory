FROM node:22.16-bookworm-slim AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . ./
RUN npm run build

FROM node:22.16-bookworm-slim AS runtime

ENV NODE_ENV=production
ENV TDAI_VIS_HOST=0.0.0.0
ENV TDAI_VIS_PORT=8421
ENV TDAI_VIS_DATA_DIR=/data/memory-tdai
ENV TDAI_VIS_OFFLOAD_ROOT=/data/memory-tdai/offload

WORKDIR /app

COPY package.json ./
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/dist-server ./dist-server

EXPOSE 8421

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8421/health').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist-server/production.js"]
