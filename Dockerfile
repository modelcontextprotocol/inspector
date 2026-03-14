# Build stage
FROM node:current-alpine3.22 AS builder

# Set working directory
WORKDIR /app

# Copy package files for installation
COPY package*.json ./
COPY .npmrc ./
COPY clients/web/package*.json ./clients/web/
COPY core/package*.json ./core/
COPY clients/cli/package*.json ./clients/cli/
COPY clients/tui/package*.json ./clients/tui/
COPY clients/launcher/package*.json ./clients/launcher/

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
COPY clients/web/package*.json ./clients/web/
COPY core/package*.json ./core/
COPY clients/cli/package*.json ./clients/cli/
COPY clients/tui/package*.json ./clients/tui/
COPY clients/launcher/package*.json ./clients/launcher/

# Install only production dependencies
RUN npm ci --omit=dev --ignore-scripts

# Copy built files from builder stage
COPY --from=builder /app/clients/web/dist ./clients/web/dist
COPY --from=builder /app/clients/web/build ./clients/web/build
COPY --from=builder /app/clients/cli/build ./clients/cli/build
COPY --from=builder /app/clients/launcher/build ./clients/launcher/build

# Set default port
ENV PORT=6274
EXPOSE ${PORT}

# Run web app
CMD ["node", "clients/launcher/build/index.js", "--web"]
