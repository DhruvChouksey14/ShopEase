FROM node:22.14.0-alpine3.21 AS deps
WORKDIR /app
COPY server/worker-service/package*.json ./
RUN npm install --omit=dev --package-lock=false

FROM node:22.14.0-alpine3.21 AS runtime
ENV NODE_ENV=production
ENV NODE_PATH=/app/node_modules
WORKDIR /app
COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node server/worker-service/ ./
COPY --chown=node:node shared/ /shared/
USER node
EXPOSE 3000
CMD ["npm", "start"]
