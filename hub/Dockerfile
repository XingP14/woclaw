FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies (production only, no native deps needed)
RUN npm ci --only=production

# Copy source (pre-built)
COPY dist ./dist

# Create data directory
RUN mkdir -p /data && chown -R node:node /data

# Expose ports
EXPOSE 8082 8083

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:8083/health || exit 1

# Run as non-root user
USER node

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=8082
ENV REST_PORT=8083
ENV DATA_DIR=/data
ENV AUTH_TOKEN=change-me-in-production

CMD ["node", "dist/index.js"]
