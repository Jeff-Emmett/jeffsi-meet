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
from typing import Optional, Union

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
    audio_path: Optional[str] = None
    video_path: Optional[str] = None  # If provided, will extract audio first
    priority: int = 5
    enable_diarization: bool = True
    language: Optional[str] = None


class TranscribeResponse(BaseModel):
    job_id: int  # Integer from database auto-increment
    status: str
    message: str


class JobStatus(BaseModel):
    job_id: int
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
    audio_path = request.audio_path
    
    # If video_path provided, extract audio first
    if request.video_path and not audio_path:
        log.info(
            "Extracting audio from video",
            meeting_id=request.meeting_id,
            video_path=request.video_path
        )
        
        if not os.path.exists(request.video_path):
            raise HTTPException(
                status_code=404,
                detail=f"Video file not found: {request.video_path}"
            )
        
        # Extract audio using ffmpeg
        import subprocess
        audio_dir = os.environ.get("AUDIO_OUTPUT_DIR", "/audio")
        os.makedirs(audio_dir, exist_ok=True)
        audio_path = os.path.join(audio_dir, f"{request.meeting_id}.wav")
        
        try:
            result = subprocess.run([
                "ffmpeg", "-y", "-i", request.video_path,
                "-vn", "-acodec", "pcm_s16le", "-ar", "16000", "-ac", "1",
                audio_path
            ], capture_output=True, text=True, timeout=300)
            
            if result.returncode != 0:
                log.error("FFmpeg error", stderr=result.stderr)
                raise HTTPException(status_code=500, detail=f"Audio extraction failed: {result.stderr}")
                
            log.info("Audio extracted", audio_path=audio_path)
        except subprocess.TimeoutExpired:
            raise HTTPException(status_code=500, detail="Audio extraction timed out")
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Audio extraction failed: {str(e)}")
    
    log.info(
        "Received transcription request",
        meeting_id=request.meeting_id,
        audio_path=audio_path
    )

    # Validate audio file exists
    if not audio_path or not os.path.exists(audio_path):
        raise HTTPException(
            status_code=404,
            detail=f"Audio file not found: {audio_path}"
        )

    # Create job record in database - use the extracted audio_path
    try:
        job_id = await state.db.create_transcription_job(
            meeting_id=request.meeting_id,
            audio_path=audio_path,  # Use extracted audio_path, not request.audio_path
            video_path=request.video_path,
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
async def get_job_status(job_id: int):
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
async def cancel_job(job_id: int):
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
