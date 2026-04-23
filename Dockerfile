FROM node:22-alpine AS build

WORKDIR /app

ENV CI=true

RUN npm install -g pnpm@10.18.1

COPY package.json pnpm-lock.yaml ./
COPY scripts ./scripts
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

FROM nginx:1.27-alpine

LABEL maintainer="Unitystack" \
  org.opencontainers.image.title="OpenCloud Web Extension: Excalidraw" \
  org.opencontainers.image.description="Excalidraw extension for OpenCloud Web"

RUN rm -f /usr/share/nginx/html/*

COPY --from=build /app/dist /usr/share/nginx/html/apps/excalidraw

STOPSIGNAL SIGTERM

CMD ["nginx", "-g", "daemon off;"]
WORKDIR /usr/share/nginx/html
