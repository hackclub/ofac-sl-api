# Build stage
FROM node:22-alpine AS builder

WORKDIR /app

# Install build dependencies for better-sqlite3
RUN apk add --no-cache python3 make g++

# Copy package files
COPY package*.json ./

# Install all dependencies (including dev)
RUN npm ci

# Copy source code
COPY tsconfig.json ./
COPY src ./src

# Build TypeScript
RUN npm run build

# Production stage
FROM node:22-alpine

WORKDIR /app

# Install runtime dependencies for better-sqlite3 and curl for healthchecks
RUN apk add --no-cache python3 make g++ curl

# Copy package files
COPY package*.json ./

# Install production dependencies only and clean up build tools
RUN npm ci --omit=dev && \
    apk del python3 make g++ && \
    rm -rf /root/.npm /tmp/*

# Copy built files from builder
COPY --from=builder /app/dist ./dist

# Create tmp directory for cache
RUN mkdir -p /app/tmp

# Set environment
ENV NODE_ENV=production

EXPOSE 3000

CMD ["node", "dist/server.js"]
