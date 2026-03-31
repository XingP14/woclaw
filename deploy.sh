#!/bin/bash
# WoClaw Deployment Script for vm153
# Usage: ./deploy.sh <ssh-host>

set -e

SSH_HOST="${1:-root@vm153}"
AUTH_TOKEN="${AUTH_TOKEN:-change-me-in-production}"
REPO_DIR="/opt/woclaw"
CONTAINER_NAME="woclaw-hub"

echo "=========================================="
echo "  WoClaw Deployment to $SSH_HOST"
echo "=========================================="

# Check if running locally (not SSH)
if [[ "$SSH_HOST" == "local" ]] || [[ "$SSH_HOST" == "localhost" ]]; then
    echo "[INFO] Local deployment mode"
    TARGET=""
else
    echo "[INFO] Remote deployment via SSH"
    TARGET="ssh $SSH_HOST"
fi

$TARGET "mkdir -p $REPO_DIR"

# Copy files (assuming this script is run from the repo root)
echo "[1/5] Copying files to $SSH_HOST..."
if [[ "$SSH_HOST" == "local" ]] || [[ "$SSH_HOST" == "localhost" ]]; then
    rsync -avz --exclude='node_modules' --exclude='.git' --exclude='dist' \
        ./ $SSH_HOST:$REPO_DIR/
else
    rsync -avz -e "ssh" --exclude='node_modules' --exclude='.git' --exclude='dist' \
        ./ $SSH_HOST:$REPO_DIR/
fi

# Build on remote
echo "[2/5] Building Docker image on $SSH_HOST..."
$TARGET "cd $REPO_DIR && docker build -t woclaw/hub:latest ./hub"

# Stop existing container
echo "[3/5] Stopping existing container..."
$TARGET "docker stop $CONTAINER_NAME 2>/dev/null || true"
$TARGET "docker rm $CONTAINER_NAME 2>/dev/null || true"

# Run new container
echo "[4/5] Starting new container..."
$TARGET "cd $REPO_DIR && docker run -d \
    --name $CONTAINER_NAME \
    -p 8080:8080 \
    -p 8081:8081 \
    -v ${REPO_DIR}/data:/data \
    -e AUTH_TOKEN=$AUTH_TOKEN \
    -e HOST=0.0.0.0 \
    -e PORT=8080 \
    -e REST_PORT=8081 \
    -e DATA_DIR=/data \
    --restart unless-stopped \
    woclaw/hub:latest"

# Wait for container to start
echo "[5/5] Waiting for container to start..."
sleep 5

# Check status
echo ""
echo "=========================================="
echo "  Deployment Complete!"
echo "=========================================="
echo ""
$TARGET "docker ps --filter name=$CONTAINER_NAME"
echo ""
echo "Hub endpoints:"
echo "  WebSocket: ws://$SSH_HOST:8080"
echo "  REST API:  http://$SSH_HOST:8081"
echo ""
echo "Test with:"
echo "  HUB_URL=ws://$SSH_HOST:8080 AUTH_TOKEN=$AUTH_TOKEN node test.ts"
