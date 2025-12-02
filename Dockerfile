# Build stage
FROM --platform=$BUILDPLATFORM node:20-alpine AS builder

# Build arguments for cross-compilation
ARG TARGETPLATFORM
ARG BUILDPLATFORM
ARG TARGETOS
ARG TARGETARCH

WORKDIR /app

# Install build dependencies for native modules (better-sqlite3)
RUN apk add --no-cache python3 make g++

# Copy package files
COPY package*.json ./

# Install all dependencies (including dev)
RUN npm ci

# Copy source code
COPY tsconfig.json ./
COPY src/ ./src/

# Build TypeScript
RUN npm run build

# Production stage - use target platform
FROM node:20-alpine AS production

# Build arguments for cross-compilation
ARG TARGETPLATFORM
ARG BUILDPLATFORM
ARG TARGETOS
ARG TARGETARCH

WORKDIR /app

# Install runtime dependencies for native modules
# These are needed to compile better-sqlite3 for the target architecture
RUN apk add --no-cache python3 make g++

# Create non-root user for security
RUN addgroup -g 1001 -S appgroup && \
    adduser -u 1001 -S appuser -G appgroup

# Copy package files
COPY package*.json ./

# Install production dependencies only
# Force rebuild of native modules for target architecture
RUN npm ci --omit=dev && \
    npm rebuild better-sqlite3 && \
    npm cache clean --force

# Remove build tools after npm install to reduce image size
RUN apk del python3 make g++

# Copy built application from builder
COPY --from=builder /app/dist ./dist

# Copy configuration example
COPY config.example.yaml ./

# Create directories for data and credentials with proper ownership
RUN mkdir -p /app/data /app/credentials && \
    chown -R appuser:appgroup /app

# Switch to non-root user
USER appuser

# Environment defaults
ENV NODE_ENV=production
ENV LOG_LEVEL=info
ENV DATABASE_PATH=/app/data/sync.db
ENV POLL_INTERVAL_MINUTES=5

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD node -e "console.log('healthy')" || exit 1

# Data volume
VOLUME ["/app/data", "/app/credentials"]

# Run the application
CMD ["node", "dist/index.js"]
