"""
Meeting management routes.
"""

from typing import Optional, List

from fastapi import APIRouter, HTTPException, Request, Query
from pydantic import BaseModel

from ..auth import get_bearer_token, get_multi_tokens, validate_meeting_access

import structlog

log = structlog.get_logger()

router = APIRouter()


class MeetingResponse(BaseModel):
    id: str
    conference_id: str
    conference_name: Optional[str]
    title: Optional[str]
    started_at: Optional[str]
    ended_at: Optional[str]
    duration_seconds: Optional[int]
    status: str
    created_at: str
    segment_count: Optional[int] = None
    participant_count: Optional[int] = None
    has_summary: Optional[bool] = None


class MeetingListResponse(BaseModel):
    meetings: List[MeetingResponse]
    total: int
    limit: int
    offset: int


class MeetingTokenResponse(BaseModel):
    conference_id: str
    meeting_id: str
    access_token: str


@router.get("/token", response_model=List[MeetingTokenResponse])
async def get_meeting_token(
    request: Request,
    conference_id: str = Query(..., description="Room name to look up tokens for")
):
    """Get access tokens for meetings by conference_id (room name).

    This is the only unauthenticated endpoint (besides /health).
    Knowing the room name is proof of attendance.
    """
    db = request.app.state.db

    meetings = await db.get_meeting_tokens_by_conference(conference_id)

    if not meetings:
        raise HTTPException(status_code=404, detail="No meetings found for this conference")

    return [
        MeetingTokenResponse(
            conference_id=m["conference_id"],
            meeting_id=str(m["id"]),
            access_token=m["access_token"]
        )
        for m in meetings
    ]


@router.get("", response_model=MeetingListResponse)
async def list_meetings(
    request: Request,
    limit: int = Query(default=50, le=100),
    offset: int = Query(default=0, ge=0),
    status: Optional[str] = Query(default=None)
):
    """List meetings the caller has access to.

    Requires X-MI-Tokens header with comma-separated access tokens.
    Returns only meetings matching the provided tokens.
    """
    db = request.app.state.db
    tokens = get_multi_tokens(request)

    if not tokens:
        return MeetingListResponse(meetings=[], total=0, limit=limit, offset=offset)

    meetings = await db.list_meetings_by_tokens(
        tokens=tokens, limit=limit, offset=offset, status=status
    )

    return MeetingListResponse(
        meetings=[
            MeetingResponse(
                id=str(m["id"]),
                conference_id=m["conference_id"],
                conference_name=m.get("conference_name"),
                title=m.get("title"),
                started_at=m["started_at"].isoformat() if m.get("started_at") else None,
                ended_at=m["ended_at"].isoformat() if m.get("ended_at") else None,
                duration_seconds=m.get("duration_seconds"),
                status=m["status"],
                created_at=m["created_at"].isoformat()
            )
            for m in meetings
        ],
        total=len(meetings),
        limit=limit,
        offset=offset
    )


@router.get("/{meeting_id}", response_model=MeetingResponse)
async def get_meeting(request: Request, meeting_id: str):
    """Get meeting details. Requires Bearer token."""
    await validate_meeting_access(request, meeting_id)

    db = request.app.state.db
    meeting = await db.get_meeting(meeting_id)

    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")

    return MeetingResponse(
        id=str(meeting["id"]),
        conference_id=meeting["conference_id"],
        conference_name=meeting.get("conference_name"),
        title=meeting.get("title"),
        started_at=meeting["started_at"].isoformat() if meeting.get("started_at") else None,
        ended_at=meeting["ended_at"].isoformat() if meeting.get("ended_at") else None,
        duration_seconds=meeting.get("duration_seconds"),
        status=meeting["status"],
        created_at=meeting["created_at"].isoformat(),
        segment_count=meeting.get("segment_count"),
        participant_count=meeting.get("participant_count"),
        has_summary=meeting.get("summary_id") is not None
    )


@router.delete("/{meeting_id}")
async def delete_meeting(request: Request, meeting_id: str):
    """Delete a meeting and all associated data. Requires Bearer token."""
    await validate_meeting_access(request, meeting_id)

    db = request.app.state.db
    meeting = await db.get_meeting(meeting_id)

    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")

    await db.update_meeting(meeting_id, status="deleted")

    return {"status": "deleted", "meeting_id": meeting_id}
