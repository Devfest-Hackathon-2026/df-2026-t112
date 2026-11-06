# API (Cloud Run) 用。リポジトリのルートをビルドコンテキストにする。
FROM node:20-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY api/package.json api/
COPY web/package.json web/
RUN npm ci -w api --include-workspace-root
COPY api/tsconfig.json api/
COPY api/src api/src
RUN npm run build -w api

FROM node:20-slim
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
COPY api/package.json api/
COPY web/package.json web/
RUN npm ci -w api --include-workspace-root --omit=dev
COPY --from=build /app/api/dist api/dist
USER node
EXPOSE 8080
CMD ["node", "api/dist/index.js"]
