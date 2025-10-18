# Build stage
FROM node:current-alpine3.22 AS builder

# Set working directory
WORKDIR /app

# Copy package files for installation
COPY package*.json ./
COPY .npmrc ./
COPY client/package*.json ./client/
COPY server/package*.json ./server/
COPY cli/package*.json ./cli/

# Install dependencies
RUN npm ci --ignore-scripts

# Copy source files
COPY . .

# Build the application
RUN npm run build

# Production stage
FROM node:24-slim

WORKDIR /app

# Copy package files for production
COPY package*.json ./
COPY .npmrc ./
COPY client/package*.json ./client/
COPY server/package*.json ./server/
COPY cli/package*.json ./cli/

# Install only production dependencies
RUN npm ci --omit=dev --ignore-scripts

# Copy built files from builder stage
COPY --from=builder /app/client/dist ./client/dist
COPY --from=builder /app/client/bin ./client/bin
COPY --from=builder /app/server/build ./server/build
COPY --from=builder /app/cli/build ./cli/build

# Set default port values as environment variables
ENV CLIENT_PORT=6274
ENV SERVER_PORT=6277

# Document which ports the application uses internally
EXPOSE ${CLIENT_PORT} ${SERVER_PORT}

# Use ENTRYPOINT with CMD for arguments
ENTRYPOINT ["npm", "start"]
