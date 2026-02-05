"""
Webhook routes for Jibri recording callbacks.
"""

from datetime import datetime
from typing import Optional

import httpx
from fastapi import APIRouter, HTTPException, Request, BackgroundTasks
from pydantic import BaseModel

from ..config import settings

import structlog

log = structlog.get_logger()

router = APIRouter()


class RecordingCompletePayload(BaseModel):
    event_type: str
    conference_id: str
    recording_path: str
    recording_dir: Optional[str] = None
    file_size_bytes: Optional[int] = None
    completed_at: Optional[str] = None
    metadata: Optional[dict] = None


class WebhookResponse(BaseModel):
    status: str
    meeting_id: str
    message: str


@router.post("/recording-complete", response_model=WebhookResponse)
async def recording_complete(
    request: Request,
    payload: RecordingCompletePayload,
    background_tasks: BackgroundTasks
):
    """
    Webhook called by Jibri when a recording completes.

    This triggers the processing pipeline:
    1. Create meeting record
    2. Queue transcription job
    3. (Later) Generate summary
    """
    db = request.app.state.db

    log.info(
        "Recording complete webhook received",
        conference_id=payload.conference_id,
        recording_path=payload.recording_path
    )

    # Save webhook event for audit
    await db.save_webhook_event(
        event_type=payload.event_type,
        payload=payload.model_dump()
    )

    # Create meeting record
    meeting_id = await db.create_meeting(
        conference_id=payload.conference_id,
        conference_name=payload.conference_id,  # Use conference_id as name for now
        title=f"Meeting - {payload.conference_id}",
        recording_path=payload.recording_path,
        started_at=datetime.utcnow(),  # Will be updated from recording metadata
        metadata=payload.metadata or {}
    )

    log.info("Meeting record created", meeting_id=meeting_id)

    # Update meeting status
    await db.update_meeting(meeting_id, status="extracting_audio")

    # Queue transcription job
    job_id = await db.create_job(
        meeting_id=meeting_id,
        job_type="transcribe",
        priority=5,
        result={
            "video_path": payload.recording_path,
            "enable_diarization": True
        }
    )

    log.info("Transcription job queued", job_id=job_id, meeting_id=meeting_id)

    # Trigger transcription service asynchronously
    background_tasks.add_task(
        _notify_transcriber,
        meeting_id,
        payload.recording_path
    )

    return WebhookResponse(
        status="accepted",
        meeting_id=meeting_id,
        message="Recording queued for processing"
    )


async def _notify_transcriber(meeting_id: str, recording_path: str):
    """Notify the transcription service to start processing."""
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                f"{settings.transcriber_url}/transcribe",
                json={
                    "meeting_id": meeting_id,
                    "video_path": recording_path,
                    "enable_diarization": True
                }
            )
            response.raise_for_status()
            log.info(
                "Transcriber notified",
                meeting_id=meeting_id,
                response=response.json()
            )
    except Exception as e:
        log.error(
            "Failed to notify transcriber",
            meeting_id=meeting_id,
            error=str(e)
        )
        # Job is in database, transcriber will pick it up on next poll


@router.post("/test")
async def test_webhook(request: Request):
    """Test endpoint for webhook connectivity."""
    body = await request.json()
    log.info("Test webhook received", body=body)
    return {"status": "ok", "received": body}
