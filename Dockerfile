# One image for both Cloud Run workloads:
#   service (API):  default CMD
#   job (pipeline): command override `bun scripts/pipeline.ts --once`
# No secrets in the image: they come from Secret Manager as environment variables.
FROM oven/bun:1.4.4-slim

WORKDIR /app
ENV NODE_ENV=production

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts

USER bun
CMD ["bun", "src/index.ts"]
