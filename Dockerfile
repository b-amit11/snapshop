# SnapShop server + website in one container.
FROM node:22-alpine AS build
WORKDIR /app/server
COPY server/package*.json ./
RUN npm install
COPY server/ ./
RUN npm run build

FROM node:22-alpine
ENV NODE_ENV=production PORT=8787
WORKDIR /app
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/server/package.json ./server/package.json
COPY web ./web
USER node
EXPOSE 8787
CMD ["node", "server/dist/index.js"]
