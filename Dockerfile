# ---- build the SPA ----
FROM node:22-bookworm AS build
RUN corepack enable pnpm
WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
COPY packages/driver-sdk/package.json packages/driver-sdk/
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm --filter @fe2o3/web build

# ---- runtime: server runs from TypeScript sources via tsx ----
FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && corepack enable pnpm
WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/server/package.json apps/server/
COPY packages packages/
RUN pnpm install --frozen-lockfile --filter @fe2o3/server --prod
COPY apps/server/src apps/server/src
COPY apps/server/drizzle.config.ts apps/server/
COPY --from=build /app/apps/web/dist apps/web/dist

ENV FE2O3_DATA_DIR=/data
ENV NODE_ENV=production
VOLUME /data
EXPOSE 8442
WORKDIR /app/apps/server
CMD ["./node_modules/.bin/tsx", "src/index.ts"]
