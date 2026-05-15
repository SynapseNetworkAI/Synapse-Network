FROM node:22-alpine AS deps

WORKDIR /app

COPY package.json yarn.lock source.config.ts ./
RUN yarn install --frozen-lockfile

FROM node:22-alpine AS builder

WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

ARG NEXT_PUBLIC_APP_ENV=staging
ARG NEXT_PUBLIC_DOCS_BASE_URL=https://docs-staging.synapse-network.ai
ARG NEXT_PUBLIC_CONSOLE_BASE_URL=https://staging.synapse-network.ai/dashboard/overview
ARG NEXT_PUBLIC_GATEWAY_BASE_URL=https://api-staging.synapse-network.ai

ENV NEXT_PUBLIC_APP_ENV=$NEXT_PUBLIC_APP_ENV
ENV NEXT_PUBLIC_DOCS_BASE_URL=$NEXT_PUBLIC_DOCS_BASE_URL
ENV NEXT_PUBLIC_CONSOLE_BASE_URL=$NEXT_PUBLIC_CONSOLE_BASE_URL
ENV NEXT_PUBLIC_GATEWAY_BASE_URL=$NEXT_PUBLIC_GATEWAY_BASE_URL

COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN yarn build

FROM node:22-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

EXPOSE 3000

CMD ["node", "server.js"]
