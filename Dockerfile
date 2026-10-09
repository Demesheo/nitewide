# syntax=docker/dockerfile:1
FROM node:24.21.0-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/business/package.json apps/business/package.json
COPY apps/customer/package.json apps/customer/package.json
COPY apps/admin/package.json apps/admin/package.json
COPY apps/pricing/package.json apps/pricing/package.json
RUN npm install --global npm@12.1.0 && npm ci
COPY apps ./apps
# Shared-origin paths: customer /, Business /business, Admin /admin.
RUN VITE_BUSINESS_URL=/business npm run build --workspace @nitewide/customer && \
    VITE_BUSINESS_HOME=/business VITE_CUSTOMER_URL=/ npm run build --workspace @nitewide/business -- --base=/business/ && \
    VITE_CUSTOMER_URL=/ VITE_BUSINESS_URL=/business npm run build --workspace @nitewide/admin -- --base=/admin/

FROM node:24.21.0-bookworm-slim AS runtime
ENV NODE_ENV=production PORT=10000
WORKDIR /app
COPY --from=build /app/package*.json ./
COPY --from=build /app/apps/api/package.json apps/api/package.json
COPY --from=build /app/apps/business/package.json apps/business/package.json
COPY --from=build /app/apps/customer/package.json apps/customer/package.json
COPY --from=build /app/apps/admin/package.json apps/admin/package.json
COPY --from=build /app/apps/pricing apps/pricing
# Migration CLI is an explicit runtime dependency; regular releases run it in a separate pre-deploy step.
RUN npm install --global npm@12.1.0 && npm ci --omit=dev --workspace @nitewide/api --workspace @nitewide/pricing && npm cache clean --force
COPY --from=build /app/apps/api/src apps/api/src
COPY --from=build /app/apps/shared/legal apps/shared/legal
COPY --from=build /app/apps/shared/discovery-areas.mjs apps/shared/discovery-areas.mjs
COPY --from=build /app/apps/shared/report-dates.mjs apps/shared/report-dates.mjs
COPY --from=build /app/apps/shared/public-links.mjs apps/shared/public-links.mjs
COPY --from=build /app/apps/shared/public-metadata.mjs apps/shared/public-metadata.mjs
# Public landing claims are shared with server-rendered HTML; no React runtime
# or private workspace source is needed in the serving image.
COPY --from=build /app/apps/business/src/lib/landing-content.js apps/business/src/lib/landing-content.js
COPY --from=build /app/apps/api/.sequelizerc apps/api/.sequelizerc
COPY --from=build /app/apps/customer/dist apps/customer/dist
COPY --from=build /app/apps/business/dist apps/business/dist
COPY --from=build /app/apps/admin/dist apps/admin/dist
COPY deploy ./deploy
ARG RELEASE_REVISION
# Public commit identity only; payment credentials remain runtime secrets.
RUN node -e 'const fs=require("node:fs"); const revision=process.env.RELEASE_REVISION || ""; if(revision && !/^[a-f0-9]{40}$/.test(revision)) throw Error("Invalid release revision"); fs.writeFileSync("/app/apps/api/release.json", JSON.stringify({revision: revision || null}));'
RUN mkdir -p /app/media && chown node:node /app/media
USER node
EXPOSE 10000
# The worker has no HTTP listener; its heartbeat is monitored in PostgreSQL.
HEALTHCHECK --interval=30s --timeout=5s --start-period=120s CMD node -e "if(process.env.APP_ENVIRONMENT && process.env.SERVE_FRONTENDS==='false') process.exit(0); fetch('http://127.0.0.1:'+process.env.PORT+'/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# Preserve the current demo; release services override CMD with deploy/run.cjs.
CMD ["node", "deploy/start.cjs"]
