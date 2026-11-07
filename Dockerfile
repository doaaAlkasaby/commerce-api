# Immutable multi-architecture Node 24 image; update digest, .nvmrc and CI together.
FROM node:24.22.2-bookworm-slim@sha256:c86ecead9e55a5210ac1727de38a4ca840bf03dcaf34dc9749addbf383b1920c AS base
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app

FROM base AS dependencies
COPY package.json package-lock.json ./
RUN npm ci

FROM dependencies AS build
COPY tsconfig.json prisma7.config.ts ./
COPY prisma ./prisma
COPY src ./src
COPY docs/openapi.json ./docs/openapi.json
# Generation requires a syntactically valid URL, but never connects or migrates.
RUN DATABASE_URL=postgresql://build:build@127.0.0.1:5432/build npm run db:generate
RUN npm run build

FROM base AS production-dependencies
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --omit=optional --ignore-scripts && npm cache clean --force

# Explicit one-shot migration artifact; CLI tooling never ships in the API image.
FROM dependencies AS migration
ENV NODE_ENV=production
COPY prisma7.config.ts ./
COPY prisma/schema.prisma ./prisma/schema.prisma
COPY prisma/migrations ./prisma/migrations
COPY src/config/database-options.ts ./src/config/database-options.ts
COPY deploy/migrate.mjs deploy/environment.mjs ./deploy/
USER node
CMD ["node", "deploy/migrate.mjs"]

FROM base AS runtime
ENV NODE_ENV=production PORT=3000 UPLOAD_DIR=/app/uploads
COPY --from=production-dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json ./
COPY --chown=node:node docs/openapi.json ./docs/openapi.json
COPY --chown=node:node deploy/healthcheck.mjs deploy/check-environment.mjs deploy/environment.mjs ./deploy/
COPY --chmod=755 deploy/entrypoint.sh ./deploy/entrypoint.sh
RUN mkdir -p /app/uploads && chown node:node /app/uploads
USER node
EXPOSE 3000
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=3 CMD ["node", "deploy/healthcheck.mjs"]
ENTRYPOINT ["/app/deploy/entrypoint.sh"]
CMD ["node", "dist/server.js"]
