# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/business/package.json apps/business/package.json
COPY apps/customer/package.json apps/customer/package.json
COPY apps/admin/package.json apps/admin/package.json
COPY apps/pricing/package.json apps/pricing/package.json
RUN npm ci
COPY apps ./apps
# One origin: consumer /, business /business + /app, admin /admin.
RUN VITE_BUSINESS_URL=/business npm run build --workspace @nitewide/customer && \
    VITE_BUSINESS_HOME=/business VITE_CUSTOMER_URL=/ npm run build --workspace @nitewide/business -- --base=/business/ && \
    VITE_CUSTOMER_URL=/ VITE_BUSINESS_URL=/business npm run build --workspace @nitewide/admin -- --base=/admin/

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production PORT=10000
WORKDIR /app
COPY --from=build /app/package*.json ./
COPY --from=build /app/apps/api/package.json apps/api/package.json
COPY --from=build /app/apps/business/package.json apps/business/package.json
COPY --from=build /app/apps/customer/package.json apps/customer/package.json
COPY --from=build /app/apps/admin/package.json apps/admin/package.json
COPY --from=build /app/apps/pricing apps/pricing
# Migration CLI is an explicit runtime dependency for this demo image.
RUN npm ci --omit=dev --workspace @nitewide/api --workspace @nitewide/pricing && npm cache clean --force
COPY --from=build /app/apps/api/src apps/api/src
COPY --from=build /app/apps/api/.sequelizerc apps/api/.sequelizerc
COPY --from=build /app/apps/customer/dist apps/customer/dist
COPY --from=build /app/apps/business/dist apps/business/dist
COPY --from=build /app/apps/admin/dist apps/admin/dist
COPY deploy ./deploy
RUN mkdir -p /app/media && chown node:node /app/media
USER node
EXPOSE 10000
HEALTHCHECK --interval=30s --timeout=5s --start-period=120s CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "deploy/start.cjs"]
