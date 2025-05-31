# Builder stage
FROM node:22-slim AS builder

WORKDIR /app

COPY package*.json ./
COPY .npmrc ./
COPY client/package*.json ./client/
COPY server/package*.json ./server/
COPY cli/package*.json ./cli/

RUN npm ci --ignore-scripts

COPY . .

RUN npm run build

# Runner stage
FROM node:22-slim AS runner

WORKDIR /app

COPY package*.json ./
COPY .npmrc ./
COPY client/package*.json ./client/
COPY server/package*.json ./server/
COPY cli/package*.json ./cli/

RUN npm ci --omit=dev --ignore-scripts

COPY --from=builder /app/client/dist ./client/dist
COPY --from=builder /app/client/bin ./client/bin
COPY --from=builder /app/server/build ./server/build
COPY --from=builder /app/cli/build ./cli/build

EXPOSE 6274 6277

CMD ["npm", "start"]
