#!/bin/bash
# Jibri Recording Finalize Script
set -e

RECORDING_DIR="$1"
API_URL="${MEETING_INTELLIGENCE_API:-http://api:8000}"
LOG_FILE="/config/logs/finalize.log"

mkdir -p /config/logs

log() {
    echo "[$(date -Iseconds)] $1" >> "$LOG_FILE"
    echo "[$(date -Iseconds)] $1"
}

log "=== Finalize script started ==="
log "Recording directory: $RECORDING_DIR"

if [ -z "$RECORDING_DIR" ] || [ ! -d "$RECORDING_DIR" ]; then
    log "ERROR: Invalid recording directory: $RECORDING_DIR"
    exit 1
fi

RECORDING_FILE=$(find "$RECORDING_DIR" -type f \( -name "*.mp4" -o -name "*.webm" \) | head -1)

if [ -z "$RECORDING_FILE" ]; then
    log "ERROR: No recording file found in $RECORDING_DIR"
    exit 1
fi

log "Found recording file: $RECORDING_FILE"

FILE_SIZE=$(stat -c%s "$RECORDING_FILE" 2>/dev/null || echo "0")
log "Recording file size: $FILE_SIZE bytes"

CONFERENCE_ID=$(basename "$RECORDING_DIR")

METADATA_FILE="$RECORDING_DIR/metadata.json"
if [ -f "$METADATA_FILE" ]; then
    METADATA=$(cat "$METADATA_FILE")
else
    METADATA="{}"
fi

PAYLOAD="{\"event_type\":\"recording_completed\",\"conference_id\":\"$CONFERENCE_ID\",\"recording_path\":\"$RECORDING_FILE\",\"file_size_bytes\":$FILE_SIZE,\"metadata\":$METADATA}"

log "Sending webhook to $API_URL/webhooks/recording-complete"

RESPONSE=$(curl -s -w "\n%{http_code}" -X POST -H "Content-Type: application/json" -d "$PAYLOAD" "$API_URL/webhooks/recording-complete" 2>&1)
HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | head -n -1)

log "Response: HTTP $HTTP_CODE - $BODY"
log "=== Finalize script completed ==="
exit 0
