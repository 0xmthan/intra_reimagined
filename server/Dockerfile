# Intra Reimagined API. Node 26 runs the TypeScript sources directly (type stripping): no build step.
FROM node:26-alpine

WORKDIR /app
RUN corepack enable

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --prod --frozen-lockfile

COPY *.ts ./

ENV NODE_ENV=production HOST=0.0.0.0 PORT=8787
EXPOSE 8787
USER node

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8787/health || exit 1

CMD ["node", "index.ts"]
