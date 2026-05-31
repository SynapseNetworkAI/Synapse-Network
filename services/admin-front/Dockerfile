FROM node:20-alpine AS deps

WORKDIR /app

COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile

FROM node:20-alpine AS builder

WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

ARG NEXT_PUBLIC_ADMIN_API_BASE_URL=
ARG ADMIN_API_PROXY_TARGET=https://admin-api-staging.synapse-network.ai
ARG NEXT_PUBLIC_APP_ENV=staging

ENV NEXT_PUBLIC_ADMIN_API_BASE_URL=$NEXT_PUBLIC_ADMIN_API_BASE_URL
ENV ADMIN_API_PROXY_TARGET=$ADMIN_API_PROXY_TARGET
ENV NEXT_PUBLIC_APP_ENV=$NEXT_PUBLIC_APP_ENV

COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN yarn build

FROM node:20-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app ./

EXPOSE 3000

CMD ["yarn", "start", "-H", "0.0.0.0", "-p", "3000"]
