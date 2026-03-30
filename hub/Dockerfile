FROM node:18-alpine

WORKDIR /app

# Install build dependencies for better-sqlite3
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    && rm -rf /var/cache/apk/*

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy source (pre-built)
COPY dist ./dist

# Create data directory
RUN mkdir -p /data && chown -R node:node /data

# Expose ports
EXPOSE 8080 8081

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:8081/health || exit 1

# Run as non-root user
USER node

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=8080
ENV REST_PORT=8081
ENV DATA_DIR=/data
ENV AUTH_TOKEN=change-me-in-production

CMD ["node", "dist/index.js"]
