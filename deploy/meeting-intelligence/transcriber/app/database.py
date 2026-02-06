"""
Database operations for the Transcription Service.
"""

import json
import uuid
from typing import Optional, List, Dict, Any

import asyncpg
import structlog

log = structlog.get_logger()


class Database:
    """Database operations for transcription service."""

    def __init__(self, connection_string: str):
        self.connection_string = connection_string
        self.pool: Optional[asyncpg.Pool] = None

    async def connect(self):
        """Establish database connection pool."""
        log.info("Connecting to database...")
        self.pool = await asyncpg.create_pool(
            self.connection_string,
            min_size=2,
            max_size=10
        )
        log.info("Database connected")

    async def disconnect(self):
        """Close database connection pool."""
        if self.pool:
            await self.pool.close()
            log.info("Database disconnected")

    async def health_check(self):
        """Check database connectivity."""
        async with self.pool.acquire() as conn:
            await conn.fetchval("SELECT 1")

    async def create_transcription_job(
        self,
        meeting_id: str,
        audio_path: Optional[str] = None,
        video_path: Optional[str] = None,
        enable_diarization: bool = True,
        language: Optional[str] = None,
        priority: int = 5
    ) -> int:
        """Create a new transcription job. Returns the auto-generated job ID."""
        result_data = {
            "audio_path": audio_path,
            "video_path": video_path,
            "enable_diarization": enable_diarization,
            "language": language
        }

        async with self.pool.acquire() as conn:
            job_id = await conn.fetchval("""
                INSERT INTO processing_jobs (
                    meeting_id, job_type, status, priority, result
                )
                VALUES ($1::uuid, 'transcribe', 'pending', $2, $3::jsonb)
                RETURNING id
            """, meeting_id, priority, json.dumps(result_data))

        log.info("Created transcription job", job_id=job_id, meeting_id=meeting_id)
        return job_id

    async def get_job(self, job_id: int) -> Optional[Dict[str, Any]]:
        """Get a job by ID."""
        async with self.pool.acquire() as conn:
            row = await conn.fetchrow("""
                SELECT id, meeting_id, job_type, status, priority,
                       attempts, started_at, completed_at,
                       error_message, result, created_at
                FROM processing_jobs
                WHERE id = $1
            """, job_id)

            if row:
                return dict(row)
            return None

    async def get_next_pending_job(self) -> Optional[Dict[str, Any]]:
        """Get the next pending job and mark it as processing."""
        async with self.pool.acquire() as conn:
            # Use FOR UPDATE SKIP LOCKED to prevent race conditions
            row = await conn.fetchrow("""
                UPDATE processing_jobs
                SET status = 'processing',
                    started_at = NOW(),
                    attempts = attempts + 1
                WHERE id = (
                    SELECT id FROM processing_jobs
                    WHERE status = 'pending'
                      AND job_type = 'transcribe'
                    ORDER BY priority ASC, created_at ASC
                    FOR UPDATE SKIP LOCKED
                    LIMIT 1
                )
                RETURNING id, meeting_id, job_type, result
            """)

            if row:
                result = dict(row)
                # Merge result JSON into the dict
                if result.get("result"):
                    if isinstance(result["result"], dict):
                        result.update(result["result"])
                    elif isinstance(result["result"], str):
                        result.update(json.loads(result["result"]))
                return result
            return None

    async def update_job_status(
        self,
        job_id: int,
        status: str,
        error_message: Optional[str] = None,
        result: Optional[dict] = None,
        progress: Optional[float] = None
    ):
        """Update job status."""
        result_json = None
        if result is not None:
            if progress is not None:
                result["progress"] = progress
            result_json = json.dumps(result)
        elif progress is not None:
            result_json = json.dumps({"progress": progress})

        async with self.pool.acquire() as conn:
            if status == "completed":
                await conn.execute("""
                    UPDATE processing_jobs
                    SET status = $1,
                        completed_at = NOW(),
                        error_message = $2,
                        result = COALESCE($3::jsonb, result)
                    WHERE id = $4
                """, status, error_message, result_json, job_id)
            else:
                await conn.execute("""
                    UPDATE processing_jobs
                    SET status = $1,
                        error_message = $2,
                        result = COALESCE($3::jsonb, result)
                    WHERE id = $4
                """, status, error_message, result_json, job_id)

    async def update_job_audio_path(self, job_id: int, audio_path: str):
        """Update the audio path for a job."""
        async with self.pool.acquire() as conn:
            await conn.execute("""
                UPDATE processing_jobs
                SET result = result || $1::jsonb
                WHERE id = $2
            """, json.dumps({"audio_path": audio_path}), job_id)

    async def update_meeting_status(self, meeting_id: str, status: str):
        """Update meeting processing status."""
        async with self.pool.acquire() as conn:
            await conn.execute("""
                UPDATE meetings
                SET status = $1,
                    updated_at = NOW()
                WHERE id = $2::uuid
            """, status, meeting_id)

    async def insert_transcript_segment(
        self,
        meeting_id: str,
        segment_index: int,
        start_time: float,
        end_time: float,
        text: str,
        speaker_id: Optional[str] = None,
        speaker_label: Optional[str] = None,
        confidence: Optional[float] = None,
        language: str = "en"
    ):
        """Insert a transcript segment."""
        async with self.pool.acquire() as conn:
            await conn.execute("""
                INSERT INTO transcripts (
                    meeting_id, segment_index, start_time, end_time,
                    text, speaker_id, speaker_label, confidence, language
                )
                VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9)
            """, meeting_id, segment_index, start_time, end_time,
               text, speaker_id, speaker_label, confidence, language)

    async def get_transcript(self, meeting_id: str) -> List[Dict[str, Any]]:
        """Get all transcript segments for a meeting."""
        async with self.pool.acquire() as conn:
            rows = await conn.fetch("""
                SELECT id, segment_index, start_time, end_time,
                       speaker_id, speaker_label, text, confidence, language
                FROM transcripts
                WHERE meeting_id = $1::uuid
                ORDER BY segment_index ASC
            """, meeting_id)

            return [dict(row) for row in rows]

    async def get_meeting(self, meeting_id: str) -> Optional[Dict[str, Any]]:
        """Get meeting details."""
        async with self.pool.acquire() as conn:
            row = await conn.fetchrow("""
                SELECT id, conference_id, conference_name, title,
                       started_at, ended_at, duration_seconds,
                       recording_path, audio_path, status,
                       metadata, created_at
                FROM meetings
                WHERE id = $1::uuid
            """, meeting_id)

            if row:
                return dict(row)
            return None

    async def create_meeting(
        self,
        conference_id: str,
        conference_name: Optional[str] = None,
        title: Optional[str] = None,
        recording_path: Optional[str] = None,
        metadata: Optional[dict] = None
    ) -> str:
        """Create a new meeting record."""
        meeting_id = str(uuid.uuid4())

        async with self.pool.acquire() as conn:
            await conn.execute("""
                INSERT INTO meetings (
                    id, conference_id, conference_name, title,
                    recording_path, status, metadata
                )
                VALUES ($1::uuid, $2, $3, $4, $5, 'recording', $6::jsonb)
            """, meeting_id, conference_id, conference_name, title,
               recording_path, json.dumps(metadata or {}))

        log.info("Created meeting", meeting_id=meeting_id, conference_id=conference_id)
        return meeting_id


class DatabaseError(Exception):
    """Database operation error."""
    pass
