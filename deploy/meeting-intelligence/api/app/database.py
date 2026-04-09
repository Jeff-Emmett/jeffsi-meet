"""
Database operations for the Meeting Intelligence API.
"""

import json
import secrets
import uuid
from datetime import datetime
from typing import Optional, List, Dict, Any

import asyncpg
import structlog

log = structlog.get_logger()


class Database:
    """Database operations for Meeting Intelligence API."""

    def __init__(self, connection_string: str):
        self.connection_string = connection_string
        self.pool: Optional[asyncpg.Pool] = None

    async def connect(self):
        """Establish database connection pool."""
        log.info("Connecting to database...")
        self.pool = await asyncpg.create_pool(
            self.connection_string,
            min_size=2,
            max_size=20
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

    # ==================== Meetings ====================

    async def list_meetings(
        self,
        limit: int = 50,
        offset: int = 0,
        status: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """List meetings with pagination."""
        async with self.pool.acquire() as conn:
            if status:
                rows = await conn.fetch("""
                    SELECT id, conference_id, conference_name, title,
                           started_at, ended_at, duration_seconds,
                           status, created_at
                    FROM meetings
                    WHERE status = $1
                    ORDER BY created_at DESC
                    LIMIT $2 OFFSET $3
                """, status, limit, offset)
            else:
                rows = await conn.fetch("""
                    SELECT id, conference_id, conference_name, title,
                           started_at, ended_at, duration_seconds,
                           status, created_at
                    FROM meetings
                    ORDER BY created_at DESC
                    LIMIT $1 OFFSET $2
                """, limit, offset)

            return [dict(row) for row in rows]

    async def get_meeting(self, meeting_id: str) -> Optional[Dict[str, Any]]:
        """Get meeting details."""
        async with self.pool.acquire() as conn:
            row = await conn.fetchrow("""
                SELECT m.id, m.conference_id, m.conference_name, m.title,
                       m.started_at, m.ended_at, m.duration_seconds,
                       m.recording_path, m.audio_path, m.status,
                       m.metadata, m.created_at,
                       (SELECT COUNT(*) FROM transcripts WHERE meeting_id = m.id) as segment_count,
                       (SELECT COUNT(*) FROM meeting_participants WHERE meeting_id = m.id) as participant_count,
                       (SELECT id FROM summaries WHERE meeting_id = m.id LIMIT 1) as summary_id
                FROM meetings m
                WHERE m.id = $1::uuid
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
        started_at: Optional[datetime] = None,
        metadata: Optional[dict] = None
    ) -> str:
        """Create a new meeting record."""
        meeting_id = str(uuid.uuid4())
        access_token = secrets.token_urlsafe(32)

        async with self.pool.acquire() as conn:
            await conn.execute("""
                INSERT INTO meetings (
                    id, conference_id, conference_name, title,
                    recording_path, started_at, status, access_token, metadata
                )
                VALUES ($1, $2, $3, $4, $5, $6, 'recording', $7, $8::jsonb)
            """, meeting_id, conference_id, conference_name, title,
               recording_path, started_at or datetime.utcnow(),
               access_token, json.dumps(metadata or {}))

        return meeting_id

    async def update_meeting(
        self,
        meeting_id: str,
        **kwargs
    ):
        """Update meeting fields."""
        if not kwargs:
            return

        set_clauses = []
        values = []
        i = 1

        for key, value in kwargs.items():
            if key in ['status', 'title', 'ended_at', 'duration_seconds',
                       'recording_path', 'audio_path', 'error_message']:
                set_clauses.append(f"{key} = ${i}")
                values.append(value)
                i += 1

        if not set_clauses:
            return

        values.append(meeting_id)

        async with self.pool.acquire() as conn:
            await conn.execute(f"""
                UPDATE meetings
                SET {', '.join(set_clauses)}, updated_at = NOW()
                WHERE id = ${i}::uuid
            """, *values)

    async def list_meetings_by_tokens(
        self,
        tokens: List[str],
        limit: int = 50,
        offset: int = 0,
        status: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """List meetings filtered by access tokens."""
        if not tokens:
            return []

        async with self.pool.acquire() as conn:
            if status:
                rows = await conn.fetch("""
                    SELECT id, conference_id, conference_name, title,
                           started_at, ended_at, duration_seconds,
                           status, created_at
                    FROM meetings
                    WHERE access_token = ANY($1) AND status = $2
                    ORDER BY created_at DESC
                    LIMIT $3 OFFSET $4
                """, tokens, status, limit, offset)
            else:
                rows = await conn.fetch("""
                    SELECT id, conference_id, conference_name, title,
                           started_at, ended_at, duration_seconds,
                           status, created_at
                    FROM meetings
                    WHERE access_token = ANY($1)
                    ORDER BY created_at DESC
                    LIMIT $2 OFFSET $3
                """, tokens, limit, offset)

            return [dict(row) for row in rows]

    async def get_meeting_tokens_by_conference(
        self,
        conference_id: str
    ) -> List[Dict[str, Any]]:
        """Get access tokens for all meetings with a given conference_id."""
        async with self.pool.acquire() as conn:
            rows = await conn.fetch("""
                SELECT id, conference_id, access_token
                FROM meetings
                WHERE conference_id = $1 AND access_token IS NOT NULL
                ORDER BY created_at DESC
            """, conference_id)

            return [dict(row) for row in rows]

    async def get_meeting_access_token(
        self,
        meeting_id: str
    ) -> Optional[str]:
        """Get the access token for a specific meeting."""
        async with self.pool.acquire() as conn:
            row = await conn.fetchrow("""
                SELECT access_token FROM meetings WHERE id = $1::uuid
            """, meeting_id)

            if row:
                return row["access_token"]
            return None

    async def backfill_tokens(self):
        """Generate access tokens for meetings that don't have one."""
        async with self.pool.acquire() as conn:
            rows = await conn.fetch("""
                SELECT id FROM meetings WHERE access_token IS NULL
            """)

            if not rows:
                return 0

            count = 0
            for row in rows:
                token = secrets.token_urlsafe(32)
                await conn.execute("""
                    UPDATE meetings SET access_token = $1 WHERE id = $2
                """, token, row["id"])
                count += 1

            log.info("Backfilled access tokens", count=count)
            return count

    # ==================== Transcripts ====================

    async def get_transcript(
        self,
        meeting_id: str,
        speaker_filter: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """Get transcript segments for a meeting."""
        async with self.pool.acquire() as conn:
            if speaker_filter:
                rows = await conn.fetch("""
                    SELECT id, segment_index, start_time, end_time,
                           speaker_id, speaker_name, speaker_label,
                           text, confidence, language
                    FROM transcripts
                    WHERE meeting_id = $1::uuid AND speaker_id = $2
                    ORDER BY segment_index ASC
                """, meeting_id, speaker_filter)
            else:
                rows = await conn.fetch("""
                    SELECT id, segment_index, start_time, end_time,
                           speaker_id, speaker_name, speaker_label,
                           text, confidence, language
                    FROM transcripts
                    WHERE meeting_id = $1::uuid
                    ORDER BY segment_index ASC
                """, meeting_id)

            return [dict(row) for row in rows]

    async def get_speakers(self, meeting_id: str) -> List[Dict[str, Any]]:
        """Get speaker statistics for a meeting."""
        async with self.pool.acquire() as conn:
            rows = await conn.fetch("""
                SELECT speaker_id, speaker_label,
                       COUNT(*) as segment_count,
                       SUM(end_time - start_time) as speaking_time,
                       SUM(LENGTH(text)) as character_count
                FROM transcripts
                WHERE meeting_id = $1::uuid AND speaker_id IS NOT NULL
                GROUP BY speaker_id, speaker_label
                ORDER BY speaking_time DESC
            """, meeting_id)

            return [dict(row) for row in rows]

    # ==================== Summaries ====================

    async def get_summary(self, meeting_id: str) -> Optional[Dict[str, Any]]:
        """Get AI summary for a meeting."""
        async with self.pool.acquire() as conn:
            row = await conn.fetchrow("""
                SELECT id, meeting_id, summary_text, key_points,
                       action_items, decisions, topics, sentiment,
                       model_used, generated_at
                FROM summaries
                WHERE meeting_id = $1::uuid
                ORDER BY generated_at DESC
                LIMIT 1
            """, meeting_id)

            if row:
                return dict(row)
            return None

    async def save_summary(
        self,
        meeting_id: str,
        summary_text: str,
        key_points: List[str],
        action_items: List[dict],
        decisions: List[str],
        topics: List[dict],
        sentiment: str,
        model_used: str,
        prompt_tokens: int = 0,
        completion_tokens: int = 0
    ) -> int:
        """Save AI-generated summary."""
        async with self.pool.acquire() as conn:
            row = await conn.fetchrow("""
                INSERT INTO summaries (
                    meeting_id, summary_text, key_points, action_items,
                    decisions, topics, sentiment, model_used,
                    prompt_tokens, completion_tokens
                )
                VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                RETURNING id
            """, meeting_id, summary_text, key_points, action_items,
               decisions, topics, sentiment, model_used,
               prompt_tokens, completion_tokens)

            return row["id"]

    # ==================== Search ====================

    async def fulltext_search(
        self,
        query: str,
        meeting_id: Optional[str] = None,
        limit: int = 50
    ) -> List[Dict[str, Any]]:
        """Full-text search across transcripts."""
        async with self.pool.acquire() as conn:
            if meeting_id:
                rows = await conn.fetch("""
                    SELECT t.id, t.meeting_id, t.start_time, t.end_time,
                           t.speaker_label, t.text, m.title as meeting_title,
                           ts_rank(to_tsvector('english', t.text),
                                   plainto_tsquery('english', $1)) as rank
                    FROM transcripts t
                    JOIN meetings m ON t.meeting_id = m.id
                    WHERE t.meeting_id = $2::uuid
                      AND to_tsvector('english', t.text) @@ plainto_tsquery('english', $1)
                    ORDER BY rank DESC
                    LIMIT $3
                """, query, meeting_id, limit)
            else:
                rows = await conn.fetch("""
                    SELECT t.id, t.meeting_id, t.start_time, t.end_time,
                           t.speaker_label, t.text, m.title as meeting_title,
                           ts_rank(to_tsvector('english', t.text),
                                   plainto_tsquery('english', $1)) as rank
                    FROM transcripts t
                    JOIN meetings m ON t.meeting_id = m.id
                    WHERE to_tsvector('english', t.text) @@ plainto_tsquery('english', $1)
                    ORDER BY rank DESC
                    LIMIT $2
                """, query, limit)

            return [dict(row) for row in rows]

    async def semantic_search(
        self,
        embedding: List[float],
        meeting_id: Optional[str] = None,
        threshold: float = 0.7,
        limit: int = 20
    ) -> List[Dict[str, Any]]:
        """Semantic search using vector embeddings."""
        async with self.pool.acquire() as conn:
            embedding_str = f"[{','.join(map(str, embedding))}]"

            if meeting_id:
                rows = await conn.fetch("""
                    SELECT te.transcript_id, te.meeting_id, te.chunk_text,
                           t.start_time, t.speaker_label, m.title as meeting_title,
                           1 - (te.embedding <=> $1::vector) as similarity
                    FROM transcript_embeddings te
                    JOIN transcripts t ON te.transcript_id = t.id
                    JOIN meetings m ON te.meeting_id = m.id
                    WHERE te.meeting_id = $2::uuid
                      AND 1 - (te.embedding <=> $1::vector) > $3
                    ORDER BY te.embedding <=> $1::vector
                    LIMIT $4
                """, embedding_str, meeting_id, threshold, limit)
            else:
                rows = await conn.fetch("""
                    SELECT te.transcript_id, te.meeting_id, te.chunk_text,
                           t.start_time, t.speaker_label, m.title as meeting_title,
                           1 - (te.embedding <=> $1::vector) as similarity
                    FROM transcript_embeddings te
                    JOIN transcripts t ON te.transcript_id = t.id
                    JOIN meetings m ON te.meeting_id = m.id
                    WHERE 1 - (te.embedding <=> $1::vector) > $2
                    ORDER BY te.embedding <=> $1::vector
                    LIMIT $3
                """, embedding_str, threshold, limit)

            return [dict(row) for row in rows]

    # ==================== Webhooks ====================

    async def save_webhook_event(
        self,
        event_type: str,
        payload: dict
    ) -> int:
        """Save a webhook event for processing."""
        import json
        async with self.pool.acquire() as conn:
            row = await conn.fetchrow("""
                INSERT INTO webhook_events (event_type, payload)
                VALUES ($1, $2::jsonb)
                RETURNING id
            """, event_type, json.dumps(payload))

            return row["id"]

    # ==================== Jobs ====================

    async def create_job(
        self,
        meeting_id: str,
        job_type: str,
        priority: int = 5,
        result: Optional[dict] = None
    ) -> int:
        """Create a processing job."""
        async with self.pool.acquire() as conn:
            row = await conn.fetchrow("""
                INSERT INTO processing_jobs (meeting_id, job_type, priority, result)
                VALUES ($1::uuid, $2, $3, $4::jsonb)
                RETURNING id
            """, meeting_id, job_type, priority, json.dumps(result or {}))

            return row["id"]
