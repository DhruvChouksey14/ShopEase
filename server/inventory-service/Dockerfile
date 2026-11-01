FROM node:22.14.0-alpine3.21 AS deps
WORKDIR /app
COPY server/inventory-service/package*.json ./
COPY server/inventory-service/prisma ./prisma
RUN npm ci --omit=dev

FROM node:22.14.0-alpine3.21 AS runtime
ENV NODE_ENV=production
ENV NODE_PATH=/app/node_modules
WORKDIR /app
COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node server/inventory-service/ ./
COPY --chown=node:node shared/ /shared/
USER node
EXPOSE 3000
CMD ["npm", "start"]
