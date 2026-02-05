#!/bin/bash
# Jibri Recording Finalize Script
# Called when Jibri finishes recording a meeting
#
# Arguments:
# $1 - Recording directory path (e.g., /recordings/<conference_id>/<timestamp>)
#
# This script:
# 1. Finds the recording file
# 2. Notifies the Meeting Intelligence API to start processing

set -e

RECORDING_DIR="$1"
API_URL="${MEETING_INTELLIGENCE_API:-http://api:8000}"
LOG_FILE="/var/log/jibri/finalize.log"

log() {
    echo "[$(date -Iseconds)] $1" >> "$LOG_FILE"
    echo "[$(date -Iseconds)] $1"
}

log "=== Finalize script started ==="
log "Recording directory: $RECORDING_DIR"

# Validate recording directory
if [ -z "$RECORDING_DIR" ] || [ ! -d "$RECORDING_DIR" ]; then
    log "ERROR: Invalid recording directory: $RECORDING_DIR"
    exit 1
fi

# Find the recording file (MP4 or WebM)
RECORDING_FILE=$(find "$RECORDING_DIR" -type f \( -name "*.mp4" -o -name "*.webm" \) | head -1)

if [ -z "$RECORDING_FILE" ]; then
    log "ERROR: No recording file found in $RECORDING_DIR"
    exit 1
fi

log "Found recording file: $RECORDING_FILE"

# Get file info
FILE_SIZE=$(stat -c%s "$RECORDING_FILE" 2>/dev/null || echo "0")
log "Recording file size: $FILE_SIZE bytes"

# Extract conference info from path
# Expected format: /recordings/<conference_id>/<timestamp>/recording.mp4
CONFERENCE_ID=$(echo "$RECORDING_DIR" | awk -F'/' '{print $(NF-1)}')
if [ -z "$CONFERENCE_ID" ]; then
    CONFERENCE_ID=$(basename "$(dirname "$RECORDING_DIR")")
fi

# Look for metadata file (Jibri sometimes creates this)
METADATA_FILE="$RECORDING_DIR/metadata.json"
if [ -f "$METADATA_FILE" ]; then
    log "Found metadata file: $METADATA_FILE"
    METADATA=$(cat "$METADATA_FILE")
else
    METADATA="{}"
fi

# Prepare webhook payload
PAYLOAD=$(cat <<EOF
{
    "event_type": "recording_completed",
    "conference_id": "$CONFERENCE_ID",
    "recording_path": "$RECORDING_FILE",
    "recording_dir": "$RECORDING_DIR",
    "file_size_bytes": $FILE_SIZE,
    "completed_at": "$(date -Iseconds)",
    "metadata": $METADATA
}
EOF
)

log "Sending webhook to $API_URL/webhooks/recording-complete"
log "Payload: $PAYLOAD"

# Send webhook to Meeting Intelligence API
RESPONSE=$(curl -s -w "\n%{http_code}" \
    -X POST \
    -H "Content-Type: application/json" \
    -d "$PAYLOAD" \
    "$API_URL/webhooks/recording-complete" 2>&1)

HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | head -n -1)

if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "201" ] || [ "$HTTP_CODE" = "202" ]; then
    log "SUCCESS: Webhook accepted (HTTP $HTTP_CODE)"
    log "Response: $BODY"
else
    log "WARNING: Webhook returned HTTP $HTTP_CODE"
    log "Response: $BODY"

    # Don't fail the script - the recording is still saved
    # The API can be retried later
fi

# Optional: Clean up old recordings (keep last 30 days)
# find /recordings -type f -mtime +30 -delete

log "=== Finalize script completed ==="
exit 0
