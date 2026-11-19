# Intra Reimagined API. Node 26 runs the TypeScript sources directly (type stripping): no build step.

# Install production dependencies with pnpm (Node 25+ no longer ships corepack, so install it).
FROM node:26-alpine AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN npm install -g "$(node -p "require('./package.json').packageManager")" \
 && pnpm install --prod --frozen-lockfile

# Runtime: node + node_modules + sources, no pnpm.
FROM node:26-alpine
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json *.ts ./

ENV NODE_ENV=production HOST=0.0.0.0 PORT=8787
EXPOSE 8787
USER node

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8787/health || exit 1

CMD ["node", "index.ts"]
