"""
Transcript routes.
"""

from typing import Optional, List

from fastapi import APIRouter, HTTPException, Request, Query
from pydantic import BaseModel

from ..auth import validate_meeting_access

import structlog

log = structlog.get_logger()

router = APIRouter()


class TranscriptSegment(BaseModel):
    id: int
    segment_index: int
    start_time: float
    end_time: float
    speaker_id: Optional[str]
    speaker_name: Optional[str]
    speaker_label: Optional[str]
    text: str
    confidence: Optional[float]
    language: Optional[str]


class TranscriptResponse(BaseModel):
    meeting_id: str
    segments: List[TranscriptSegment]
    total_segments: int
    duration: Optional[float]


class SpeakerStats(BaseModel):
    speaker_id: str
    speaker_label: Optional[str]
    segment_count: int
    speaking_time: float
    character_count: int


class SpeakersResponse(BaseModel):
    meeting_id: str
    speakers: List[SpeakerStats]


@router.get("/{meeting_id}/transcript", response_model=TranscriptResponse)
async def get_transcript(
    request: Request,
    meeting_id: str,
    speaker: Optional[str] = Query(default=None, description="Filter by speaker ID")
):
    """Get full transcript for a meeting. Requires Bearer token."""
    await validate_meeting_access(request, meeting_id)

    db = request.app.state.db

    # Verify meeting exists
    meeting = await db.get_meeting(meeting_id)
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")

    segments = await db.get_transcript(meeting_id, speaker_filter=speaker)

    if not segments:
        raise HTTPException(
            status_code=404,
            detail="No transcript available for this meeting"
        )

    # Calculate duration from last segment
    duration = segments[-1]["end_time"] if segments else None

    return TranscriptResponse(
        meeting_id=meeting_id,
        segments=[
            TranscriptSegment(
                id=s["id"],
                segment_index=s["segment_index"],
                start_time=s["start_time"],
                end_time=s["end_time"],
                speaker_id=s.get("speaker_id"),
                speaker_name=s.get("speaker_name"),
                speaker_label=s.get("speaker_label"),
                text=s["text"],
                confidence=s.get("confidence"),
                language=s.get("language")
            )
            for s in segments
        ],
        total_segments=len(segments),
        duration=duration
    )


@router.get("/{meeting_id}/speakers", response_model=SpeakersResponse)
async def get_speakers(request: Request, meeting_id: str):
    """Get speaker statistics for a meeting. Requires Bearer token."""
    await validate_meeting_access(request, meeting_id)

    db = request.app.state.db

    # Verify meeting exists
    meeting = await db.get_meeting(meeting_id)
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")

    speakers = await db.get_speakers(meeting_id)

    return SpeakersResponse(
        meeting_id=meeting_id,
        speakers=[
            SpeakerStats(
                speaker_id=s["speaker_id"],
                speaker_label=s.get("speaker_label"),
                segment_count=s["segment_count"],
                speaking_time=float(s["speaking_time"] or 0),
                character_count=s["character_count"] or 0
            )
            for s in speakers
        ]
    )


@router.get("/{meeting_id}/transcript/text")
async def get_transcript_text(request: Request, meeting_id: str):
    """Get transcript as plain text. Requires Bearer token."""
    await validate_meeting_access(request, meeting_id)

    db = request.app.state.db

    # Verify meeting exists
    meeting = await db.get_meeting(meeting_id)
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")

    segments = await db.get_transcript(meeting_id)

    if not segments:
        raise HTTPException(
            status_code=404,
            detail="No transcript available for this meeting"
        )

    # Format as plain text
    lines = []
    current_speaker = None

    for s in segments:
        speaker = s.get("speaker_label") or "Unknown"

        if speaker != current_speaker:
            lines.append(f"\n{speaker}:")
            current_speaker = speaker

        lines.append(f"  {s['text']}")

    text = "\n".join(lines)

    return {
        "meeting_id": meeting_id,
        "text": text,
        "format": "plain"
    }
