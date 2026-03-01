# Build stage
FROM node:current-alpine3.22 AS builder

# Set working directory
WORKDIR /app

# Copy package files for installation
COPY package*.json ./
COPY .npmrc ./
COPY web/package*.json ./web/
COPY core/package*.json ./core/
COPY cli/package*.json ./cli/
COPY tui/package*.json ./tui/

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
COPY web/package*.json ./web/
COPY core/package*.json ./core/
COPY cli/package*.json ./cli/
COPY tui/package*.json ./tui/

# Install only production dependencies
RUN npm ci --omit=dev --ignore-scripts

# Copy built files from builder stage
COPY --from=builder /app/web/dist ./web/dist
COPY --from=builder /app/web/bin ./web/bin
COPY --from=builder /app/cli/build ./cli/build

# Set default port
ENV PORT=6274
EXPOSE ${PORT}

# Run web app
CMD ["node", "web/bin/start.js"]
