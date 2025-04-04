FROM node:22-slim

# Set working directory
WORKDIR /app

# Copy files
COPY . .

# Install dependencies
# Working around https://github.com/npm/cli/issues/4828
# RUN npm ci
RUN npm install --no-package-lock

# Build the application
RUN npm run build

ENV CLIENT_PORT=6274
ENV SERVER_PORT=6277

# Expose the CLIENT_PORT and SERVER_PORT
EXPOSE $CLIENT_PORT
EXPOSE $SERVER_PORT

# Use ENTRYPOINT with CMD for arguments
ENTRYPOINT ["npm", "start"]
CMD []