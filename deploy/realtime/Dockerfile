# The realtime server (Hocuspocus) on your own machine. Built from the repository root:
#   docker build -f deploy/realtime/Dockerfile .
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production DATA_LAYER=postgres REALTIME_PORT=1234
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY lib ./lib
COPY server ./server
COPY tsconfig.json ./
USER node
EXPOSE 1234
CMD ["node_modules/.bin/tsx", "server/realtime.ts"]
