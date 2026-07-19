# syntax=docker/dockerfile:1

FROM node:22-trixie-slim AS build

ARG BUILD_HASH=dev
WORKDIR /workspace

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY client/package.json client/package.json
COPY server/package.json server/package.json
COPY tools/package.json tools/package.json
COPY packages/protocol/package.json packages/protocol/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/sim/package.json packages/sim/package.json

RUN pnpm install --frozen-lockfile

COPY client client
COPY server server
COPY packages packages
COPY maps maps
COPY tools tools
COPY assets assets

RUN BUILD_HASH="$BUILD_HASH" pnpm --filter @gungame/client build \
  && BUILD_HASH="$BUILD_HASH" pnpm --filter @gungame/server build \
  && node -e "const fs=require('node:fs'); const p='server/node_modules/uWebSockets.js/uws_linux_'+process.arch+'_'+process.versions.modules+'.node'; if(process.platform!=='linux'||process.arch!=='x64'||!fs.existsSync(p)) throw new Error('missing linux/amd64 uWebSockets.js prebuild: '+p)" \
  && mkdir -p /runtime-node-modules \
  && cp -RL server/node_modules/uWebSockets.js /runtime-node-modules/uWebSockets.js

FROM node:22-trixie-slim AS runtime

ENV NODE_ENV=production
ENV PORT=8787
WORKDIR /app

COPY --from=build --chown=node:node /workspace/server/dist server/dist
COPY --from=build --chown=node:node /workspace/client/dist client/dist
COPY --from=build --chown=node:node /workspace/maps maps
COPY --from=build --chown=node:node /runtime-node-modules/uWebSockets.js node_modules/uWebSockets.js

USER node
EXPOSE 8787

CMD ["node", "server/dist/index.js"]
