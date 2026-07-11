# syntax=docker/dockerfile:1.7

FROM node:22-alpine AS build

ARG PNPM_VERSION=11.7.0
RUN npm install --global "pnpm@${PNPM_VERSION}"

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

COPY index.html tsconfig.json vite.config.ts ./
COPY src ./src
COPY public ./public

RUN pnpm build

FROM node:22-alpine AS production

ARG PNPM_VERSION=11.7.0
RUN npm install --global "pnpm@${PNPM_VERSION}"

ENV NODE_ENV=production \
    PORT=4173 \
    ROOM_TTL_HOURS=24

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --prod --frozen-lockfile

COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/dist-server ./dist-server

USER node

EXPOSE 4173

CMD ["node", "dist-server/index.js"]
