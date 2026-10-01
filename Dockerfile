FROM node:26-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm rebuild better-sqlite3 && npm run build && npm prune --omit=dev && npm rebuild better-sqlite3

FROM node:26-bookworm-slim AS runtime
ENV NODE_ENV=production \
    PMT_DATA_DIR=/data \
    PMT_HOST=0.0.0.0 \
    PMT_PORT=3000 \
    PMT_MCP_ROLE=read \
    PMT_EXECUTION_ENABLED=false
WORKDIR /app
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node public ./public
COPY --chown=node:node tests/fixtures ./tests/fixtures
COPY --chown=node:node artifacts/wr-2024-replay ./artifacts/wr-2024-replay
COPY --chown=node:node deploy/scripts ./deploy/scripts
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 3000
CMD ["node", "dist/src/cli.js", "serve"]
