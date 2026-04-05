FROM node:20-bookworm-slim

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install build prerequisites for native modules, then production dependencies
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
RUN npm ci --omit=dev

# Copy source (pre-built)
COPY dist ./dist

# Create data directory
RUN mkdir -p /data && chown -R node:node /data

# Expose ports
EXPOSE 8082 8083

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8083/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

# Run as non-root user
USER node

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=8082
ENV REST_PORT=8083
ENV DATA_DIR=/data
ENV AUTH_TOKEN=change-me-in-production

CMD ["node", "dist/index.js"]
