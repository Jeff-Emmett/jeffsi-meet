#!/bin/bash
# Deploy Jeffsi Meet to Netcup server
set -e

IMAGE_NAME="jeffsi-meet-web"
IMAGE_TAG="latest"
REMOTE_HOST="netcup"
REMOTE_DIR="/opt/jeffsi-meet"

echo "=== Building Jeffsi Meet ==="

# Build the web client
echo "Building web client..."
make all

# Build Docker image
echo "Building Docker image..."
docker build -t ${IMAGE_NAME}:${IMAGE_TAG} .

# Save image to tar
echo "Saving Docker image..."
docker save ${IMAGE_NAME}:${IMAGE_TAG} | gzip > /tmp/jeffsi-meet-web.tar.gz

# Copy to server
echo "Copying image to server..."
scp /tmp/jeffsi-meet-web.tar.gz ${REMOTE_HOST}:/tmp/

# Load image on server and restart
echo "Loading image on server and restarting..."
ssh ${REMOTE_HOST} << 'EOF'
    cd /opt/jeffsi-meet

    # Load the new image
    docker load < /tmp/jeffsi-meet-web.tar.gz

    # Restart the web container with the new image
    docker compose -f docker-compose.jeffsi.yml up -d --force-recreate web

    # Clean up
    rm /tmp/jeffsi-meet-web.tar.gz

    echo "Deployment complete!"
    docker ps | grep jeffsi
EOF

# Clean up local tar
rm /tmp/jeffsi-meet-web.tar.gz

echo "=== Deployment finished ==="
