"""
Meeting Intelligence Transcription Service

FastAPI service that handles:
- Audio extraction from video recordings
- Transcription using whisper.cpp
- Speaker diarization using resemblyzer
- Job queue management via Redis
"""

import asyncio
import os
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import FastAPI, BackgroundTasks, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from redis import Redis
from rq import Queue

from .config import settings
from .transcriber import WhisperTranscriber
from .diarizer import SpeakerDiarizer
from .processor import JobProcessor
from .database import Database

import structlog

log = structlog.get_logger()


# Pydantic models
class TranscribeRequest(BaseModel):
    meeting_id: str
    audio_path: str
    priority: int = 5
    enable_diarization: bool = True
    language: Optional[str] = None


class TranscribeResponse(BaseModel):
    job_id: str
    status: str
    message: str


class JobStatus(BaseModel):
    job_id: str
    status: str
    progress: Optional[float] = None
    result: Optional[dict] = None
    error: Optional[str] = None


# Application state
class AppState:
    redis: Optional[Redis] = None
    queue: Optional[Queue] = None
    db: Optional[Database] = None
    transcriber: Optional[WhisperTranscriber] = None
    diarizer: Optional[SpeakerDiarizer] = None
    processor: Optional[JobProcessor] = None


state = AppState()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application startup and shutdown."""
    log.info("Starting transcription service...")

    # Initialize Redis connection
    state.redis = Redis.from_url(settings.redis_url)
    state.queue = Queue("transcription", connection=state.redis)

    # Initialize database
    state.db = Database(settings.postgres_url)
    await state.db.connect()

    # Initialize transcriber
    state.transcriber = WhisperTranscriber(
        model_path=settings.whisper_model,
        threads=settings.whisper_threads
    )

    # Initialize diarizer
    state.diarizer = SpeakerDiarizer()

    # Initialize job processor
    state.processor = JobProcessor(
        transcriber=state.transcriber,
        diarizer=state.diarizer,
        db=state.db,
        redis=state.redis
    )

    # Start background worker
    asyncio.create_task(state.processor.process_jobs())

    log.info("Transcription service started successfully")

    yield

    # Shutdown
    log.info("Shutting down transcription service...")
    if state.processor:
        await state.processor.stop()
    if state.db:
        await state.db.disconnect()
    if state.redis:
        state.redis.close()

    log.info("Transcription service stopped")


app = FastAPI(
    title="Meeting Intelligence Transcription Service",
    description="Transcription and speaker diarization for meeting recordings",
    version="1.0.0",
    lifespan=lifespan
)


@app.get("/health")
async def health_check():
    """Health check endpoint."""
    redis_ok = False
    db_ok = False

    try:
        if state.redis:
            state.redis.ping()
            redis_ok = True
    except Exception as e:
        log.error("Redis health check failed", error=str(e))

    try:
        if state.db:
            await state.db.health_check()
            db_ok = True
    except Exception as e:
        log.error("Database health check failed", error=str(e))

    status = "healthy" if (redis_ok and db_ok) else "unhealthy"

    return {
        "status": status,
        "redis": redis_ok,
        "database": db_ok,
        "whisper_model": settings.whisper_model,
        "threads": settings.whisper_threads
    }


@app.get("/status")
async def service_status():
    """Get service status and queue info."""
    queue_length = state.queue.count if state.queue else 0
    processing = state.processor.active_jobs if state.processor else 0

    return {
        "status": "running",
        "queue_length": queue_length,
        "active_jobs": processing,
        "workers": settings.num_workers,
        "model": os.path.basename(settings.whisper_model)
    }


@app.post("/transcribe", response_model=TranscribeResponse)
async def queue_transcription(request: TranscribeRequest, background_tasks: BackgroundTasks):
    """Queue a transcription job."""
    log.info(
        "Received transcription request",
        meeting_id=request.meeting_id,
        audio_path=request.audio_path
    )

    # Validate audio file exists
    if not os.path.exists(request.audio_path):
        raise HTTPException(
            status_code=404,
            detail=f"Audio file not found: {request.audio_path}"
        )

    # Create job record in database
    try:
        job_id = await state.db.create_transcription_job(
            meeting_id=request.meeting_id,
            audio_path=request.audio_path,
            enable_diarization=request.enable_diarization,
            language=request.language,
            priority=request.priority
        )
    except Exception as e:
        log.error("Failed to create job", error=str(e))
        raise HTTPException(status_code=500, detail=str(e))

    # Queue the job
    state.queue.enqueue(
        "app.worker.process_transcription",
        job_id,
        job_timeout="2h",
        result_ttl=86400  # 24 hours
    )

    log.info("Job queued", job_id=job_id)

    return TranscribeResponse(
        job_id=job_id,
        status="queued",
        message="Transcription job queued successfully"
    )


@app.get("/transcribe/{job_id}", response_model=JobStatus)
async def get_job_status(job_id: str):
    """Get the status of a transcription job."""
    job = await state.db.get_job(job_id)

    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    return JobStatus(
        job_id=job_id,
        status=job["status"],
        progress=job.get("progress"),
        result=job.get("result"),
        error=job.get("error_message")
    )


@app.delete("/transcribe/{job_id}")
async def cancel_job(job_id: str):
    """Cancel a pending transcription job."""
    job = await state.db.get_job(job_id)

    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    if job["status"] not in ["pending", "queued"]:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot cancel job in status: {job['status']}"
        )

    await state.db.update_job_status(job_id, "cancelled")

    return {"status": "cancelled", "job_id": job_id}


@app.get("/meetings/{meeting_id}/transcript")
async def get_transcript(meeting_id: str):
    """Get the transcript for a meeting."""
    transcript = await state.db.get_transcript(meeting_id)

    if not transcript:
        raise HTTPException(
            status_code=404,
            detail=f"No transcript found for meeting: {meeting_id}"
        )

    return {
        "meeting_id": meeting_id,
        "segments": transcript,
        "segment_count": len(transcript)
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001)
