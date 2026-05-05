"""
Bot-substrate ingestion routes (rspace-online TASK-RMEETS-BOT-D).

Two endpoints called by the rspace bot-mi-bridge as a Recall.ai (or
self-hosted) bot streams data back via webhooks:

  POST /api/v1/ingest/transcript-chunk
  POST /api/v1/ingest/recording

Both are auth-gated by `X-MI-Internal-Key`; the rspace container holds
the same secret in `MI_INTERNAL_KEY`. The endpoints are idempotent —
they upsert a meeting row keyed by `metadata->>'job_id'`, and
transcript inserts dedupe on (meeting_id, segment_index = start_ms).

Why we key meetings by job_id (not conference_id): the existing schema
uses `conference_id` for the Jitsi room name. Bot-driven meetings have
no Jitsi room — they're a Zoom/Teams/Meet URL on the other side. We
synthesize `conference_id = "bot:<job_id>"` so the existing list/search
UIs still see them, and stash the actual meeting_url + space_id in
metadata.
"""

import json
import os
import secrets
import uuid
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

import structlog

log = structlog.get_logger()

router = APIRouter()


# ── Auth helper ──

def _require_internal_key(request: Request) -> None:
    expected = os.environ.get("MI_INTERNAL_KEY", "").strip()
    if not expected:
        raise HTTPException(503, "MI_INTERNAL_KEY not configured")
    got = request.headers.get("x-mi-internal-key", "").strip()
    if not got or not secrets.compare_digest(got, expected):
        raise HTTPException(401, "invalid X-MI-Internal-Key")


# ── Request models ──

class TranscriptChunkPayload(BaseModel):
    job_id: str
    text: str
    start_ms: int
    end_ms: int
    speaker: Optional[str] = None
    language: Optional[str] = None


class RecordingPayload(BaseModel):
    job_id: str
    url: str
    mime_type: str = "video/mp4"
    duration_ms: int = 0
    sha256: Optional[str] = None
    expires_at: Optional[str] = None


# ── Helpers ──

async def _ensure_meeting_for_job(db, job_id: str, space_id: Optional[str] = None) -> str:
    """
    Find or create the meeting row that owns this bot job. Returns the
    meeting UUID. Idempotent — concurrent first-sight calls reconcile to
    the same row via the partial unique index `uq_meetings_bot_conference_id`
    (set up in `run_idempotent_migrations`) on `WHERE conference_id LIKE 'bot:%'`.
    """
    conference_id = f"bot:{job_id}"
    async with db.pool.acquire() as conn:
        existing = await conn.fetchrow(
            "SELECT id FROM meetings WHERE conference_id = $1",
            conference_id,
        )
        if existing:
            return str(existing["id"])
        meeting_id = str(uuid.uuid4())
        access_token = secrets.token_urlsafe(32)
        meta = {"job_id": job_id, "source": "meeting-bot"}
        if space_id:
            meta["space_id"] = space_id
        try:
            await conn.execute(
                """
                INSERT INTO meetings (
                    id, conference_id, started_at, status, access_token, metadata
                ) VALUES ($1, $2, $3, 'recording', $4, $5::jsonb)
                ON CONFLICT (conference_id) WHERE conference_id LIKE 'bot:%'
                  DO NOTHING
                """,
                meeting_id, conference_id, datetime.utcnow(), access_token,
                json.dumps(meta),
            )
        except Exception:
            # Race lost or partial index missing — re-query for the winner's row.
            pass
        row = await conn.fetchrow(
            "SELECT id FROM meetings WHERE conference_id = $1",
            conference_id,
        )
        if not row:
            raise HTTPException(500, "could not upsert bot meeting row")
        return str(row["id"])


# ── Endpoints ──

@router.post("/transcript-chunk")
async def ingest_transcript_chunk(payload: TranscriptChunkPayload, request: Request):
    """
    Accept one final transcript segment from the bot. Upserts the
    meeting row on first sight, then inserts a transcript row. Dedupe
    is by (meeting_id, segment_index) where segment_index = start_ms.
    """
    _require_internal_key(request)
    db = request.app.state.db
    meeting_uuid = await _ensure_meeting_for_job(db, payload.job_id)

    start_seconds = payload.start_ms / 1000.0
    end_seconds = payload.end_ms / 1000.0

    # Bot rows dedupe via external_segment_id = "<job_id>:<start_ms>".
    # Partial unique index uq_transcripts_external_segment_id enforces
    # uniqueness only for non-NULL values, so legacy Jitsi rows stay
    # untouched.
    external_segment_id = f"{payload.job_id}:{payload.start_ms}"
    async with db.pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO transcripts (
                meeting_id, segment_index, start_time, end_time,
                speaker_name, speaker_label, text, external_segment_id
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            ON CONFLICT (external_segment_id) WHERE external_segment_id IS NOT NULL
              DO UPDATE SET
                start_time = EXCLUDED.start_time,
                end_time = EXCLUDED.end_time,
                speaker_name = EXCLUDED.speaker_name,
                text = EXCLUDED.text
            """,
            meeting_uuid, payload.start_ms, start_seconds, end_seconds,
            payload.speaker, payload.speaker, payload.text, external_segment_id,
        )

    return {"ok": True, "meeting_id": meeting_uuid}


@router.post("/recording")
async def ingest_recording(payload: RecordingPayload, request: Request):
    """
    Accept a final recording artifact. Stores the provider-hosted URL
    on the meeting row + transitions status to 'ready'. Downstream
    workers (transcription/diarization/summarization) should already
    have run on the streamed transcript chunks; this endpoint mainly
    provides the recording asset for playback.
    """
    _require_internal_key(request)
    db = request.app.state.db
    meeting_uuid = await _ensure_meeting_for_job(db, payload.job_id)

    duration_seconds = (payload.duration_ms or 0) // 1000
    metadata_patch = {"recording_url": payload.url, "recording_mime": payload.mime_type}
    if payload.sha256:
        metadata_patch["recording_sha256"] = payload.sha256
    if payload.expires_at:
        metadata_patch["recording_expires_at"] = payload.expires_at

    async with db.pool.acquire() as conn:
        await conn.execute(
            """
            UPDATE meetings
               SET recording_path = $1,
                   duration_seconds = COALESCE(NULLIF($2, 0), duration_seconds),
                   ended_at = COALESCE(ended_at, NOW()),
                   status = 'ready',
                   metadata = metadata || $3::jsonb,
                   updated_at = NOW()
             WHERE id = $4
            """,
            payload.url, duration_seconds, json.dumps(metadata_patch), meeting_uuid,
        )

    return {"ok": True, "meeting_id": meeting_uuid}
